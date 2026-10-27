"""The default warehouse location (settings WAREHOUSE_DEFAULT_LOCATION).

A package received with no location set gets the default; one that already
has a location keeps it; and the package page offers the default first, then
the locations already in use, while still taking anything typed.
"""

from django.contrib.auth import get_user_model
from django.test import override_settings

from accounts.models import Package
from config.testing import ThrottleFreeAPITestCase

User = get_user_model()
SHIPMENTS = "/api/staff/warehouse/shipments/"


@override_settings(WAREHOUSE_DEFAULT_LOCATION="PAYLESSHOPMORE")
class DefaultLocationTests(ThrottleFreeAPITestCase):
    def setUp(self):
        super().setUp()
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com", password="a-long-enough-password"
        )
        self.office = User.objects.create_user(
            username="kantoor@example.com", email="kantoor@example.com",
            password="a-long-enough-password", role=User.Role.OFFICE,
        )
        self.client.force_authenticate(self.office)

    def package(self, number="PLSM-1", **extra):
        return Package.objects.create(
            user=self.customer, tracking_number=number, status=Package.Status.PAID, **extra
        )

    def receive(self, package):
        response = self.client.post(f"{SHIPMENTS}{package.pk}/stage/", {"stage": "received"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        package.refresh_from_db()
        return response.json()

    def test_a_received_package_gets_the_default_location(self):
        package = self.package()
        self.receive(package)
        self.assertEqual(package.warehouse_location, "PAYLESSHOPMORE")

    def test_a_location_already_set_is_kept(self):
        package = self.package(warehouse_location="B-04")
        self.receive(package)
        self.assertEqual(package.warehouse_location, "B-04")

    def test_no_other_location_can_be_chosen(self):
        package = self.package()
        self.receive(package)
        for other in ("a-12", "CARIBINTERTRANS", ""):
            with self.subTest(other=other):
                response = self.client.post(f"{SHIPMENTS}{package.pk}/location/", {"location": other}, format="json")
                self.assertEqual(response.status_code, 400)
        package.refresh_from_db()
        self.assertEqual(package.warehouse_location, "PAYLESSHOPMORE")

    def test_the_page_offers_the_default_first_then_what_is_in_use(self):
        self.package("PLSM-2", warehouse_location="B-04")
        self.package("PLSM-3", warehouse_location="B-04")
        self.package("PLSM-4", warehouse_location="A-01")
        package = self.package()

        choices = self.client.get(f"{SHIPMENTS}{package.pk}/").json()["location_choices"]

        self.assertEqual(choices["default"], "PAYLESSHOPMORE")
        self.assertEqual(choices["options"], ["PAYLESSHOPMORE", "B-04", "A-01"])

    def test_the_page_offers_the_warehouse(self):
        choices = self.client.get(f"{SHIPMENTS}{self.package().pk}/").json()["location_choices"]
        self.assertEqual(choices["warehouses"], ["PAYLESSHOPMORE"])

    def test_paylesshopmore_can_be_set(self):
        package = self.package()
        response = self.client.post(
            f"{SHIPMENTS}{package.pk}/location/", {"location": "PAYLESSHOPMORE"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        package.refresh_from_db()
        self.assertEqual(package.warehouse_location, "PAYLESSHOPMORE")

    @override_settings(WAREHOUSE_DEFAULT_LOCATION="")
    def test_no_default_when_switched_off(self):
        package = self.package()
        self.receive(package)
        self.assertEqual(package.warehouse_location, "")
