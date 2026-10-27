"""Roles, and the warehouse's package operations: measure, pack, damage, activity."""

import io
import shutil
import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status

from accounts.models import Package, PackageEvent
from config.testing import WarehouseAPITestCase

from .models import (
    ImmutableRecord,
    PackageActivity,
    PackageDamagePhoto,
    PackageDamageReport,
    PackageMeasurement,
)

User = get_user_model()

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def make_user(email, **extra):
    return User.objects.create_user(
        username=email, email=email, password="a-long-enough-password", **extra
    )


class RoleModelTests(TestCase):
    def test_each_role_sets_its_flags(self):
        for role, staff, warehouse in (
            ("admin", True, False),
            # The office does the desk work and the floor: both flags.
            ("office", True, True),
            ("warehouse", False, True),
            ("driver", False, False),
            ("customer", False, False),
        ):
            with self.subTest(role=role):
                user = make_user(f"{role}@example.com", role=role)
                self.assertEqual((user.is_staff, user.is_warehouse), (staff, warehouse))

    def test_flags_set_the_old_way_become_a_role(self):
        self.assertEqual(make_user("a@example.com", is_staff=True).role, "admin")
        self.assertEqual(make_user("w@example.com", is_warehouse=True).role, "warehouse")

    def test_changing_the_role_moves_both_flags(self):
        """Both are written from the role, so neither is left behind.

        Warehouse to admin moves each of them in a different direction, which
        is the case a one-flag write would get wrong: a floor worker promoted
        to admin must gain /admin/ and lose nothing quietly, and must not keep
        being counted among the floor.
        """
        user = make_user("x@example.com", role="warehouse")
        user.role = User.Role.ADMIN
        user.save(update_fields=["role"])
        user.refresh_from_db()
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_warehouse)

    def test_the_office_is_promoted_onto_the_floor_as_well(self):
        user = make_user("x@example.com", role="warehouse")
        user.role = User.Role.OFFICE
        user.save(update_fields=["role"])
        user.refresh_from_db()
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_warehouse)

    def test_an_office_worker_stays_office_when_a_flag_moves(self):
        user = make_user("o@example.com", role="office")
        user.is_warehouse = False
        user.save()
        user.refresh_from_db()
        self.assertEqual(user.role, "office")

    def test_only_admins_are_admins(self):
        self.assertTrue(make_user("a@example.com", role="admin").is_admin)
        self.assertFalse(make_user("o@example.com", role="office").is_admin)


class RoleApiTests(WarehouseAPITestCase):
    def setUp(self):
        self.admin = make_user("admin@example.com", role="admin")
        self.office = make_user("office@example.com", role="office")
        self.floor = make_user("floor@example.com", role="warehouse")
        self.driver = make_user("driver@example.com", role="driver")
        self.customer = make_user("klant@example.com", phone_number="+599 9 123 4567")

    def test_an_office_worker_cannot_change_roles(self):
        self.client.force_authenticate(self.office)
        response = self.client.post(
            reverse("staff-customer-role", args=[self.customer.pk]), {"role": "admin"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.role, "customer")

    def test_an_admin_can_make_a_driver(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            reverse("staff-customer-role", args=[self.customer.pk]), {"role": "driver"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["role"], "driver")

    def test_an_office_worker_cannot_open_a_staff_account(self):
        self.client.force_authenticate(self.office)
        response = self.client.post(
            reverse("staff-customer-list"),
            {
                "first_name": "N",
                "last_name": "N",
                "email": "new@example.com",
                "phone_number": "+599 9 000 0000",
                "role": "warehouse",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(User.objects.filter(email="new@example.com").exists())

    def test_a_warehouse_worker_is_kept_out_of_the_office(self):
        self.client.force_authenticate(self.floor)
        for name in ("staff-package-list", "staff-customer-list", "staff-invoice-list", "staff-overview"):
            with self.subTest(route=name):
                self.assertEqual(
                    self.client.get(reverse(name)).status_code, status.HTTP_403_FORBIDDEN
                )

    def test_a_driver_has_no_warehouse_access(self):
        self.client.force_authenticate(self.driver)
        for name in (
            "staff-warehouse-shipment-board",
            "staff-warehouse-activity-list",
            "staff-warehouse-measurement-list",
            "staff-warehouse-damage-list",
        ):
            with self.subTest(route=name):
                self.assertEqual(
                    self.client.get(reverse(name)).status_code, status.HTTP_403_FORBIDDEN
                )

    def test_the_profile_carries_the_role(self):
        self.client.force_authenticate(self.floor)
        self.assertEqual(self.client.get(reverse("profile")).data["role"], "warehouse")


class OperationsTestCase(WarehouseAPITestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media_root)
        override.enable()
        self.addCleanup(override.disable)

        self.customer = make_user("klant@example.com", first_name="Klaas", last_name="Klant")
        self.floor = make_user("vloer@example.com", role="warehouse", first_name="Wim")
        self.office = make_user("kantoor@example.com", role="office")
        self.package = Package.objects.create(
            user=self.customer,
            tracking_number="PLS-2001",
            status=Package.Status.PAID,
            warehouse_stage=Package.WarehouseStage.RECEIVED,
        )
        self.client.force_authenticate(self.floor)

    def url(self, name, *args):
        return reverse(f"staff-warehouse-shipment-{name}", args=args)

    def measure(self, **overrides):
        body = {"weight_kg": "12.5", "length_cm": "60", "width_cm": "40", "height_cm": "30"}
        body.update(overrides)
        return self.client.post(self.url("measurements", self.package.pk), body, format="json")

    def actions(self):
        return list(
            PackageActivity.objects.filter(package=self.package)
            .order_by("timestamp", "id")
            .values_list("action", flat=True)
        )


class MeasurementTests(OperationsTestCase):
    def test_a_measurement_is_saved_under_the_signed_in_worker(self):
        response = self.measure(worker=self.office.pk)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        measurement = PackageMeasurement.objects.get()
        self.assertEqual(measurement.worker, self.floor)
        self.assertEqual(measurement.volume_m3, Decimal("0.0720"))
        # 60 × 40 × 30 / 6000
        self.assertEqual(measurement.dimensional_weight_kg, Decimal("12.00"))
        self.assertEqual(response.data["measurement"]["worker"]["id"], self.floor.pk)
        self.assertIsNotNone(response.data["measurement"]["date"])
        # Measured, then on to "Waiting for packaging" by itself (automatic stages).
        self.assertEqual(response.data["shipment"]["warehouse_stage"], "awaiting_packaging")
        self.assertEqual(
            self.actions(), ["measurement_completed", "package_status_changed", "package_status_changed"]
        )

    def test_remeasuring_keeps_the_history(self):
        self.measure()
        self.measure(weight_kg="13")

        first, second = PackageMeasurement.objects.order_by("measured_at", "id")
        self.assertEqual(second.supersedes, first)
        self.assertIn("measurement_updated", self.actions())

    def test_bad_values_are_refused_and_nothing_is_written(self):
        for field, value in (
            ("weight_kg", "0"),
            ("weight_kg", "-3"),
            ("weight_kg", "99999"),
            ("length_cm", "abc"),
            ("width_cm", ""),
            ("height_cm", "NaN"),
            ("weight_kg", "1.234"),
        ):
            with self.subTest(field=field, value=value):
                response = self.measure(**{field: value})
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn(field, response.data)
        self.assertFalse(PackageMeasurement.objects.exists())
        self.assertFalse(PackageActivity.objects.exists())

    def test_the_office_sees_the_measurement_straight_away(self):
        self.measure()
        self.client.force_authenticate(self.office)

        row = self.client.get(reverse("staff-package-detail", args=[self.package.pk])).data
        self.assertEqual(row["measurement"]["weight_kg"], "12.50")
        self.assertEqual(row["workflow_status"], "waiting_for_packaging")

    def test_a_shipment_that_has_left_cannot_be_measured(self):
        Package.objects.filter(pk=self.package.pk).update(status=Package.Status.IN_TRANSIT)
        self.assertEqual(self.measure().status_code, status.HTTP_409_CONFLICT)

    def test_a_customer_cannot_measure(self):
        self.client.force_authenticate(self.customer)
        self.assertEqual(self.measure().status_code, status.HTTP_403_FORBIDDEN)


class PackagingTests(OperationsTestCase):
    def pack(self, **body):
        return self.client.post(self.url("packaging", self.package.pk), body, format="json")

    def test_bubble_wrap_is_recorded(self):
        self.measure()
        response = self.pack(packaging_type="bubble_wrap", quantity=2, notes="Fragile")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["packaging"]["worker"]["id"], self.floor.pk)
        self.assertEqual(response.data["shipment"]["warehouse_stage"], "awaiting_packaging")
        self.assertIn("bubble_wrap_added", self.actions())

    def test_other_needs_notes_and_quantity_must_be_sane(self):
        self.assertEqual(self.pack(packaging_type="other").status_code, 400)
        self.assertEqual(self.pack(packaging_type="tape", quantity=0).status_code, 400)
        self.assertEqual(self.pack(packaging_type="tape", quantity="x").status_code, 400)
        self.assertEqual(self.pack(packaging_type="glue").status_code, 400)


class DamageTests(OperationsTestCase):
    def report(self, photos=(), **body):
        data = {"damage_type": "box_damaged", "description": "Corner crushed", **body}
        if photos:
            data["photos"] = list(photos)
        return self.client.post(self.url("damage", self.package.pk), data, format="multipart")

    def test_a_report_with_a_photo(self):
        response = self.report(photos=[SimpleUploadedFile("x.png", PNG, content_type="image/png")])

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        report = PackageDamageReport.objects.get()
        self.assertEqual(report.worker, self.floor)
        self.assertEqual(report.resolution_status, "open")
        photo = PackageDamagePhoto.objects.get()
        self.assertEqual(photo.content_type, "image/png")
        self.assertEqual(self.actions(), ["damage_reported"])

        served = self.client.get(response.data["damage_report"]["photos"][0]["url"].replace("/staff", "/api/staff", 1))
        self.assertEqual(served.status_code, status.HTTP_200_OK)
        self.assertEqual(served["Content-Type"], "image/png")

    def test_the_office_is_emailed_once_with_the_photo(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.report(photos=[SimpleUploadedFile("x.png", PNG, content_type="image/png")])
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        # The office account, and not the warehouse worker who reported it.
        self.assertEqual(sent.to, ["kantoor@example.com"])
        self.assertIn("PLS-2001", sent.subject)
        self.assertIn("Corner crushed", sent.body)
        self.assertEqual(len(sent.attachments), 1)
        self.assertEqual(sent.attachments[0][2], "image/png")

        # A retry of the same job sends nothing more.
        from .tasks import send_damage_report_email

        send_damage_report_email.apply(args=[PackageDamageReport.objects.get().pk])
        self.assertEqual(len(mail.outbox), 1)

    def test_an_office_member_who_turned_warehouse_mail_off_is_not_emailed(self):
        self.office.notify_warehouse = False
        self.office.save()
        with self.captureOnCommitCallbacks(execute=True):
            self.report()
        self.assertEqual(mail.outbox, [])

    def test_a_file_that_is_not_an_image_is_refused(self):
        fake = SimpleUploadedFile("x.jpg", b"<html>not a photo</html>", content_type="image/jpeg")
        response = self.report(photos=[fake])
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PackageDamageReport.objects.exists())

    def test_resolving_happens_once(self):
        report_id = self.report().data["damage_report"]["id"]
        url = reverse("staff-warehouse-damage-resolve", args=[report_id])

        first = self.client.post(url, {"note": "Repacked"}, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data["resolved_by"]["id"], self.floor.pk)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 409)
        self.assertEqual(self.actions(), ["damage_reported", "damage_resolved"])

    def test_the_open_list_and_the_board_count_it(self):
        self.report()
        rows = self.client.get(reverse("staff-warehouse-damage-list"), {"status": "open"}).data
        self.assertEqual(rows["count"], 1)
        board = self.client.get(self.url("board")).data
        self.assertEqual(board["damaged"], 1)
        self.assertEqual(board["attention"], 1)


class StageRuleTests(OperationsTestCase):
    def move(self, stage):
        return self.client.post(self.url("stage", self.package.pk), {"stage": stage}, format="json")

    def test_a_worker_cannot_set_office_or_dispatch_stages(self):
        for stage in ("awaiting_pickup", "shipped"):
            with self.subTest(stage=stage):
                self.assertEqual(self.move(stage).status_code, status.HTTP_403_FORBIDDEN)

    def test_the_detail_says_which_stages_are_allowed(self):
        stages = self.client.get(self.url("detail", self.package.pk)).data["allowed_stages"]
        self.assertNotIn("shipped", stages)
        self.assertIn("packed", stages)

    def test_ready_needs_a_measurement_and_no_open_damage(self):
        self.assertEqual(self.move("ready").status_code, status.HTTP_409_CONFLICT)
        self.measure()
        PackageDamageReport.objects.create(
            package=self.package, worker=self.floor, damage_type="wet_package"
        )
        self.assertEqual(self.move("ready").status_code, status.HTTP_409_CONFLICT)
        PackageDamageReport.objects.get().resolve(self.floor)

        response = self.move("ready")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["workflow_status"], "ready_for_shipping")
        self.assertEqual(self.actions()[-1], "package_marked_ready")

    def test_the_whole_floor_workflow(self):
        self.client.post(self.url("scanned", self.package.pk), {"code": "PLS-2001"}, format="json")
        self.measure()
        self.client.post(
            self.url("packaging", self.package.pk), {"packaging_type": "box"}, format="json"
        )
        self.move("packed")  # Ready follows by itself: measured, nothing open

        self.assertEqual(
            self.actions(),
            [
                "package_scanned",
                "measurement_completed",
                "package_status_changed",  # -> Measured
                "package_status_changed",  # -> Waiting for packaging (automatic)
                "packaging_added",
                "package_packed",
                "package_marked_ready",  # automatic
            ],
        )
        self.package.refresh_from_db()
        self.assertEqual(self.package.warehouse_stage, "ready")


class ReportTests(OperationsTestCase):
    def test_the_day_is_counted_per_worker(self):
        self.measure()
        self.client.post(self.url("packaging", self.package.pk), {"packaging_type": "tape"}, format="json")
        self.client.force_authenticate(self.office)

        data = self.client.get(reverse("staff-warehouse-report")).data
        self.assertEqual(data["totals"]["measured"], 1)
        self.assertEqual(data["totals"]["packaging"], 1)
        self.assertEqual([row["name"] for row in data["workers"]], ["Wim"])

        csv_response = self.client.get(reverse("staff-warehouse-report"), {"export": "csv"})
        self.assertEqual(csv_response["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("Wim,0,0,1,1,0,0,0", csv_response.content.decode())

    def test_the_floor_cannot_read_the_report_and_bad_dates_are_refused(self):
        self.assertEqual(self.client.get(reverse("staff-warehouse-report")).status_code, 403)
        self.client.force_authenticate(self.office)
        response = self.client.get(reverse("staff-warehouse-report"), {"date": "yesterday"})
        self.assertEqual(response.status_code, 400)

    def test_the_command_mails_the_office(self):
        from django.core.management import call_command

        self.measure()
        call_command("send_warehouse_report", stdout=io.StringIO())
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["kantoor@example.com"])
        self.assertTrue(mail.outbox[0].attachments[0][0].endswith(".csv"))


class ActivityTests(OperationsTestCase):
    def test_activity_rows_cannot_be_changed_or_deleted(self):
        self.measure()
        row = PackageActivity.objects.first()

        row.description = "rewritten"
        with self.assertRaises(ImmutableRecord):
            row.save()
        with self.assertRaises(ImmutableRecord):
            row.delete()
        with self.assertRaises(ImmutableRecord):
            PackageActivity.objects.all().update(description="x")
        with self.assertRaises(ImmutableRecord):
            PackageActivity.objects.all().delete()
        with self.assertRaises(ImmutableRecord):
            PackageMeasurement.objects.first().save()

    def test_the_timeline_merges_office_status_changes_in_order(self):
        self.measure()
        PackageEvent.objects.create(
            package=self.package,
            kind=PackageEvent.Kind.STATUS_CHANGED,
            actor=self.office,
            context={"from_status": "paid", "to_status": "purchased"},
        )

        timeline = self.client.get(self.url("activity", self.package.pk)).data
        self.assertEqual(
            [entry["action"] for entry in timeline],
            [
                "measurement_completed",
                "package_status_changed",
                "package_status_changed",
                "shipment_status_changed",
            ],
        )
        self.assertEqual(timeline[0]["user"]["name"], "Wim")
        self.assertEqual(timeline[3]["description"], "Paid → Products purchased")

    def test_mine_and_package_filters(self):
        self.measure()
        url = reverse("staff-warehouse-activity-list")
        # The measurement, and the two stage moves it set off.
        self.assertEqual(self.client.get(url, {"mine": "true"}).data["count"], 3)
        self.client.force_authenticate(self.office)
        self.assertEqual(self.client.get(url, {"mine": "true"}).data["count"], 0)
        self.assertEqual(self.client.get(url, {"package": self.package.pk}).data["count"], 3)
        self.assertEqual(self.client.get(url, {"package": "1 OR 1=1"}).status_code, 400)

    def test_package_ids_are_validated(self):
        self.assertEqual(self.client.get("/api/staff/warehouse/shipments/abc/").status_code, 404)
        self.assertEqual(self.client.get(self.url("detail", 999999)).status_code, 404)

    def test_location_is_set_and_logged(self):
        response = self.client.post(
            self.url("location", self.package.pk), {"location": "paylesshopmore"}, format="json"
        )
        # The one fixed warehouse (settings WAREHOUSE_DEFAULT_LOCATION).
        self.assertEqual(response.data["warehouse_location"], "PAYLESSHOPMORE")
        self.assertEqual(self.actions(), ["location_changed"])

    def test_a_worker_with_history_is_anonymised_rather_than_deleted(self):
        self.measure()
        self.client.force_authenticate(self.floor)
        response = self.client.post(
            reverse("account-delete"), {"current_password": "a-long-enough-password"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["anonymised"])
        self.assertEqual(PackageMeasurement.objects.get().worker_id, self.floor.pk)


class AutomaticStageTests(OperationsTestCase):
    """The stage follows the work by itself (warehouse/operations.py,
    "automatic stages"); the Move to buttons are for corrections."""

    def move(self, stage):
        return self.client.post(self.url("stage", self.package.pk), {"stage": stage}, format="json")

    def stage(self):
        self.package.refresh_from_db()
        return self.package.warehouse_stage

    def test_scanning_an_expected_package_receives_it(self):
        self.package.warehouse_stage = Package.WarehouseStage.AWAITING_PICKUP
        self.package.save(update_fields=["warehouse_stage"])

        self.client.post(self.url("scanned", self.package.pk), {"code": "PLS-2001"}, format="json")

        self.assertEqual(self.stage(), "awaiting_measurement")
        self.package.refresh_from_db()
        self.assertIsNotNone(self.package.received_at)
        reasons = [e.context.get("reason") for e in self.package.events.order_by("at", "id")]
        self.assertEqual(
            reasons,
            ["automatic: scanned at the warehouse", "automatic: received, waiting to be measured"],
        )

    def test_scanning_a_package_further_along_changes_nothing(self):
        self.measure()
        self.client.post(self.url("scanned", self.package.pk), {"code": "PLS-2001"}, format="json")
        self.assertEqual(self.stage(), "awaiting_packaging")

    def test_packed_waits_while_damage_is_open(self):
        self.measure()
        PackageDamageReport.objects.create(package=self.package, worker=self.floor, damage_type="wet_package")
        self.move("packed")
        self.assertEqual(self.stage(), "packed")

    def test_packed_without_a_measurement_stays_packed(self):
        self.move("packed")
        self.assertEqual(self.stage(), "packed")

    def test_a_correction_backwards_sticks(self):
        self.measure()
        self.move("packed")
        self.assertEqual(self.stage(), "ready")
        self.move("awaiting_packaging")
        self.assertEqual(self.stage(), "awaiting_packaging")


class IntakeMeasurementTests(OperationsTestCase):
    """The warehouse measures once, on the intake form; the package uses it
    (operations.measure_from_intake) and the package page skips measuring."""

    def save_sheet(self, lines, sheet_id=None):
        body = {"package": self.package.pk, "measurements": lines}
        if sheet_id is None:
            return self.client.post(reverse("staff-intake-list"), body, format="json")
        return self.client.patch(reverse("staff-intake-detail", args=[sheet_id]), body, format="json")

    def line(self, **overrides):
        line = {"quantity": 1, "length_cm": "60", "width_cm": "40", "height_cm": "30", "weight_kg": "12.5"}
        line.update(overrides)
        return line

    def stage(self):
        self.package.refresh_from_db()
        return self.package.warehouse_stage

    def test_one_item_on_the_sheet_becomes_the_package_measurement(self):
        response = self.save_sheet([self.line()])

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        measurement = PackageMeasurement.objects.get(package=self.package)
        self.assertEqual(measurement.weight_kg, Decimal("12.5"))
        self.assertEqual(
            (measurement.length_cm, measurement.width_cm, measurement.height_cm),
            (Decimal("60"), Decimal("40"), Decimal("30")),
        )
        # Measured, and on to packaging by itself.
        self.assertEqual(self.stage(), "awaiting_packaging")

    def test_saving_the_same_sheet_again_adds_no_second_measurement(self):
        sheet_id = self.save_sheet([self.line()]).data["id"]
        self.save_sheet([self.line()], sheet_id)
        self.assertEqual(PackageMeasurement.objects.filter(package=self.package).count(), 1)

    def test_a_correction_on_the_sheet_replaces_the_measurement(self):
        sheet_id = self.save_sheet([self.line()]).data["id"]
        self.save_sheet([self.line(weight_kg="14")], sheet_id)

        newest = PackageMeasurement.objects.filter(package=self.package).first()
        self.assertEqual(newest.weight_kg, Decimal("14"))
        self.assertIsNotNone(newest.supersedes)

    def test_several_items_count_as_measured_without_one_box_size(self):
        self.save_sheet([self.line(quantity=3), self.line(length_cm="100")])

        self.assertFalse(PackageMeasurement.objects.filter(package=self.package).exists())
        self.assertEqual(self.stage(), "awaiting_packaging")
        shipment = self.client.get(self.url("detail", self.package.pk)).data
        self.assertTrue(shipment["intake_measured"])

    def test_a_half_filled_sheet_does_not_count(self):
        self.save_sheet([self.line(), self.line(weight_kg=None)])

        self.assertEqual(self.stage(), "received")
        self.assertFalse(PackageMeasurement.objects.filter(package=self.package).exists())

    def test_ready_for_shipping_accepts_the_intake_measurement(self):
        self.client.force_authenticate(self.office)
        self.save_sheet([self.line(quantity=2)])
        response = self.client.post(self.url("stage", self.package.pk), {"stage": "ready"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

    def test_measuring_on_the_package_page_fills_the_intake_form(self):
        from .models import IntakeSheet

        sheet = IntakeSheet.objects.create(package=self.package)
        self.measure()

        line = sheet.measurements.get()
        self.assertEqual(
            (line.quantity, line.length_cm, line.width_cm, line.height_cm, line.weight_kg),
            (1, Decimal("60"), Decimal("40"), Decimal("30"), Decimal("12.5")),
        )
        # Saving the form afterwards does not measure the package again.
        self.save_sheet([self.line()], sheet.pk)
        self.assertEqual(PackageMeasurement.objects.filter(package=self.package).count(), 1)

    def test_a_released_or_multi_box_form_is_left_alone(self):
        from .models import IntakeSheet

        sheet = IntakeSheet.objects.create(package=self.package)
        sheet.measurements.create(quantity=3, length_cm=10, width_cm=10, height_cm=10, weight_kg=1)
        self.measure()
        self.assertEqual(sheet.measurements.get().quantity, 3)
