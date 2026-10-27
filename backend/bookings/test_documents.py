"""Adding documents to a booking afterwards, from the customer's profile page:
the order confirmation, the invoice, the track-and-trace - per store.

What matters: only the booking's own customer can add or remove them, the
same file checks as the booking form apply, the screenshot sent with the form
stays, and a shipped or cancelled booking is closed."""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from config.testing import ThrottleFreeAPITestCase

from .models import Booking, BookingAttachment, BookingOrder
from .tests import PDF, PNG, URL, payload

User = get_user_model()

TEST_MEDIA = tempfile.mkdtemp(prefix="plsm-test-media-")


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class BookingWithOrdersTestCase(ThrottleFreeAPITestCase):
    """A signed-in customer's booking with two stores, MediaMarkt and Megekko."""

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEST_MEDIA, ignore_errors=True)

    def setUp(self):
        super().setUp()
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com", password="x-long-password-1"
        )
        self.stranger = User.objects.create_user(
            username="ander@example.com", email="ander@example.com", password="x-long-password-1"
        )
        data = payload()
        data.pop("contents")
        data["orders"] = [
            {"shop_name": "MediaMarkt", "description": "monitor"},
            {"shop_name": "Megekko", "description": "Moederbord"},
        ]
        self.client.force_authenticate(self.customer)
        response = self.client.post(URL, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.booking = Booking.objects.get(pk=response.data["id"])
        self.order = BookingOrder.objects.get(booking=self.booking, shop_name="MediaMarkt")



class OrderDocumentTests(BookingWithOrdersTestCase):
    def url(self, booking=None, order=None):
        return reverse(
            "my-order-documents",
            args=[(booking or self.booking).pk, (order or self.order).pk],
        )

    def add(self, kind="invoice", name="factuur.pdf", content=PDF, as_user=None):
        self.client.force_authenticate(as_user or self.customer)
        return self.client.post(
            self.url(), {"kind": kind, "file": SimpleUploadedFile(name, content)}, format="multipart"
        )

    def test_the_customer_adds_an_invoice_to_a_store(self):
        response = self.add()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        [document] = response.data["documents"]
        self.assertEqual(document["kind"], "invoice")
        self.assertEqual(document["kind_display"], "Invoice")
        self.assertEqual(document["name"], "factuur.pdf")
        # And it reads back with the booking, under that store.
        mine = self.client.get(reverse("my-bookings")).data[0]
        media = next(o for o in mine["orders"] if o["shop_name"] == "MediaMarkt")
        self.assertEqual([d["name"] for d in media["documents"]], ["factuur.pdf"])
        # The other store is untouched.
        other = next(o for o in mine["orders"] if o["shop_name"] == "Megekko")
        self.assertEqual(other["documents"], [])

    def test_every_kind_of_document(self):
        for kind in ["order_confirmation", "invoice", "tracking", "other"]:
            self.assertEqual(self.add(kind=kind, name=f"{kind}.png", content=PNG).status_code, 201)

        kinds = sorted(BookingAttachment.objects.filter(order=self.order).values_list("kind", flat=True))
        self.assertEqual(kinds, ["invoice", "order_confirmation", "other", "tracking"])

    def test_it_can_be_opened_afterwards(self):
        document_id = self.add().data["documents"][0]["id"]

        response = self.client.get(reverse("my-booking-attachment", args=[self.booking.pk, document_id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), PDF)

    def test_the_same_file_checks_as_the_booking_form(self):
        refused = [
            self.add(name="virus.exe", content=b"MZ" + b"\x00" * 32),
            self.add(name="factuur.pdf", content=b"<html>not a pdf</html>"),
            self.add(name="groot.pdf", content=PDF + b"\x00" * BookingAttachment.MAX_BYTES),
        ]
        for response in refused:
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(BookingAttachment.objects.filter(order=self.order).exists())

    def test_it_needs_a_kind_and_a_file(self):
        self.client.force_authenticate(self.customer)

        no_kind = self.client.post(self.url(), {"file": SimpleUploadedFile("a.pdf", PDF)}, format="multipart")
        screenshot = self.add(kind="screenshot")
        no_file = self.client.post(self.url(), {"kind": "invoice"}, format="multipart")

        for response in (no_kind, screenshot, no_file):
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_nobody_else_can_add_to_it(self):
        response = self.add(as_user=self.stranger)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(BookingAttachment.objects.exists())

    def test_nor_without_signing_in(self):
        self.client.force_authenticate(None)

        response = self.client.post(self.url(), {"kind": "invoice"}, format="multipart")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_store_from_another_booking_is_not_found(self):
        other_booking = Booking.objects.create(**payload(), user=self.customer)
        self.client.force_authenticate(self.customer)

        response = self.client.post(
            self.url(booking=other_booking),
            {"kind": "invoice", "file": SimpleUploadedFile("a.pdf", PDF)},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_shipped_or_cancelled_booking_is_closed(self):
        for closed in (Booking.Status.SHIPPED, Booking.Status.CANCELLED):
            Booking.objects.filter(pk=self.booking.pk).update(status=closed)
            self.assertEqual(self.add().status_code, status.HTTP_403_FORBIDDEN)

    def test_still_open_once_confirmed(self):
        """The point: documents can be added after the booking is confirmed."""
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.CONFIRMED)

        self.assertEqual(self.add().status_code, status.HTTP_201_CREATED)

    def test_at_most_ten_per_store(self):
        for _ in range(BookingAttachment.MAX_DOCUMENTS_PER_ORDER):
            self.add(content=PDF)

        self.assertEqual(self.add().status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_customer_removes_a_document_they_added(self):
        document_id = self.add().data["documents"][0]["id"]
        url = reverse("my-booking-attachment", args=[self.booking.pk, document_id])

        self.assertEqual(self.client.delete(url).status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(BookingAttachment.objects.filter(pk=document_id).exists())

    def test_but_not_the_screenshot_from_the_form(self):
        shot = BookingAttachment.objects.create(
            booking=self.booking,
            order=self.order,
            file=SimpleUploadedFile("bestelling.png", PNG),
            content_type="image/png",
        )
        self.client.force_authenticate(self.customer)

        response = self.client.delete(reverse("my-booking-attachment", args=[self.booking.pk, shot.pk]))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(BookingAttachment.objects.filter(pk=shot.pk).exists())

    def test_nor_somebody_elses(self):
        document_id = self.add().data["documents"][0]["id"]
        self.client.force_authenticate(self.stranger)

        response = self.client.delete(reverse("my-booking-attachment", args=[self.booking.pk, document_id]))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_office_sees_them_with_the_booking(self):
        self.add(kind="tracking", name="track.png", content=PNG)
        admin = User.objects.create_user(
            username="baas@example.com", email="baas@example.com", password="x-long-password-1", role=User.Role.ADMIN
        )
        self.client.force_authenticate(admin)

        response = self.client.get(reverse("staff-booking-detail", args=[self.booking.pk]))

        media = next(o for o in response.data["orders"] if o["shop_name"] == "MediaMarkt")
        self.assertEqual(media["documents"][0]["kind_display"], "Track-and-trace")
        self.assertIn("/api/staff/", media["documents"][0]["url"])


class OrderTrackingTests(BookingWithOrdersTestCase):
    """The track-and-trace, typed as text rather than uploaded."""

    def set_tracking(self, value, as_user=None):
        self.client.force_authenticate(as_user or self.customer)
        return self.client.patch(
            reverse("my-order-tracking", args=[self.booking.pk, self.order.pk]),
            {"tracking_code": value},
            format="json",
        )

    def test_the_customer_types_a_tracking_code(self):
        response = self.set_tracking("  3SABC1234567 ")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["tracking_code"], "3SABC1234567")
        mine = self.client.get(reverse("my-bookings")).data[0]
        media = next(o for o in mine["orders"] if o["shop_name"] == "MediaMarkt")
        self.assertEqual(media["tracking_code"], "3SABC1234567")

    def test_a_link_is_kept_as_typed_on_one_line(self):
        response = self.set_tracking("https://jouw.postnl.nl/track-and-trace/3SABC\n")

        self.assertEqual(response.data["tracking_code"], "https://jouw.postnl.nl/track-and-trace/3SABC")

    def test_it_can_be_cleared(self):
        self.set_tracking("3SABC1234567")

        self.assertEqual(self.set_tracking("").data["tracking_code"], "")

    def test_too_long_or_not_text_is_refused(self):
        self.assertEqual(self.set_tracking("x" * 256).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.set_tracking(None).status_code, status.HTTP_400_BAD_REQUEST)

    def test_nobody_else_can_set_it(self):
        self.assertEqual(self.set_tracking("X", as_user=self.stranger).status_code, 404)
        self.order.refresh_from_db()
        self.assertEqual(self.order.tracking_code, "")

    def test_closed_once_shipped(self):
        Booking.objects.filter(pk=self.booking.pk).update(status=Booking.Status.SHIPPED)

        self.assertEqual(self.set_tracking("3SABC").status_code, status.HTTP_403_FORBIDDEN)

    def test_the_office_sees_it(self):
        self.set_tracking("3SABC1234567")
        admin = User.objects.create_user(
            username="baas2@example.com",
            email="baas2@example.com",
            password="x-long-password-1",
            role=User.Role.ADMIN,
        )
        self.client.force_authenticate(admin)

        response = self.client.get(reverse("staff-booking-detail", args=[self.booking.pk]))

        media = next(o for o in response.data["orders"] if o["shop_name"] == "MediaMarkt")
        self.assertEqual(media["tracking_code"], "3SABC1234567")
