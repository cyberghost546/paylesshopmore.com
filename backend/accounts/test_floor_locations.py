"""Floor locations: which areas of the warehouse each floor device may be used in.

A location is an area ("Packing area") plus the warehouse sections worked
there. A floor device is granted locations; on that device, only those
locations' sections can be used. Deny by default once any location exists.
"""

from django.urls import reverse

from . import floor
from .models import FloorDeviceAccess, FloorEvent, FloorLocation
from .test_floor import FloorTestCase

LOCATIONS_URL = reverse("staff-floor-location-list")
DEVICES_URL = reverse("staff-floor-device-list")
ACCESS_URL = reverse("staff-warehouse-access")
MEASUREMENTS_URL = reverse("staff-warehouse-measurement-list")
DAMAGE_URL = reverse("staff-warehouse-damage-list")
SHIPMENTS_URL = reverse("staff-warehouse-shipment-list")


def grant_url(device):
    return reverse("staff-floor-device-grant-location", args=[device.pk])


def revoke_url(device):
    return reverse("staff-floor-device-revoke-location", args=[device.pk])


class LocationAdminTests(FloorTestCase):
    """Only admins manage locations and grants, and every grant is on record."""

    def test_admin_creates_a_location_with_its_sections(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            LOCATIONS_URL,
            {"name": "Packing area", "sections": ["packaging", "measurements"]},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        # Stored in the page's order, whatever order they were sent in.
        self.assertEqual(response.data["sections"], ["measurements", "packaging"])

    def test_unknown_sections_are_refused(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            LOCATIONS_URL, {"name": "Roof", "sections": ["launch_codes"]}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("launch_codes", str(response.data["sections"]))

    def test_names_are_unique(self):
        FloorLocation.objects.create(name="Packing area")
        self.client.force_authenticate(self.admin)
        response = self.client.post(LOCATIONS_URL, {"name": "Packing area"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_office_and_warehouse_accounts_cannot_manage_locations_or_grants(self):
        location = FloorLocation.objects.create(name="Packing area")
        for account in (self.office, self.worker, self.customer):
            self.client.force_authenticate(account)
            self.assertEqual(self.client.get(LOCATIONS_URL).status_code, 403)
            self.assertEqual(
                self.client.post(LOCATIONS_URL, {"name": "X"}, format="json").status_code, 403
            )
            self.assertEqual(
                self.client.post(
                    grant_url(self.device), {"location": location.pk}, format="json"
                ).status_code,
                403,
            )
        self.assertFalse(FloorDeviceAccess.objects.exists())

    def test_grant_and_revoke_are_recorded_with_the_admin(self):
        location = FloorLocation.objects.create(name="Packing area", sections=["packaging"])
        self.client.force_authenticate(self.admin)

        granted = self.client.post(grant_url(self.device), {"location": location.pk}, format="json")
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.data["locations"], [{"id": location.pk, "name": "Packing area"}])

        revoked = self.client.post(revoke_url(self.device), {"location": location.pk}, format="json")
        self.assertEqual(revoked.status_code, 200)
        self.assertEqual(revoked.data["locations"], [])

        kinds = list(
            FloorEvent.objects.filter(device=self.device)
            .order_by("created_at", "id")
            .values_list("kind", "actor", "location_name")
        )
        self.assertEqual(
            kinds,
            [
                (FloorEvent.Kind.ACCESS_GRANTED, self.admin.pk, "Packing area"),
                (FloorEvent.Kind.ACCESS_REVOKED, self.admin.pk, "Packing area"),
            ],
        )

    def test_a_revoked_device_cannot_be_granted_anything(self):
        location = FloorLocation.objects.create(name="Packing area")
        floor.revoke_device(self.device, self.admin)
        self.client.force_authenticate(self.admin)

        response = self.client.post(grant_url(self.device), {"location": location.pk}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(FloorDeviceAccess.objects.exists())

    def test_an_unknown_location_is_refused(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(grant_url(self.device), {"location": 99999}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_the_audit_trail_names_the_location_after_it_is_deleted(self):
        location = FloorLocation.objects.create(name="Old dock")
        floor.grant_location(self.device, location, self.admin)
        location.delete()

        self.client.force_authenticate(self.admin)
        events = self.client.get(reverse("staff-floor-events")).data
        self.assertEqual(events[0]["location"], "Old dock")


class LocationEnforcementTests(FloorTestCase):
    """What a worker signed in on a floor device can actually use."""

    def setUp(self):
        super().setUp()
        self.packing = FloorLocation.objects.create(
            name="Packing area", sections=["measurements", "packaging"]
        )
        self.damage_bay = FloorLocation.objects.create(name="Damage bay", sections=["damage"])

    def signed_in_on_device(self):
        self.on_device()
        self.assertEqual(self.pin_login().status_code, 200)

    def test_a_device_can_use_the_sections_of_its_locations_only(self):
        floor.grant_location(self.device, self.packing, self.admin)
        self.signed_in_on_device()

        self.assertEqual(self.client.get(MEASUREMENTS_URL).status_code, 200)
        self.assertEqual(self.client.get(DAMAGE_URL).status_code, 403)

    def test_a_device_with_no_location_is_refused_every_section(self):
        self.signed_in_on_device()

        self.assertEqual(self.client.get(MEASUREMENTS_URL).status_code, 403)
        self.assertEqual(self.client.get(DAMAGE_URL).status_code, 403)

    def test_scanning_and_shipments_stay_available_everywhere(self):
        # Not part of any section: without them the floor cannot work at all.
        self.signed_in_on_device()
        self.assertEqual(self.client.get(SHIPMENTS_URL).status_code, 200)

    def test_revoking_takes_effect_on_the_very_next_request(self):
        floor.grant_location(self.device, self.packing, self.admin)
        self.signed_in_on_device()
        self.assertEqual(self.client.get(MEASUREMENTS_URL).status_code, 200)

        floor.revoke_location(self.device, self.packing, self.admin)

        self.assertEqual(self.client.get(MEASUREMENTS_URL).status_code, 403)

    def test_without_any_locations_devices_work_as_before(self):
        FloorLocation.objects.all().delete()
        self.signed_in_on_device()

        self.assertEqual(self.client.get(MEASUREMENTS_URL).status_code, 200)
        self.assertEqual(self.client.get(DAMAGE_URL).status_code, 200)

    def test_the_limit_is_on_the_device_not_the_person(self):
        # Office staff using the floor device are limited the same way;
        # on their own computer (no device cookie) they are not.
        floor.grant_location(self.device, self.packing, self.admin)
        self.client.force_authenticate(self.office)

        self.assertEqual(self.client.get(DAMAGE_URL).status_code, 200)
        self.on_device()
        self.assertEqual(self.client.get(DAMAGE_URL).status_code, 403)

    def test_the_warehouse_app_is_told_what_this_device_may_show(self):
        floor.grant_location(self.device, self.packing, self.admin)
        self.signed_in_on_device()

        mine = self.client.get(ACCESS_URL).data["mine"]

        self.assertTrue(mine["measurements"])
        self.assertTrue(mine["packaging"])
        self.assertFalse(mine["damage"])

    def test_both_switches_must_allow_a_section(self):
        # The global Warehouse access switch still applies on top of locations.
        from warehouse.models import WarehouseAccess

        access = WarehouseAccess.current()
        access.sections = {"measurements": False}
        access.save()
        floor.grant_location(self.device, self.packing, self.admin)
        self.signed_in_on_device()

        self.assertEqual(self.client.get(MEASUREMENTS_URL).status_code, 403)
        self.assertEqual(self.client.get(reverse("staff-warehouse-packaging-list")).status_code, 200)
