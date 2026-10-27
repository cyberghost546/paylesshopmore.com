"""The warehouse's measurements, shown on the booking in the office dashboard.

When a warehouse worker measures the goods - on an intake sheet, or by
weighing a shipment on the scanner - the office should see it on the booking
without going looking. These tests check the `warehouse` block of the staff
booking API (bookings.serializers._warehouse).
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse

from config.testing import ThrottleFreeAPITestCase
from warehouse.models import IntakeSheet, Measurement, PackageMeasurement

from .models import Booking
from .tests import URL, payload

User = get_user_model()


class WarehouseMeasurementsOnBookingTests(ThrottleFreeAPITestCase):
    """A customer who books, and an office worker who reads the booking."""

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

    def book(self):
        """The customer sends a booking, signed in. Returns it."""
        self.client.force_authenticate(self.customer)
        self.client.post(URL, payload(), format="json")
        return Booking.objects.latest("pk")

    def detail(self, booking):
        self.client.force_authenticate(self.office)
        return self.client.get(reverse("staff-booking-detail", args=[booking.pk])).data

    def confirmed_booking(self):
        """A booking the office confirmed, so it has its shipment (package)."""
        booking = self.book()
        self.client.force_authenticate(self.office)
        self.client.patch(
            reverse("staff-booking-detail", args=[booking.pk]), {"status": "confirmed"}, format="json"
        )
        booking.refresh_from_db()
        return booking

    def test_nothing_measured_yet_is_two_empty_lists(self):
        booking = self.book()

        self.assertEqual(
            self.detail(booking)["warehouse"],
            {"intake_sheets": [], "package": [], "stage": None, "photos": []},
        )

    def test_a_confirmed_booking_shows_where_it_is_in_the_warehouse(self):
        booking = self.confirmed_booking()

        stage = self.detail(booking)["warehouse"]["stage"]

        self.assertEqual(stage, {"value": "awaiting_pickup", "label": "Package expected"})

    def test_an_intake_sheet_shows_its_lines_and_totals(self):
        booking = self.book()
        sheet = IntakeSheet.objects.create(booking=booking, freight="sea", reference="IN-7")
        Measurement.objects.create(
            sheet=sheet, quantity=2, packaging="doos",
            length_cm=Decimal("60"), width_cm=Decimal("40"), height_cm=Decimal("40"),
            weight_kg=Decimal("12.5"),
        )

        [shown] = self.detail(booking)["warehouse"]["intake_sheets"]

        self.assertEqual(shown["label"], "IN-7")
        self.assertEqual(shown["status"], "draft")
        self.assertEqual(shown["lines"][0]["quantity"], 2)
        self.assertEqual(shown["lines"][0]["packaging"], "Doos")
        self.assertEqual(shown["lines"][0]["length_cm"], "60.0")
        # 2 x 60 x 40 x 40 cm = 0.192 m3, and 2 x 12.5 kg = 25 kg.
        self.assertEqual(shown["totals"]["volume_m3"], "0.192")
        self.assertEqual(shown["totals"]["weight_kg"], "25.00")

    def test_a_sheet_linked_only_to_the_shipment_is_shown_too(self):
        booking = self.confirmed_booking()
        IntakeSheet.objects.create(package=booking.package, reference="IN-8")

        labels = [s["label"] for s in self.detail(booking)["warehouse"]["intake_sheets"]]

        self.assertEqual(labels, ["IN-8"])

    def test_a_sheet_linked_to_both_is_shown_once(self):
        booking = self.confirmed_booking()
        IntakeSheet.objects.create(booking=booking, package=booking.package, reference="IN-9")

        labels = [s["label"] for s in self.detail(booking)["warehouse"]["intake_sheets"]]

        self.assertEqual(labels, ["IN-9"])

    def test_the_scanner_measurement_shows_with_the_newest_as_current(self):
        booking = self.confirmed_booking()
        first = PackageMeasurement.objects.create(
            package=booking.package, worker=self.office, weight_kg=Decimal("20"),
            length_cm=Decimal("50"), width_cm=Decimal("40"), height_cm=Decimal("30"),
        )
        PackageMeasurement.objects.create(
            package=booking.package, worker=self.office, weight_kg=Decimal("21"),
            length_cm=Decimal("50"), width_cm=Decimal("40"), height_cm=Decimal("30"),
            supersedes=first,
        )

        rows = self.detail(booking)["warehouse"]["package"]

        self.assertEqual([row["weight_kg"] for row in rows], ["21.00", "20.00"])
        self.assertEqual([row["current"] for row in rows], [True, False])
        self.assertEqual(rows[0]["volume_m3"], "0.0600")
        self.assertTrue(rows[0]["measured_by"])

    def test_the_customer_sees_the_measurement_on_their_shipment(self):
        """What the warehouse measured reaches "My shipments", without the
        name of the worker who measured it."""
        booking = self.confirmed_booking()
        PackageMeasurement.objects.create(
            package=booking.package, worker=self.office, weight_kg=Decimal("21"),
            length_cm=Decimal("50"), width_cm=Decimal("40"), height_cm=Decimal("30"),
        )
        self.client.force_authenticate(self.customer)

        [shipment] = self.client.get(reverse("package-list")).data["results"]

        self.assertEqual(shipment["measurement"]["weight_kg"], "21.00")
        self.assertEqual(shipment["measurement"]["volume_m3"], "0.0600")
        self.assertNotIn("measured_by", shipment["measurement"])
