"""The warehouse manager: the warehouse floor's admin, and nothing beyond it.

What a manager may do - warehouse workers' accounts, sign-in codes and PINs,
floor devices and locations, the Warehouse access switches, and the warehouse
itself without the floor's limits - and what stays closed to them: the office
(invoices, customers, quotes, the overview), every account that is not a
warehouse worker, roles, deleting accounts, and Django's own /admin/.
"""

from django.core import mail
from django.test import override_settings

from warehouse.models import WarehouseAccess

from . import floor
from .models import FloorLocation, User, WarehousePin
from .test_floor import PIN, FloorTestCase, make_account

CUSTOMERS = "/api/staff/customers/"
LOCATIONS = "/api/staff/floor-locations/"
DEVICES = "/api/staff/floor-devices/"
EVENTS = "/api/staff/floor-events/"
ACCESS = "/api/staff/warehouse/access/"
SIGN_IN_CODE = "/api/staff/workers/sign-in-code/"
INTAKE = "/api/staff/intake/"


def reset_pin_url(user):
    return f"/api/staff/workers/{user.pk}/reset-pin/"


class WarehouseManagerTestCase(FloorTestCase):
    def setUp(self):
        super().setUp()
        self.manager = make_account("chef@example.com", User.Role.MANAGER, "Max", "Chef")
        self.client.force_login(self.manager)


class RoleTests(WarehouseManagerTestCase):
    def test_the_role_is_the_floor_without_the_office(self):
        self.assertFalse(self.manager.is_staff)
        self.assertTrue(self.manager.is_warehouse)
        self.assertTrue(self.manager.is_warehouse_manager)
        self.assertTrue(self.manager.can_manage_warehouse)
        # Not limited the way a warehouse worker is.
        self.assertFalse(self.manager.is_warehouse_worker_only)

    def test_a_flag_change_does_not_turn_a_manager_into_a_worker(self):
        self.manager.first_name = "Maxim"
        self.manager.save()
        self.manager.refresh_from_db()
        self.assertEqual(self.manager.role, User.Role.MANAGER)

    def test_only_an_admin_can_make_somebody_a_manager(self):
        url = f"{CUSTOMERS}{self.worker.pk}/role/"
        for account in (self.manager, self.office):
            self.client.force_login(account)
            self.assertEqual(self.client.post(url, {"role": "manager"}, format="json").status_code, 403)

        self.client.force_login(self.admin)
        response = self.client.post(url, {"role": "manager"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.worker.refresh_from_db()
        self.assertEqual(self.worker.role, User.Role.MANAGER)


class RunningTheFloorTests(WarehouseManagerTestCase):
    def test_manages_locations_and_device_grants(self):
        created = self.client.post(LOCATIONS, {"name": "Packing area", "sections": ["packaging"]}, format="json")
        self.assertEqual(created.status_code, 201)
        location = FloorLocation.objects.get(name="Packing area")

        granted = self.client.post(
            f"{DEVICES}{self.device.pk}/grant-location/", {"location": location.pk}, format="json"
        )
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(self.client.get(DEVICES).status_code, 200)
        self.assertEqual(self.client.get(EVENTS).status_code, 200)

    def test_sets_the_warehouse_access_switches(self):
        response = self.client.put(ACCESS, {"sections": {"damage": False}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(WarehouseAccess.current().allows("damage"))

    def test_resets_a_workers_pin(self):
        response = self.client.post(reset_pin_url(self.worker))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(WarehousePin.objects.filter(user=self.worker).exists())

    @override_settings(WAREHOUSE_CODE_ON_SCREEN="0")
    def test_sends_a_warehouse_worker_a_sign_in_code(self):
        response = self.client.post(SIGN_IN_CODE, {"email": self.worker.email}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mail.outbox[-1].to, [self.worker.email])

    def test_uses_the_warehouse_with_a_password_and_no_pin(self):
        # Office-like: no code or PIN step, and the access switches do not apply.
        WarehouseAccess.objects.update_or_create(pk=1, defaults={"sections": {"intake": False}})
        self.assertEqual(self.client.get(INTAKE).status_code, 200)
        profile = self.client.get("/api/profile/").json()
        self.assertTrue(profile["warehouse_unlocked"])


class WorkersPageTests(WarehouseManagerTestCase):
    def test_sees_warehouse_workers_and_nobody_else(self):
        response = self.client.get(CUSTOMERS, {"page_size": 100})
        self.assertEqual(response.status_code, 200)
        emails = {row["email"] for row in response.json()["results"]}
        self.assertEqual(emails, {self.worker.email, self.other.email})

    def test_cannot_open_anybody_outside_the_floor(self):
        for account in (self.customer, self.office, self.admin, self.manager):
            self.assertEqual(self.client.get(f"{CUSTOMERS}{account.pk}/").status_code, 404, account.role)
            self.assertEqual(
                self.client.patch(f"{CUSTOMERS}{account.pk}/", {"phone_number": "1"}, format="json").status_code,
                404,
                account.role,
            )

    def test_corrects_a_warehouse_workers_details(self):
        response = self.client.patch(
            f"{CUSTOMERS}{self.worker.pk}/", {"phone_number": "+599 9 765 4321"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.worker.refresh_from_db()
        self.assertEqual(self.worker.phone_number, "+599 9 765 4321")

    def test_opens_warehouse_worker_accounts_only(self):
        made = self.client.post(
            CUSTOMERS,
            {"first_name": "Nina", "last_name": "Nieuw", "email": "nina@example.com",
             "phone_number": "+599 9 123 4567", "role": "warehouse"},
            format="json",
        )
        self.assertEqual(made.status_code, 201, made.content)
        self.assertEqual(User.objects.get(email="nina@example.com").role, User.Role.WAREHOUSE)

        for role in ("customer", "office", "admin", "manager", "driver"):
            refused = self.client.post(
                CUSTOMERS,
                {"first_name": "X", "last_name": "Y", "email": f"{role}@new.example.com",
                 "phone_number": "+599 9 123 4567", "role": role},
                format="json",
            )
            self.assertEqual(refused.status_code, 403, role)
            self.assertFalse(User.objects.filter(email=f"{role}@new.example.com").exists())

    def test_cannot_change_roles_delete_accounts_or_edit_addresses(self):
        url = f"{CUSTOMERS}{self.worker.pk}"
        self.assertEqual(self.client.post(f"{url}/role/", {"role": "office"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"{url}/").status_code, 403)
        self.assertEqual(
            self.client.post(f"{url}/address/", {"street": "S", "house_number": "1", "city": "C"}, format="json")
            .status_code,
            403,
        )
        self.worker.refresh_from_db()
        self.assertEqual(self.worker.role, User.Role.WAREHOUSE)
        self.assertTrue(self.worker.is_active)

    def test_the_table_does_not_offer_role_changes(self):
        row = self.client.get(f"{CUSTOMERS}{self.worker.pk}/").json()
        self.assertFalse(row["can_change_role"])


class TheOfficeStaysClosedTests(WarehouseManagerTestCase):
    def test_office_screens_are_refused(self):
        for url in (
            "/api/staff/overview/",
            "/api/staff/invoices/",
            "/api/staff/quotes/",
            "/api/staff/messages/",
            "/api/staff/bookings/",
            "/api/staff/packages/",
            "/api/staff/shops/",
            "/api/staff/blog/",
            "/api/staff/request-origin/",
        ):
            self.assertEqual(self.client.get(url).status_code, 403, url)

    def test_django_admin_is_closed(self):
        response = self.client.get("/admin/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/admin/login/", response["Location"])

    def test_a_warehouse_worker_cannot_do_any_of_this(self):
        floor.set_pin(self.other, PIN)
        self.client.force_login(self.worker)
        self.assertEqual(self.client.get(LOCATIONS).status_code, 403)
        self.assertEqual(self.client.put(ACCESS, {"sections": {}}, format="json").status_code, 403)
        self.assertEqual(self.client.post(reset_pin_url(self.other)).status_code, 403)
        self.assertEqual(self.client.get(CUSTOMERS).status_code, 403)
        self.assertTrue(WarehousePin.objects.filter(user=self.other).exists())
