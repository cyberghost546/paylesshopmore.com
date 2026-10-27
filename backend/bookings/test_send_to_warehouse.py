"""A booking given its shipping number goes to the warehouse; once measured,
the office makes the invoice from what the warehouse measured.

    booking in  ->  office gives it a shipping number  ->  on the warehouse
    floor ("Package expected")  ->  received and measured  ->  "Ready to
    invoice" on the booking  ->  the invoice editor opens with the shipment
    and the warehouse's sizes and weight filled in.

See bookings/shipments.py send_to_warehouse and invoicing/composer.py
warehouse_measurements.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.urls import reverse

from accounts.models import Package
from config.testing import ThrottleFreeAPITestCase
from warehouse.models import IntakeSheet, Measurement, PackageMeasurement

from .models import Booking
from .tests import URL, payload

User = get_user_model()

BOARD = "/api/staff/warehouse/shipments/"
DEFAULTS = "/api/staff/invoices/compose-defaults/"


class SendToWarehouseTests(ThrottleFreeAPITestCase):
    def setUp(self):
        super().setUp()
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com", password="a-long-enough-password"
        )
        self.office = User.objects.create_user(
            username="kantoor@example.com", email="kantoor@example.com",
            password="a-long-enough-password", role=User.Role.OFFICE,
        )

    def book(self, signed_in=True):
        if signed_in:
            self.client.force_authenticate(self.customer)
        self.client.post(URL, payload(), format="json")
        self.client.force_authenticate(None)
        return Booking.objects.latest("pk")

    def patch(self, booking, **fields):
        self.client.force_authenticate(self.office)
        return self.client.patch(reverse("staff-booking-detail", args=[booking.pk]), fields, format="json")

    def on_the_board(self, package):
        self.client.force_authenticate(self.office)
        rows = self.client.get(BOARD, {"page_size": 100}).json()["results"]
        return package.pk in {row["id"] for row in rows}

    # ---- the number sends it -------------------------------------------------

    def test_a_shipping_number_confirms_the_booking_and_puts_it_on_the_floor(self):
        booking = self.book()

        response = self.patch(booking, shipping_number="CI-1234")

        self.assertEqual(response.status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.Status.CONFIRMED)
        package = booking.package
        self.assertEqual(package.status, Package.Status.QUOTED)  # not paid: that is fine
        self.assertEqual(package.tracking_number, "CI-1234")
        self.assertIsNotNone(package.sent_to_warehouse_at)
        self.assertEqual(package.warehouse_stage, Package.WarehouseStage.AWAITING_PICKUP)
        self.assertTrue(self.on_the_board(package))
        self.assertIsNotNone(response.json()["shipment"]["sent_to_warehouse_at"])

    def test_confirming_without_a_number_does_not_send_it(self):
        booking = self.book()
        self.patch(booking, status="confirmed")
        booking.refresh_from_db()

        self.assertIsNone(booking.package.sent_to_warehouse_at)
        self.assertFalse(self.on_the_board(booking.package))

    def test_a_booking_without_an_account_cannot_go(self):
        booking = self.book(signed_in=False)
        response = self.patch(booking, shipping_number="CI-9")

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["shipment"])
        self.assertEqual(response.json()["shipment_blocked"], "no_account")

    def test_a_cancelled_booking_is_not_sent(self):
        booking = self.book()
        self.patch(booking, status="cancelled")
        self.patch(booking, shipping_number="CI-5")
        booking.refresh_from_db()
        self.assertIsNone(booking.package_id)

    def test_other_unpaid_quotes_stay_off_the_floor(self):
        package = Package.objects.create(user=self.customer, tracking_number="PLSM-Q1")
        self.assertFalse(self.on_the_board(package))

    # ---- measured -> ready to invoice -> invoice from the measurements ------

    def sent_package(self):
        booking = self.book()
        self.patch(booking, shipping_number="CI-77")
        booking.refresh_from_db()
        return booking, booking.package

    def test_the_warehouse_can_receive_and_measure_it_before_payment(self):
        _, package = self.sent_package()
        self.client.force_authenticate(self.office)

        response = self.client.post(f"{BOARD}{package.pk}/stage/", {"stage": "received"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        response = self.client.post(f"{BOARD}{package.pk}/stage/", {"stage": "measured"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_measured_and_not_invoiced_is_ready_to_invoice(self):
        booking, package = self.sent_package()
        self.assertFalse(self.patch(booking).json()["shipment"]["ready_to_invoice"])

        Package.objects.filter(pk=package.pk).update(warehouse_stage=Package.WarehouseStage.MEASURED)
        self.assertTrue(self.patch(booking).json()["shipment"]["ready_to_invoice"])

    def test_the_invoice_starts_from_the_intake_sheet(self):
        booking, package = self.sent_package()
        sheet = IntakeSheet.objects.create(package=package, status=IntakeSheet.Status.RELEASED)
        Measurement.objects.create(
            sheet=sheet, quantity=2, length_cm=60, width_cm=40, height_cm=40, weight_kg=Decimal("12.5")
        )
        Measurement.objects.create(sheet=sheet, quantity=1, length_cm=120, width_cm=80, height_cm=100, weight_kg=200)

        self.client.force_authenticate(self.office)
        defaults = self.client.get(DEFAULTS, {"package": package.pk}).json()

        self.assertEqual(defaults["measured_by_warehouse"], "intake")
        self.assertEqual(defaults["pieces"], 3)
        self.assertEqual(Decimal(defaults["weight_kg"]), Decimal("225.0"))
        self.assertEqual(
            [(Decimal(row["length_cm"]), row["count"]) for row in defaults["measurements"]],
            [(Decimal("60"), 2), (Decimal("120"), 1)],
        )

    def test_or_from_the_scanner(self):
        _, package = self.sent_package()
        PackageMeasurement.objects.create(
            package=package, worker=self.office, weight_kg=Decimal("18.40"),
            length_cm=50, width_cm=40, height_cm=30,
            volume_m3=Decimal("0.060"), dimensional_weight_kg=Decimal("10.00"),
        )
        self.client.force_authenticate(self.office)
        defaults = self.client.get(DEFAULTS, {"package": package.pk}).json()

        self.assertEqual(defaults["measured_by_warehouse"], "scanner")
        self.assertEqual(defaults["pieces"], 1)
        self.assertEqual(Decimal(defaults["weight_kg"]), Decimal("18.40"))

    def test_not_measured_keeps_the_booking_figures(self):
        _, package = self.sent_package()
        self.client.force_authenticate(self.office)
        defaults = self.client.get(DEFAULTS, {"package": package.pk}).json()
        self.assertIsNone(defaults["measured_by_warehouse"])
        self.assertEqual(defaults["measurements"], [])
        self.assertEqual(defaults["pieces"], 3)  # what the customer declared

    def test_the_customer_does_not_see_the_office_details(self):
        # "My bookings" moves a confirmed booking to "My shipments", so read
        # the customer's serializer directly for a booking that has a shipment.
        from .serializers import MyBookingSerializer

        booking, _ = self.sent_package()
        shipment = MyBookingSerializer(booking).data["shipment"]
        self.assertEqual(set(shipment), {"id", "tracking_number", "status", "status_display"})


class IntakeAndNumberingTests(SendToWarehouseTests):
    """Sending a booking to the warehouse prepares its intake sheet; "Send to
    warehouse" without a number gives it the next PLSM-number."""

    def send(self, booking):
        self.client.force_authenticate(self.office)
        return self.client.post(reverse("staff-booking-send-to-warehouse", args=[booking.pk]))

    def test_sending_prepares_an_intake_sheet_with_the_number_on_it(self):
        booking = self.book()
        self.patch(booking, shipping_number="CI-1234")

        sheet = IntakeSheet.objects.get()
        booking.refresh_from_db()
        self.assertEqual(sheet.reference, "CI-1234")
        self.assertEqual(sheet.status, IntakeSheet.Status.DRAFT)
        self.assertEqual((sheet.booking_id, sheet.package_id), (booking.pk, booking.package_id))
        self.assertEqual(sheet.recipient, booking.recipient_name)
        self.assertEqual(sheet.destination, booking.destination_label)
        self.assertEqual(sheet.freight, booking.freight)
        self.assertEqual(sheet.colli_count, 3)
        self.assertIsNone(sheet.created_by)  # nobody has signed it yet

    def test_saving_again_does_not_make_a_second_sheet(self):
        booking = self.book()
        self.patch(booking, shipping_number="CI-1234")
        self.patch(booking, office_notes="Gebeld")
        self.assertEqual(IntakeSheet.objects.count(), 1)

    def test_send_numbers_the_booking_counting_up(self):
        first, second = self.book(), self.book()

        one = self.send(first)
        two = self.send(second)

        self.assertEqual(one.status_code, 200, one.content)
        self.assertEqual(one.json()["shipping_number"], "PLSM-00001")
        self.assertEqual(two.json()["shipping_number"], "PLSM-00002")
        self.assertEqual(
            sorted(IntakeSheet.objects.values_list("reference", flat=True)), ["PLSM-00001", "PLSM-00002"]
        )
        first.refresh_from_db()
        self.assertEqual(first.package.tracking_number, "PLSM-00001")
        self.assertTrue(self.on_the_board(first.package))

    def test_counting_continues_after_numbers_already_in_use(self):
        old = self.book()
        Booking.objects.filter(pk=old.pk).update(shipping_number="PLSM-00041")
        self.assertEqual(self.send(self.book()).json()["shipping_number"], "PLSM-00042")

    def test_a_number_typed_by_hand_is_kept(self):
        booking = self.book()
        Booking.objects.filter(pk=booking.pk).update(shipping_number="CI-7")
        self.assertEqual(self.send(booking).json()["shipping_number"], "CI-7")

    def test_a_booking_without_an_account_is_refused(self):
        booking = self.book(signed_in=False)
        response = self.send(booking)
        self.assertEqual(response.status_code, 400)
        booking.refresh_from_db()
        self.assertEqual(booking.shipping_number, "")

    def test_the_first_worker_to_save_the_sheet_signs_it(self):
        booking = self.book()
        self.send(booking)
        sheet = IntakeSheet.objects.get()

        self.client.force_authenticate(self.office)
        response = self.client.patch(f"/api/staff/intake/{sheet.pk}/", {"colli_count": 4}, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        sheet.refresh_from_db()
        self.assertEqual(sheet.created_by, self.office)
        self.assertTrue(sheet.employee_name)


class NewSheetNumberTests(SendToWarehouseTests):
    """A new intake sheet gets its number straight away, from the same count."""

    def new_sheet(self, **body):
        self.client.force_authenticate(self.office)
        response = self.client.post("/api/staff/intake/", body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_a_blank_new_sheet_gets_the_next_plsm_number(self):
        self.assertEqual(self.new_sheet()["reference"], "PLSM-00001")
        self.assertEqual(self.new_sheet()["reference"], "PLSM-00002")

    def test_sheets_and_bookings_share_one_count(self):
        self.new_sheet()  # PLSM-00001
        booking = self.book()
        self.client.force_authenticate(self.office)
        sent = self.client.post(reverse("staff-booking-send-to-warehouse", args=[booking.pk])).json()
        self.assertEqual(sent["shipping_number"], "PLSM-00002")
        self.assertEqual(self.new_sheet()["reference"], "PLSM-00003")

    def test_a_reference_typed_by_an_admin_is_kept(self):
        self.office.role = User.Role.ADMIN
        self.office.save()
        self.assertEqual(self.new_sheet(reference="CI-55")["reference"], "CI-55")

    def test_a_sheet_for_a_shipment_takes_its_number(self):
        package = Package.objects.create(user=self.customer, tracking_number="CI-99", status=Package.Status.PAID)
        self.assertEqual(self.new_sheet(package=package.pk)["reference"], "CI-99")


class SheetNumberLockTests(NewSheetNumberTests):
    """The number on a sheet is fixed: nobody may change it, a manager or an
    admin included."""

    def setUp(self):
        super().setUp()
        self.manager = User.objects.create_user(
            username="chef@example.com", email="chef@example.com",
            password="a-long-enough-password", role=User.Role.MANAGER,
        )

    def change(self, user, sheet_id, reference):
        self.client.force_authenticate(user)
        return self.client.patch(f"/api/staff/intake/{sheet_id}/", {"reference": reference}, format="json")

    def test_the_office_cannot_change_it(self):
        sheet = self.new_sheet()
        response = self.change(self.office, sheet["id"], "CI-1")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(IntakeSheet.objects.get(pk=sheet["id"]).reference, "PLSM-00001")

    def test_sending_the_same_number_back_is_fine(self):
        sheet = self.new_sheet()
        self.assertEqual(self.change(self.office, sheet["id"], "PLSM-00001").status_code, 200)

    def test_a_manager_and_an_admin_cannot_either(self):
        sheet = self.new_sheet()
        self.assertEqual(self.change(self.manager, sheet["id"], "CI-1").status_code, 400)
        admin = User.objects.create_user(
            username="baas@example.com", email="baas@example.com",
            password="a-long-enough-password", role=User.Role.ADMIN,
        )
        self.assertEqual(self.change(admin, sheet["id"], "CI-2").status_code, 400)
        self.assertEqual(IntakeSheet.objects.get(pk=sheet["id"]).reference, "PLSM-00001")

    def test_others_cannot_type_one_on_a_new_sheet(self):
        self.assertEqual(self.new_sheet(reference="CI-55")["reference"], "PLSM-00001")

    def test_an_old_sheet_without_a_number_gets_one_when_saved(self):
        old = IntakeSheet.objects.create()
        self.client.force_authenticate(self.office)
        response = self.client.patch(f"/api/staff/intake/{old.pk}/", {"supplier": "Bol.com"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["reference"], "PLSM-00001")
