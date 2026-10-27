"""Tests for the booking form.

The boundary that matters: the customer fills in their half and cannot reach
the office's. Everything else here is about the form refusing bookings nobody
could act on.
"""

import json
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from config.testing import ThrottleFreeAPITestCase
from shops.models import Shop

from .models import Booking, BookingAttachment, BookingOrder

User = get_user_model()

URL = reverse("booking-create")


def payload(**overrides):
    """A complete, valid booking. Tests override the one field under test."""
    data = {
        "freight": "sea",
        "destination": "CW",
        "sender_first_name": "Voorbeeld",
        "sender_last_name": "Klant",
        "sender_address": "Hertzstraat 10",
        "sender_postal_code": "2652 XX",
        "sender_city": "Berkel en Rodenrijs",
        "sender_phone": "+31 10 767 0371",
        "sender_email": "afzender@example.com",
        "recipient_first_name": "Maria",
        "recipient_last_name": "Martina",
        "recipient_address": "Kaya Grandi 24",
        "recipient_city": "Willemstad",
        "recipient_phone": "+599 9 512 4433",
        "packing": "sender",
        "payment": "bank",
        "quantity": 3,
        "unit": "boxes",
        "contents": "Kleding en boeken",
        "value_eur": "450.00",
        "vehicle": "na",
        "signature_name": "Voorbeeld Klant",
        "agreed_terms": True,
    }
    data.update(overrides)
    return data


class BookingSubmissionTests(ThrottleFreeAPITestCase):
    def test_a_complete_booking_is_accepted(self):
        response = self.client.post(URL, payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Booking.objects.count(), 1)

        booking = Booking.objects.get()
        self.assertEqual(booking.sender_name, "Voorbeeld Klant")
        self.assertEqual(booking.recipient_name, "Maria Martina")
        self.assertEqual(booking.destination_label, "Curaçao")
        self.assertEqual(booking.status, Booking.Status.NEW)

    def test_only_the_reference_is_echoed_back(self):
        response = self.client.post(URL, payload(), format="json")
        self.assertEqual(set(response.data), {"id", "created_at"})

    def test_the_office_half_starts_empty(self):
        self.client.post(URL, payload(), format="json")
        booking = Booking.objects.get()

        self.assertEqual(booking.shipping_number, "")
        self.assertIsNone(booking.volume_m3)
        self.assertIsNone(booking.weight_kg)
        self.assertEqual(booking.packing_quality, "")

    def test_the_office_half_cannot_be_set_by_the_sender(self):
        """The reason the two serializers are separate."""
        response = self.client.post(
            URL,
            payload(
                shipping_number="CI-0001",
                status="shipped",
                volume_m3="9.9",
                weight_kg="500",
                packing_quality="good",
                office_notes="let me through",
            ),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        booking = Booking.objects.get()
        self.assertEqual(booking.shipping_number, "")
        self.assertEqual(booking.status, Booking.Status.NEW)
        self.assertIsNone(booking.volume_m3)
        self.assertIsNone(booking.weight_kg)
        self.assertEqual(booking.packing_quality, "")
        self.assertEqual(booking.office_notes, "")

    def test_the_terms_have_to_be_accepted(self):
        response = self.client.post(URL, payload(agreed_terms=False), format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("agreed_terms", response.data)
        self.assertEqual(Booking.objects.count(), 0)

    def test_a_signature_needs_a_name(self):
        response = self.client.post(URL, payload(signature_name="  "), format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_signing_time_is_stamped_by_the_server(self):
        """Not sent by the browser: when a signature was given is not
        something the signer chooses."""
        self.client.post(URL, payload(), format="json")
        self.assertIsNotNone(Booking.objects.get().signed_at)

    def test_a_signed_in_customer_is_attached_to_their_booking(self):
        user = User.objects.create_user(
            username="klant@example.com",
            email="klant@example.com",
            password="a-long-enough-password",
            first_name="Voorbeeld",
            last_name="Klant",
            phone_number="+599 9 123 4567",
        )
        self.client.force_authenticate(user)

        self.client.post(URL, payload(), format="json")
        self.assertEqual(Booking.objects.get().user, user)

    def test_booking_without_an_account_is_allowed(self):
        self.client.post(URL, payload(), format="json")
        self.assertIsNone(Booking.objects.get().user)


class BookingValidationTests(ThrottleFreeAPITestCase):
    def test_other_destination_needs_saying_which(self):
        response = self.client.post(URL, payload(destination="other"), format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("destination_other", response.data)

    def test_other_destination_with_a_name_is_accepted(self):
        response = self.client.post(
            URL, payload(destination="other", destination_other="Saba"), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Booking.objects.get().destination_label, "Saba")

    def test_a_named_destination_clears_any_stray_free_text(self):
        self.client.post(
            URL, payload(destination="AW", destination_other="Saba"), format="json"
        )
        self.assertEqual(Booking.objects.get().destination_other, "")

    def test_insurance_needs_a_value(self):
        response = self.client.post(URL, payload(insured=True), format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("insured_value_eur", response.data)

    def test_an_uninsured_booking_carries_no_insured_value(self):
        """A half-filled form must not leave a figure behind that suggests
        cover nobody paid for."""
        self.client.post(
            URL, payload(insured=False, insured_value_eur="900.00"), format="json"
        )
        self.assertIsNone(Booking.objects.get().insured_value_eur)

    def test_the_emigration_boxes_are_cleared_without_an_emigration(self):
        self.client.post(
            URL,
            payload(
                emigration=False,
                id_present=True,
                deregistered=True,
                deregistration_present=True,
            ),
            format="json",
        )

        booking = Booking.objects.get()
        self.assertFalse(booking.id_present)
        self.assertFalse(booking.deregistered)
        self.assertFalse(booking.deregistration_present)

    def test_the_emigration_boxes_are_kept_with_one(self):
        self.client.post(
            URL, payload(emigration=True, id_present=True), format="json"
        )

        booking = Booking.objects.get()
        self.assertTrue(booking.emigration)
        self.assertTrue(booking.id_present)

    def test_contents_or_an_attached_list_is_required(self):
        response = self.client.post(
            URL, payload(contents="", contents_attached=False), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("contents", response.data)

    def test_an_attached_list_stands_in_for_a_description(self):
        response = self.client.post(
            URL, payload(contents="", contents_attached=True), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_a_negative_value_is_refused(self):
        response = self.client.post(URL, payload(value_eur="-1.00"), format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_nothing_to_ship_is_refused(self):
        response = self.client.post(URL, payload(quantity=0), format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_implausible_phone_number_is_refused(self):
        response = self.client.post(URL, payload(sender_phone="nonsense"), format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_recipients_email_is_optional(self):
        """The agent phones rather than writes; an island address is enough."""
        response = self.client.post(URL, payload(recipient_email=""), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_the_recipients_crib_number_is_optional(self):
        response = self.client.post(URL, payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Booking.objects.get().recipient_crib_number, "")

    def test_the_recipients_crib_number_is_kept_when_given(self):
        self.client.post(
            URL, payload(recipient_crib_number="1234567890"), format="json"
        )
        self.assertEqual(Booking.objects.get().recipient_crib_number, "1234567890")

    def test_the_number_of_parcels_can_be_left_open(self):
        """Somebody who ordered online cannot know how many parcels the shop
        will send; the warehouse counts them when they arrive."""
        data = payload()
        del data["quantity"]

        response = self.client.post(URL, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(Booking.objects.get().quantity)

    def test_an_empty_number_of_parcels_is_accepted_too(self):
        """What the form sends when the box is left empty."""
        response = self.client.post(URL, payload(quantity=None), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


class MyBookingsTests(ThrottleFreeAPITestCase):
    """GET /api/bookings/mine/: a customer reading back what they booked."""

    MINE = reverse("my-bookings")

    def make_user(self, email):
        return User.objects.create_user(
            username=email, email=email, password="a-long-enough-password"
        )

    def book_as(self, user, **overrides):
        self.client.force_authenticate(user)
        self.client.post(URL, payload(**overrides), format="json")
        self.client.force_authenticate(None)

    def test_a_customer_sees_their_own_bookings_newest_first(self):
        user = self.make_user("klant@example.com")
        self.book_as(user, contents="Eerste")
        self.book_as(user, contents="Tweede")

        self.client.force_authenticate(user)
        response = self.client.get(self.MINE)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([b["contents"] for b in response.data], ["Tweede", "Eerste"])
        first = response.data[0]
        self.assertEqual(first["destination_label"], "Curaçao")
        self.assertEqual(first["recipient_city"], "Willemstad")
        self.assertEqual(first["status"], "new")
        self.assertEqual(first["shipping_number"], "")

    def test_nobody_else_s_bookings_show(self):
        mine = self.make_user("klant@example.com")
        other = self.make_user("ander@example.com")
        self.book_as(other)
        self.client.post(URL, payload(), format="json")  # without an account

        self.client.force_authenticate(mine)
        self.assertEqual(self.client.get(self.MINE).data, [])

    def test_the_office_s_own_remarks_stay_in_the_office(self):
        user = self.make_user("klant@example.com")
        self.book_as(user)
        Booking.objects.update(
            office_notes="Klant belt altijd te laat", packing_quality="poor"
        )

        self.client.force_authenticate(user)
        booking = self.client.get(self.MINE).data[0]

        self.assertNotIn("office_notes", booking)
        self.assertNotIn("packing_quality", booking)
        self.assertNotIn("user", booking)

    def test_it_needs_an_account(self):
        response = self.client.get(self.MINE)
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_it_cannot_be_used_to_change_a_booking(self):
        user = self.make_user("klant@example.com")
        self.client.force_authenticate(user)
        response = self.client.post(self.MINE, payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


# The smallest files that pass the signature check, for the upload tests.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32
PDF = b"%PDF-1.4\n" + b"\x00" * 32

TEST_MEDIA = tempfile.mkdtemp(prefix="plsm-test-media-")


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class BookingOrderTests(ThrottleFreeAPITestCase):
    """The stores on the booking form ("Uw bestellingen"): which webshop,
    what was bought there, and a screenshot of the order."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        # The uploads go to a throwaway folder, removed afterwards.
        shutil.rmtree(TEST_MEDIA, ignore_errors=True)

    def setUp(self):
        # The shop list is seeded by a migration; reuse its stores.
        self.bol, _ = Shop.objects.get_or_create(
            name="bol.com", defaults={"url": "https://www.bol.com/"}
        )
        self.ikea, _ = Shop.objects.get_or_create(
            name="IKEA", defaults={"url": "https://www.ikea.com/nl/"}
        )

    def booking_data(self, orders, **overrides):
        data = payload(**overrides)
        data.pop("contents")
        data["orders"] = orders
        return data

    def send_json(self, orders, user=None, **overrides):
        if user:
            self.client.force_authenticate(user)
        response = self.client.post(URL, self.booking_data(orders, **overrides), format="json")
        self.client.force_authenticate(None)
        return response

    def send_multipart(self, orders, files, user=None):
        """The way the form sends it when there are screenshots."""
        if user:
            self.client.force_authenticate(user)
        data = {k: v for k, v in self.booking_data(orders).items() if v is not None}
        data["orders"] = json.dumps(orders)
        for index, file in files.items():
            data[f"order_{index}_screenshot"] = file
        response = self.client.post(URL, data, format="multipart")
        self.client.force_authenticate(None)
        return response

    def make_user(self, email, **extra):
        return User.objects.create_user(
            username=email, email=email, password="a-long-enough-password", **extra
        )

    def test_the_stores_are_saved_and_become_the_contents_line(self):
        response = self.send_json(
            [
                {"shop": self.bol.pk, "description": "Laptop en muis"},
                {"shop": None, "shop_name": "Coolblue", "description": "Koptelefoon"},
            ]
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        booking = Booking.objects.get()
        rows = list(booking.orders.values_list("shop_id", "shop_name", "description"))
        self.assertEqual(
            rows,
            [(self.bol.pk, "bol.com", "Laptop en muis"), (None, "Coolblue", "Koptelefoon")],
        )
        self.assertEqual(booking.contents, "bol.com: Laptop en muis; Coolblue: Koptelefoon")

    def test_a_listed_store_keeps_its_own_name(self):
        self.send_json([{"shop": self.ikea.pk, "shop_name": "something else", "description": "Kast"}])
        self.assertEqual(BookingOrder.objects.get().shop_name, "IKEA")

    def test_each_row_needs_a_store_and_what_was_bought(self):
        no_store = self.send_json([{"description": "Kast"}])
        nothing_bought = self.send_json([{"shop": self.ikea.pk, "description": ""}])

        self.assertEqual(no_store.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(nothing_bought.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Booking.objects.count(), 0)

    def test_a_store_that_is_no_longer_listed_is_refused(self):
        self.bol.is_active = False
        self.bol.save()
        response = self.send_json([{"shop": self.bol.pk, "description": "Laptop"}])
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_at_most_ten_stores(self):
        rows = [{"shop": self.bol.pk, "description": f"Ding {n}"} for n in range(BookingOrder.MAX_ORDERS + 1)]
        response = self.send_json(rows)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_each_store_can_carry_a_screenshot(self):
        response = self.send_multipart(
            [
                {"shop": self.bol.pk, "description": "Laptop"},
                {"shop": self.ikea.pk, "description": "Kast"},
                {"shop": None, "shop_name": "Zalando", "description": "Schoenen"},
            ],
            {
                0: SimpleUploadedFile("bol.png", PNG),
                1: SimpleUploadedFile("ikea.webp", WEBP),
                # Row 2 has no screenshot: that is allowed.
            },
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        booking = Booking.objects.get()
        rows = booking.orders.all()
        self.assertEqual(rows[0].screenshots.get().content_type, "image/png")
        self.assertEqual(rows[1].screenshots.get().content_type, "image/webp")
        self.assertFalse(rows[2].screenshots.exists())
        # The customer's own filename never becomes the stored path.
        self.assertNotIn("bol", rows[0].screenshots.get().file.name)

    def test_jpeg_and_pdf_are_accepted_too(self):
        response = self.send_multipart(
            [{"shop": self.bol.pk, "description": "A"}, {"shop": self.ikea.pk, "description": "B"}],
            {0: SimpleUploadedFile("foto.JPG", JPEG), 1: SimpleUploadedFile("bevestiging.pdf", PDF)},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        types = list(BookingAttachment.objects.values_list("content_type", flat=True))
        self.assertEqual(types, ["image/jpeg", "application/pdf"])

    def test_a_file_that_is_not_what_it_says_is_refused_and_nothing_is_saved(self):
        response = self.send_multipart(
            [{"shop": self.bol.pk, "description": "Laptop"}],
            {0: SimpleUploadedFile("bestelling.png", b"<html>not a picture</html>")},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("orders", response.data)
        self.assertEqual(Booking.objects.count(), 0)

    def test_other_file_types_are_refused(self):
        response = self.send_multipart(
            [{"shop": self.bol.pk, "description": "Laptop"}],
            {0: SimpleUploadedFile("virus.exe", b"MZ" + b"\x00" * 32)},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_riff_file_that_is_not_webp_is_refused(self):
        response = self.send_multipart(
            [{"shop": self.bol.pk, "description": "Laptop"}],
            {0: SimpleUploadedFile("sound.webp", b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 32)},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_file_that_is_too_big_is_refused(self):
        too_big = PNG + b"\x00" * BookingAttachment.MAX_BYTES
        response = self.send_multipart(
            [{"shop": self.bol.pk, "description": "Laptop"}],
            {0: SimpleUploadedFile("groot.png", too_big)},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_customer_reads_back_their_stores_and_screenshots(self):
        user = self.make_user("klant@example.com")
        self.send_multipart(
            [{"shop": self.bol.pk, "description": "Laptop"}],
            {0: SimpleUploadedFile("bestelling.png", PNG)},
            user=user,
        )

        self.client.force_authenticate(user)
        order = self.client.get(reverse("my-bookings")).data[0]["orders"][0]
        self.assertEqual(order["shop_name"], "bol.com")
        self.assertEqual(order["description"], "Laptop")
        self.assertEqual(order["screenshot"]["name"], "bestelling.png")
        self.assertTrue(order["screenshot"]["is_image"])

        response = self.client.get(order["screenshot"]["url"])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(b"".join(response.streaming_content), PNG)

    def test_nobody_else_can_open_a_screenshot(self):
        owner = self.make_user("klant@example.com")
        stranger = self.make_user("ander@example.com")
        self.send_multipart(
            [{"shop": self.bol.pk, "description": "Laptop"}],
            {0: SimpleUploadedFile("bestelling.png", PNG)},
            user=owner,
        )
        screenshot = BookingAttachment.objects.get()
        url = reverse("my-booking-attachment", args=[screenshot.booking_id, screenshot.pk])

        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(None)
        self.assertIn(
            self.client.get(url).status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_the_office_sees_the_stores_and_opens_the_screenshots(self):
        self.send_multipart(
            [{"shop": self.ikea.pk, "description": "Kast"}],
            {0: SimpleUploadedFile("bevestiging.pdf", PDF)},
        )
        booking = Booking.objects.get()
        self.client.force_authenticate(self.make_user("kantoor@example.com", is_staff=True))

        detail = self.client.get(reverse("staff-booking-detail", args=[booking.pk])).data
        order = detail["orders"][0]
        self.assertEqual((order["shop_name"], order["description"]), ("IKEA", "Kast"))

        response = self.client.get(order["screenshot"]["url"])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        # A PDF is downloaded rather than opened in the page.
        self.assertIn("attachment;", response["Content-Disposition"])

    def test_typing_the_contents_still_works_without_stores(self):
        # An older copy of the form, still open in somebody's browser.
        response = self.client.post(URL, payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Booking.objects.get().orders.count(), 0)


class OptionalValueTests(ThrottleFreeAPITestCase):
    """The form no longer asks for the value: the office fills it in."""

    def test_a_booking_without_a_value_is_accepted(self):
        data = payload()
        data.pop("value_eur")
        response = self.client.post(URL, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertIsNone(Booking.objects.get().value_eur)

    def test_the_office_fills_the_value_in(self):
        data = payload()
        data.pop("value_eur")
        self.client.post(URL, data, format="json")
        booking = Booking.objects.get()
        staff = User.objects.create_user(
            username="kantoor@example.com",
            email="kantoor@example.com",
            password="a-long-enough-password",
            is_staff=True,
        )
        self.client.force_authenticate(staff)
        url = reverse("staff-booking-detail", args=[booking.pk])

        response = self.client.patch(url, {"value_eur": "469.00"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        booking.refresh_from_db()
        self.assertEqual(str(booking.value_eur), "469.00")

        refused = self.client.patch(url, {"value_eur": "-5.00"}, format="json")
        self.assertEqual(refused.status_code, status.HTTP_400_BAD_REQUEST)


class StaffBookingAccountTests(ThrottleFreeAPITestCase):
    """The office sees which customer account a booking came from."""

    def staff(self):
        return User.objects.create_user(
            username="kantoor@example.com",
            email="kantoor@example.com",
            password="a-long-enough-password",
            is_staff=True,
        )

    def test_a_signed_in_booking_shows_its_account(self):
        customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com",
            password="a-long-enough-password", first_name="Klaas", last_name="Klant",
        )
        self.client.force_authenticate(customer)
        self.client.post(URL, payload(), format="json")
        self.client.force_authenticate(self.staff())

        booking = Booking.objects.get()
        detail = self.client.get(reverse("staff-booking-detail", args=[booking.pk])).data
        self.assertEqual(
            detail["account"],
            {"id": customer.pk, "name": "Klaas Klant", "email": "klant@example.com"},
        )

    def test_a_booking_without_an_account_says_so(self):
        self.client.post(URL, payload(), format="json")
        self.client.force_authenticate(self.staff())
        booking = Booking.objects.get()
        detail = self.client.get(reverse("staff-booking-detail", args=[booking.pk])).data
        self.assertIsNone(detail["account"])


class BookingBecomesShipmentTests(ThrottleFreeAPITestCase):
    """Once the office works on a booking, it shows under "My shipments".

    See bookings/shipments.py.
    """

    def setUp(self):
        super().setUp()
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com",
            password="a-long-enough-password",
        )
        self.office = User.objects.create_user(
            username="kantoor@example.com", email="kantoor@example.com",
            password="a-long-enough-password", is_staff=True,
        )

    def book(self, **overrides):
        """The customer sends a booking, signed in. Returns it."""
        self.client.force_authenticate(self.customer)
        self.client.post(URL, payload(**overrides), format="json")
        return Booking.objects.latest("pk")

    def set_status(self, booking, value, **office_fields):
        self.client.force_authenticate(self.office)
        return self.client.patch(
            reverse("staff-booking-detail", args=[booking.pk]),
            {"status": value, **office_fields},
            format="json",
        )

    def my_shipments(self):
        self.client.force_authenticate(self.customer)
        return self.client.get(reverse("package-list")).data["results"]

    def test_a_new_booking_is_not_a_shipment_yet(self):
        self.book()
        self.assertEqual(self.my_shipments(), [])

    def test_confirming_it_puts_it_under_my_shipments(self):
        booking = self.book()

        response = self.set_status(booking, "confirmed", weight_kg="42.50")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        shipments = self.my_shipments()
        self.assertEqual(len(shipments), 1)
        shipment = shipments[0]
        # Its own number, from the booking's, and what the customer booked.
        self.assertEqual(shipment["tracking_number"], f"PLSM-B{booking.pk:05d}")
        self.assertEqual(shipment["description"], "Kleding en boeken")
        self.assertEqual(shipment["destination"], "Curaçao")
        self.assertEqual(shipment["weight_kg"], "42.500")  # shipments keep 3 decimals
        self.assertEqual(shipment["status"], "quoted")
        # And the dashboard says where it went.
        self.assertEqual(response.data["shipment"]["tracking_number"], f"PLSM-B{booking.pk:05d}")

    def test_the_dashboard_shows_the_link(self):
        booking = self.book()
        response = self.set_status(booking, "confirmed")
        self.assertEqual(response.data["shipment"]["tracking_number"], f"PLSM-B{booking.pk:05d}")

    def test_the_office_shipping_number_becomes_the_tracking_number(self):
        booking = self.book()
        self.set_status(booking, "confirmed", shipping_number="ZV-2026-118")
        self.assertEqual(self.my_shipments()[0]["tracking_number"], "ZV-2026-118")

    def test_the_freight_goes_along(self):
        booking = self.book(freight="air")
        self.set_status(booking, "confirmed")
        booking.refresh_from_db()
        self.assertEqual(booking.package.freight, "air")

    def test_the_stores_ordered_from_name_the_shipment(self):
        booking = self.book(
            contents="",
            orders=[
                {"shop": None, "shop_name": "Bol.com", "description": "PS5"},
                {"shop": None, "shop_name": "Bol.com", "description": "Gaming pc asus"},
            ],
        )
        self.set_status(booking, "confirmed")
        self.assertEqual(self.my_shipments()[0]["description"], "Bol.com: PS5; Bol.com: Gaming pc asus")

    def test_changing_the_status_again_never_makes_a_second_shipment(self):
        # Shipped moves the same shipment along instead (see the tests below).
        booking = self.book()
        self.set_status(booking, "confirmed")
        self.set_status(booking, "booked_in")
        self.set_status(booking, "shipped")
        self.assertEqual(len(self.my_shipments()), 1)

    def test_skipping_straight_to_booked_in_also_makes_one(self):
        booking = self.book()
        self.set_status(booking, "booked_in")
        self.assertEqual(len(self.my_shipments()), 1)

    def test_a_cancelled_booking_makes_none(self):
        booking = self.book()
        self.set_status(booking, "cancelled")
        self.assertEqual(self.my_shipments(), [])

    def test_a_booking_without_an_account_makes_none_and_says_why(self):
        self.client.force_authenticate(None)
        self.client.post(URL, payload(), format="json")
        booking = Booking.objects.get()

        response = self.set_status(booking, "confirmed")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["shipment"])
        self.assertEqual(response.data["shipment_blocked"], "no_account")
        booking.refresh_from_db()
        self.assertIsNone(booking.package)

    def test_a_taken_tracking_number_gets_a_suffix(self):
        first = self.book()
        self.set_status(first, "confirmed", shipping_number="ZV-1")
        second = self.book()
        self.set_status(second, "confirmed", shipping_number="ZV-1")

        numbers = sorted(s["tracking_number"] for s in self.my_shipments())
        self.assertEqual(numbers, ["ZV-1", "ZV-1-2"])


class BookingStatusMovesShipmentTests(BookingBecomesShipmentTests):
    """Shipped and Cancelled on a booking move its shipment too, so it lands
    in the right section of "My shipments". Inherits the helpers above (and
    so runs their tests again, which is cheap and harmless)."""

    def test_shipped_puts_it_on_the_way(self):
        booking = self.book()
        self.set_status(booking, "confirmed")

        self.set_status(booking, "shipped")

        shipment = self.my_shipments()[0]
        # "In transit" is the "On the way" section of My shipments.
        self.assertEqual(shipment["status"], "in_transit")
        self.assertIsNotNone(shipment["shipped_at"])

    def test_shipped_straight_from_new_also_works(self):
        booking = self.book()
        self.set_status(booking, "shipped")
        self.assertEqual(self.my_shipments()[0]["status"], "in_transit")

    def test_the_move_is_in_the_shipments_history(self):
        booking = self.book()
        self.set_status(booking, "confirmed")
        self.set_status(booking, "shipped")

        booking.refresh_from_db()
        event = booking.package.events.get(kind="status_changed")
        self.assertEqual(event.actor, self.office)

    def test_cancelling_the_booking_cancels_its_shipment(self):
        booking = self.book()
        self.set_status(booking, "confirmed")
        self.set_status(booking, "cancelled")
        self.assertEqual(self.my_shipments()[0]["status"], "cancelled")

    def test_a_shipment_that_has_left_is_not_cancelled(self):
        booking = self.book()
        self.set_status(booking, "shipped")

        response = self.set_status(booking, "cancelled")

        # The booking change is saved; the shipment, already at sea, stays.
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.my_shipments()[0]["status"], "in_transit")

    def test_a_shipment_further_along_is_never_sent_back(self):
        booking = self.book()
        self.set_status(booking, "confirmed")
        booking.refresh_from_db()
        package = booking.package
        package.status = "delivered"
        package.save()

        self.set_status(booking, "shipped")

        self.assertEqual(self.my_shipments()[0]["status"], "delivered")


class ConfirmedBookingLeavesMyBookingsTests(BookingBecomesShipmentTests):
    """A confirmed booking moves from "My bookings" to "My shipments"."""

    def my_bookings(self):
        self.client.force_authenticate(self.customer)
        return self.client.get(reverse("my-bookings")).data

    def test_a_confirmed_booking_is_only_under_my_shipments(self):
        booking = self.book()
        self.assertEqual(len(self.my_bookings()), 1)

        self.set_status(booking, "confirmed")

        self.assertEqual(self.my_bookings(), [])
        self.assertEqual(len(self.my_shipments()), 1)
        # Not deleted: still there for the office.
        self.assertTrue(Booking.objects.filter(pk=booking.pk).exists())

    def test_only_the_confirmed_one_goes(self):
        confirmed = self.book()
        self.set_status(confirmed, "confirmed")
        waiting = self.book()

        self.assertEqual([b["id"] for b in self.my_bookings()], [waiting.pk])

    def test_a_booking_cancelled_while_new_stays(self):
        # Cancelled before it was ever confirmed: no shipment, so it stays.
        booking = self.book()
        self.set_status(booking, "cancelled")
        self.assertEqual([b["id"] for b in self.my_bookings()], [booking.pk])

    def test_a_confirmed_booking_without_a_shipment_stays(self):
        # Confirmed before bookings became shipments: nowhere else to see it.
        booking = self.book()
        Booking.objects.filter(pk=booking.pk).update(status="confirmed")

        self.assertEqual([b["id"] for b in self.my_bookings()], [booking.pk])
