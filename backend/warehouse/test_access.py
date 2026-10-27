"""What warehouse workers may see (WarehouseAccess), set by an admin.

The switches apply to warehouse-only accounts and are enforced by the API,
not just hidden in the app. The office and admins are never limited, and
only an admin may change them.
"""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status

from accounts.models import Package
from config.testing import WarehouseAPITestCase

from .models import WarehouseAccess

User = get_user_model()

URL = reverse("staff-warehouse-access")


class WarehouseAccessTests(WarehouseAPITestCase):
    def setUp(self):
        password = "a-long-enough-password"
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com", password=password,
            first_name="Klaas", last_name="Klant", phone_number="+599 9 123 4567",
        )
        self.floor = User.objects.create_user(
            username="vloer@example.com", email="vloer@example.com", password=password,
            role="warehouse",
        )
        self.office = User.objects.create_user(
            username="kantoor@example.com", email="kantoor@example.com", password=password,
            role="office",
        )
        self.admin = User.objects.create_user(
            username="baas@example.com", email="baas@example.com", password=password,
            role="admin",
        )
        self.package = Package.objects.create(
            user=self.customer, tracking_number="PLS-3001", status=Package.Status.PAID
        )

    def switch(self, **sections):
        self.client.force_authenticate(self.admin)
        response = self.client.put(URL, {"sections": sections}, format="json")
        self.client.force_authenticate(None)
        return response

    def get_as(self, user, url):
        self.client.force_authenticate(user)
        response = self.client.get(url)
        self.client.force_authenticate(None)
        return response

    def test_everything_is_on_until_an_admin_switches_it_off(self):
        response = self.get_as(self.floor, URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(all(response.data["mine"].values()))
        self.assertEqual(
            [choice["key"] for choice in response.data["choices"]],
            list(WarehouseAccess.SECTIONS),
        )
        damage = reverse("staff-warehouse-damage-list")
        self.assertEqual(self.get_as(self.floor, damage).status_code, status.HTTP_200_OK)

    def test_a_switched_off_section_is_refused_to_the_floor_only(self):
        self.assertEqual(self.switch(damage=False, activity=False).status_code, 200)

        for url in (
            reverse("staff-warehouse-damage-list"),
            reverse("staff-warehouse-shipment-damage", args=[self.package.pk]),
            reverse("staff-warehouse-activity-list"),
            reverse("staff-warehouse-shipment-activity", args=[self.package.pk]),
        ):
            self.assertEqual(self.get_as(self.floor, url).status_code, 403, url)
            # The office is never limited.
            self.assertEqual(self.get_as(self.office, url).status_code, 200, url)

        # Sections still on keep working.
        measurements = reverse("staff-warehouse-measurement-list")
        self.assertEqual(self.get_as(self.floor, measurements).status_code, 200)
        # And the package page itself always opens.
        detail = reverse("staff-warehouse-shipment-detail", args=[self.package.pk])
        self.assertEqual(self.get_as(self.floor, detail).status_code, 200)

        mine = self.get_as(self.floor, URL).data["mine"]
        self.assertFalse(mine["damage"])
        self.assertTrue(mine["measurements"])
        self.assertTrue(self.get_as(self.office, URL).data["mine"]["damage"])

    def test_the_intake_sheets_can_be_switched_off(self):
        self.switch(intake=False)
        url = reverse("staff-intake-list")
        self.assertEqual(self.get_as(self.floor, url).status_code, 403)
        self.assertEqual(self.get_as(self.office, url).status_code, 200)

    def test_customer_phone_is_hidden_when_switched_off(self):
        detail = reverse("staff-warehouse-shipment-detail", args=[self.package.pk])
        self.assertEqual(self.get_as(self.floor, detail).data["customer_phone"], "+599 9 123 4567")

        self.switch(customer_contact=False)
        self.assertEqual(self.get_as(self.floor, detail).data["customer_phone"], "")
        self.assertEqual(self.get_as(self.office, detail).data["customer_phone"], "+599 9 123 4567")

    def test_only_an_admin_may_change_the_switches(self):
        for user in (self.floor, self.office, self.customer):
            self.client.force_authenticate(user)
            response = self.client.put(URL, {"sections": {"damage": False}}, format="json")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(WarehouseAccess.current().allows("damage"))

    def test_a_customer_cannot_read_them(self):
        self.assertEqual(self.get_as(self.customer, URL).status_code, 403)

    def test_unknown_switches_are_refused(self):
        self.assertEqual(self.switch(everything=False).status_code, 400)

    def test_switching_one_leaves_the_others(self):
        self.switch(damage=False)
        self.switch(photos=False)
        access = WarehouseAccess.current()
        self.assertFalse(access.allows("damage"))
        self.assertFalse(access.allows("photos"))
        self.assertTrue(access.allows("measurements"))
