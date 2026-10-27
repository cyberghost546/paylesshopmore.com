"""Tests for the carrier-ready parts of tracking: stages, several parcels per
order, staff registering and correcting numbers, the adapters, the mock
provider and the admin-only integration settings.

No test talks to a real carrier: the mock provider makes up its data, and the
DHL adapter is fed answers shaped like DHL's documented responses.
"""

import os
import urllib.error
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework import status

from accounts.models import Package
from prealerts.models import PreAlert

from .adapters import MOCK, SEVENTEEN_TRACK, choose_adapter, get_adapter
from .adapters.base import record_test
from .adapters.dhl import DhlAdapter
from .adapters.mock import scenario_for
from .models import CarrierIntegration, CarrierShipment, TrackingEvent, TrackingNumberChange
from .providers import CredentialsError
from .statuses import TrackingStatus
from .sync import sync_shipments
from .tests import NUMBER, TrackingTestCase, User

SECRET = "never-show-this-dhl-key"


@override_settings(SEVENTEEN_TRACK_API_KEY="", TRACKING_MOCK_PROVIDER=True)
class MockProviderTests(TrackingTestCase):
    def mock_shipment(self, number, **fields):
        shipment = CarrierShipment.objects.create(
            order=self.order, owner=self.customer, carrier=self.postnl, tracking_number=number, **fields
        )
        from .sync import start_tracking

        start_tracking(shipment)
        return shipment

    def test_the_scenario_is_read_from_the_number(self):
        self.assertEqual(scenario_for("MOCK-DELIVERED-1"), "DELIVERED")
        self.assertEqual(scenario_for("MOCK-DELAYED-1"), "DELAYED")
        self.assertEqual(scenario_for("MOCK-7"), "REG")
        self.assertIsNone(scenario_for(NUMBER))

    def test_a_mock_number_gets_test_data_marked_as_such(self):
        shipment = self.mock_shipment("MOCK-TRANSIT-1")
        self.assertEqual(shipment.provider, "mock")
        sync_shipments([shipment])
        shipment.refresh_from_db()
        self.assertEqual(shipment.status, TrackingStatus.IN_TRANSIT)
        events = list(shipment.events.all())
        self.assertEqual(len(events), 3)
        for event in events:
            self.assertEqual(event.source, TrackingEvent.Source.MOCK)
            self.assertFalse(event.verified)
            self.assertTrue(event.description.startswith("TEST DATA"))

    def test_fetching_again_adds_nothing_twice(self):
        shipment = self.mock_shipment("MOCK-WAREHOUSE-1")
        sync_shipments([shipment])
        sync_shipments([CarrierShipment.objects.get(pk=shipment.pk)])
        self.assertEqual(shipment.events.count(), 4)

    def test_every_scenario(self):
        expected = {
            "MOCK-REG-1": TrackingStatus.ORDER_REGISTERED,
            "MOCK-WAREHOUSE-2": TrackingStatus.DELIVERED,
            "MOCK-DISPATCH-3": TrackingStatus.IN_TRANSIT,
            "MOCK-DELIVERED-4": TrackingStatus.DELIVERED,
            "MOCK-DELAYED-5": TrackingStatus.DELAYED,
        }
        for number, wanted in expected.items():
            with self.subTest(number=number):
                shipment = self.mock_shipment(number)
                sync_shipments([shipment])
                shipment.refresh_from_db()
                self.assertEqual(shipment.status, wanted)

    def test_unknown_and_unavailable(self):
        unknown = self.mock_shipment("MOCK-UNKNOWN-1")
        down = self.mock_shipment("MOCK-DOWN-1")
        sync_shipments([unknown])
        # "Unavailable" fails the whole call, as a real outage would.
        summary = sync_shipments([down])
        unknown.refresh_from_db()
        down.refresh_from_db()
        self.assertEqual(unknown.events.count(), 0)
        self.assertIn("unknown", unknown.last_sync_error)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(down.sync_failures, 1)
        self.assertIsNotNone(down.next_sync_at)

    def test_the_customer_sees_the_test_data_label(self):
        shipment = self.mock_shipment("MOCK-TRANSIT-1")
        sync_shipments([shipment])
        self.client.force_authenticate(self.customer)
        data = self.client.get(reverse("track", args=["MOCK-TRANSIT-1"])).data
        self.assertTrue(data["test_data"])
        self.assertTrue(all(event["test_data"] for event in data["events"]))

    @override_settings(TRACKING_MOCK_PROVIDER=False)
    def test_switched_off_a_mock_number_is_never_sent_anywhere(self):
        with override_settings(SEVENTEEN_TRACK_API_KEY="key"):
            shipment = CarrierShipment(carrier=self.postnl, tracking_number="MOCK-TRANSIT-1")
            self.assertIsNone(choose_adapter(shipment))

    def test_a_real_number_never_gets_mock_data(self):
        shipment = CarrierShipment(carrier=self.postnl, tracking_number=NUMBER)
        self.assertIsNot(choose_adapter(shipment), MOCK)


class AdapterChoiceTests(TrackingTestCase):
    def shipment(self, carrier_code="dhl-parcel-nl"):
        from .models import Carrier

        return CarrierShipment(carrier=Carrier.objects.get(code=carrier_code), tracking_number=NUMBER)

    @override_settings(SEVENTEEN_TRACK_API_KEY="")
    def test_nothing_set_up_means_manual(self):
        self.assertIsNone(choose_adapter(self.shipment()))

    @override_settings(SEVENTEEN_TRACK_API_KEY="key")
    def test_17track_until_the_carrier_api_is_verified_and_enabled(self):
        dhl = get_adapter("dhl")
        with patch.dict(os.environ, {"DHL_API_KEY": SECRET}):
            self.assertIs(choose_adapter(self.shipment()), SEVENTEEN_TRACK)
            record_test(dhl, True, "ok")
            # Tested but not switched on: still 17TRACK.
            self.assertIs(choose_adapter(self.shipment()), SEVENTEEN_TRACK)
            CarrierIntegration.objects.filter(code="dhl").update(enabled=True)
            self.assertIs(choose_adapter(self.shipment()), dhl)
        # The key removed from the server: back to 17TRACK.
        self.assertIs(choose_adapter(self.shipment()), SEVENTEEN_TRACK)

    @override_settings(SEVENTEEN_TRACK_API_KEY="key")
    def test_a_prepared_adapter_is_never_used(self):
        env = {"POSTNL_API_KEY": "x", "POSTNL_CUSTOMER_NUMBER": "x", "POSTNL_CUSTOMER_CODE": "x"}
        with patch.dict(os.environ, env):
            CarrierIntegration.objects.create(code="postnl", enabled=True)
            self.assertEqual(get_adapter("postnl").status(), "not_built")
            self.assertIs(choose_adapter(self.shipment("postnl")), SEVENTEEN_TRACK)


class DhlAdapterTests(SimpleTestCase):
    ANSWER = {
        "shipments": [
            {
                "id": "1234567890",
                "status": {
                    "timestamp": "2026-10-20T10:00:00+02:00",
                    "statusCode": "transit",
                    "description": "Sorted",
                    "location": {"address": {"addressLocality": "Utrecht", "countryCode": "NL"}},
                },
                "estimatedTimeOfDelivery": "2026-10-22T18:00:00+02:00",
                "events": [
                    {
                        "timestamp": "2026-10-20T10:00:00+02:00",
                        "statusCode": "transit",
                        "description": "Sorted",
                        "location": {"address": {"addressLocality": "Utrecht", "countryCode": "NL"}},
                    },
                    {"timestamp": "2026-10-19T08:00:00", "statusCode": "unknown-code", "status": "Registered"},
                ],
            }
        ]
    }

    def test_a_documented_answer_is_read(self):
        adapter = DhlAdapter()
        with patch.object(adapter, "get_json", return_value=(self.ANSWER, 200)):
            result = adapter.fetch([("1234567890", None)])
        track = result.accepted[0]
        self.assertEqual(track.status, TrackingStatus.IN_TRANSIT)
        self.assertEqual(track.location, "Utrecht, NL")
        self.assertEqual(str(track.estimated_delivery), "2026-10-22")
        self.assertEqual(len(track.events), 2)
        # Unknown codes stay unknown; a time without a zone is not guessed.
        self.assertEqual(track.events[1].status, "")
        self.assertIsNone(track.events[1].occurred_at)

    def test_an_unknown_number_is_rejected_not_invented(self):
        adapter = DhlAdapter()
        with patch.object(adapter, "get_json", return_value=({}, 404)):
            result = adapter.fetch([("1234567890", None)])
        self.assertEqual(result.accepted, [])
        self.assertEqual(len(result.rejected), 1)

    def test_a_refused_key_is_a_credentials_error_without_the_key(self):
        adapter = DhlAdapter()
        error = urllib.error.HTTPError("https://api-eu.dhl.com", 401, "Unauthorized", {}, None)
        with patch.dict(os.environ, {"DHL_API_KEY": SECRET}), patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(CredentialsError) as caught:
                adapter.fetch([("1234567890", None)])
            ok, message = adapter.test_connection()
        self.assertNotIn(SECRET, str(caught.exception))
        self.assertFalse(ok)
        self.assertNotIn(SECRET, message)


class StageTests(TrackingTestCase):
    def test_one_parent_and_the_matching_stage(self):
        package = Package.objects.create(user=self.customer, tracking_number="PLSM-00077")
        with self.assertRaises(IntegrityError), transaction.atomic():
            CarrierShipment.objects.create(
                order=self.order, owner=self.customer, tracking_number=NUMBER, stage="outgoing"
            )
        with self.assertRaises(IntegrityError), transaction.atomic():
            CarrierShipment.objects.create(
                onward_package=package, owner=self.customer, tracking_number=NUMBER, stage="incoming"
            )
        with self.assertRaises(IntegrityError), transaction.atomic():
            CarrierShipment.objects.create(owner=self.customer, tracking_number=NUMBER)

    def test_an_order_can_have_several_parcels(self):
        CarrierShipment.objects.create(order=self.order, owner=self.customer, tracking_number="3SAAA1111111")
        CarrierShipment.objects.create(order=self.order, owner=self.customer, tracking_number="3SBBB2222222")
        self.client.force_authenticate(self.customer)
        package = Package.objects.create(user=self.customer, tracking_number="PLSM-00078")
        self.booking.package = package
        self.booking.save(update_fields=["package"])
        data = self.client.get(reverse("track", args=["PLSM-00078"])).data
        self.assertEqual(len(data["orders"][0]["carrier_trackings"]), 2)

    def test_the_outgoing_number_shows_on_our_shipment(self):
        package = Package.objects.create(user=self.customer, tracking_number="PLSM-00079")
        CarrierShipment.objects.create(
            onward_package=package, owner=self.customer, tracking_number="1Z999AA10123456784", stage="outgoing"
        )
        self.client.force_authenticate(self.customer)
        data = self.client.get(reverse("track", args=["PLSM-00079"])).data
        self.assertEqual(data["onward_trackings"][0]["stage"], "outgoing")
        self.assertEqual(data["onward_trackings"][0]["reference"], "PLSM-00079")

    def test_the_customer_form_never_touches_what_staff_entered(self):
        staff_row = CarrierShipment.objects.create(
            order=self.order, owner=self.customer, entered_by=self.office, tracking_number="3SSTAFF123456"
        )
        response = self.set_tracking(self.customer, code="3SNEW1234567")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.set_tracking(self.customer, code="")
        self.assertTrue(CarrierShipment.objects.filter(pk=staff_row.pk).exists())
        self.assertEqual(self.order.carrier_shipments.count(), 1)

    def test_a_warehouse_scan_ignores_outgoing_numbers(self):
        from .matching import find_by_courier_number

        package = Package.objects.create(user=self.customer, tracking_number="PLSM-00080")
        CarrierShipment.objects.create(
            onward_package=package, owner=self.customer, tracking_number="1Z999AA10123456784", stage="outgoing"
        )
        self.assertIsNone(find_by_courier_number("1Z999AA10123456784"))


@override_settings(SEVENTEEN_TRACK_API_KEY="")
class StaffRegisterAndCorrectTests(TrackingTestCase):
    def setUp(self):
        super().setUp()
        self.list_url = reverse("staff-carrier-shipment-list")

    def test_staff_register_an_incoming_number(self):
        self.client.force_authenticate(self.office)
        response = self.client.post(
            self.list_url,
            {"customer": self.customer.pk, "stage": "incoming", "order": self.order.pk,
             "carrier": "postnl", "tracking_number": "3s abc 9999 999"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        shipment = CarrierShipment.objects.get(pk=response.data["id"])
        self.assertEqual(shipment.tracking_number, "3SABC9999999")
        self.assertEqual(shipment.entered_by, self.office)
        self.assertFalse(response.data["entered_by_customer"])

    def test_staff_register_an_outgoing_number(self):
        package = Package.objects.create(user=self.customer, tracking_number="PLSM-00081")
        self.client.force_authenticate(self.office)
        response = self.client.post(
            self.list_url,
            {"customer": self.customer.pk, "stage": "outgoing", "package": package.pk,
             "carrier": "fedex", "tracking_number": "794612345678"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["stage"], "outgoing")

    def test_the_parent_must_belong_to_the_customer(self):
        self.client.force_authenticate(self.office)
        response = self.client.post(
            self.list_url,
            {"customer": self.stranger.pk, "stage": "incoming", "order": self.order.pk,
             "carrier": "postnl", "tracking_number": NUMBER},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(CarrierShipment.objects.exists())

    def test_customers_and_the_warehouse_manager_cannot_register_or_correct(self):
        shipment = self.make_shipment()
        url = reverse("staff-carrier-shipment-correct-number", args=[shipment.pk])
        for user in (self.customer, self.manager):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post(self.list_url, {}, format="json").status_code, 403)
            self.assertEqual(
                self.client.post(url, {"tracking_number": "3SNEW1234567", "reason": "x"}).status_code, 403
            )

    def test_a_correction_is_kept_on_record(self):
        shipment = self.make_shipment()
        TrackingEvent.objects.create(
            shipment=shipment, status=TrackingStatus.IN_TRANSIT, source=TrackingEvent.Source.CARRIER_API,
            external_id="a",
        )
        TrackingEvent.objects.create(shipment=shipment, status="", source=TrackingEvent.Source.STAFF)
        self.client.force_authenticate(self.office)
        response = self.client.post(
            reverse("staff-carrier-shipment-correct-number", args=[shipment.pk]),
            {"tracking_number": "3SNEW1234567", "carrier": "dhl-parcel-nl", "reason": "Typo by the customer"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        change = TrackingNumberChange.objects.get(shipment=shipment)
        self.assertEqual((change.old_tracking_number, change.new_tracking_number), (NUMBER, "3SNEW1234567"))
        self.assertEqual(change.changed_by, self.office)
        self.assertEqual(response.data["number_changes"][0]["reason"], "Typo by the customer")
        # The courier line for the old number is hidden, never deleted; ours stays.
        self.assertEqual(shipment.events.count(), 2)
        self.assertEqual(shipment.events.filter(voided_at__isnull=True).count(), 1)

    def test_a_correction_needs_a_reason(self):
        shipment = self.make_shipment()
        self.client.force_authenticate(self.office)
        response = self.client.post(
            reverse("staff-carrier-shipment-correct-number", args=[shipment.pk]),
            {"tracking_number": "3SNEW1234567"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(TrackingNumberChange.objects.exists())

    def test_lookup_finds_the_customer_by_number(self):
        PreAlert.objects.filter(user=self.customer).delete()
        self.client.force_authenticate(self.office)
        data = self.client.get(reverse("staff-carrier-shipment-lookup"), {"q": self.customer.customer_code}).data
        self.assertEqual(data[0]["id"], self.customer.pk)
        self.assertEqual(data[0]["orders"][0]["id"], self.order.pk)

    def test_stage_filter(self):
        self.make_shipment()
        self.client.force_authenticate(self.office)
        data = self.client.get(self.list_url, {"stage": "outgoing"}).data
        rows = data["results"] if isinstance(data, dict) else data
        self.assertEqual(len(rows), 0)


class IntegrationSettingsTests(TrackingTestCase):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(
            username="admin", email="admin@example.com", password="a-long-enough-password", role=User.Role.ADMIN
        )
        self.url = reverse("tracking-integrations")

    def test_only_admins(self):
        for user in (self.customer, self.office, self.manager):
            self.client.force_authenticate(user)
            self.assertIn(self.client.get(self.url).status_code, (401, 403))

    def test_statuses_and_no_secrets(self):
        self.client.force_authenticate(self.admin)
        with patch.dict(os.environ, {"DHL_API_KEY": SECRET}):
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(SECRET, response.content.decode())
        rows = {row["code"]: row for row in response.data}
        self.assertEqual(rows["dhl"]["status"], "configured_untested")
        self.assertEqual(rows["dhl"]["settings"], [{"name": "DHL_API_KEY", "set": True}])
        self.assertEqual(rows["fedex"]["status"], "not_built")
        self.assertFalse(rows["dhl"]["active"])

    def test_enabling_needs_a_successful_test(self):
        self.client.force_authenticate(self.admin)
        detail = reverse("tracking-integration", args=["dhl"])
        test = reverse("tracking-integration-test", args=["dhl"])
        with patch.dict(os.environ, {"DHL_API_KEY": SECRET}):
            self.assertEqual(self.client.patch(detail, {"enabled": True}, format="json").status_code, 400)
            with patch("tracking.adapters.dhl.DhlAdapter.test_connection", return_value=(False, "refused")):
                data = self.client.post(test).data
            self.assertEqual(data["status"], "connection_failed")
            with patch("tracking.adapters.dhl.DhlAdapter.test_connection", return_value=(True, "accepted")):
                self.client.post(test)
            data = self.client.patch(detail, {"enabled": True}, format="json").data
            self.assertEqual(data["status"], "connected")
            self.assertTrue(data["active"])
            # Another environment: test again, and off until then.
            data = self.client.patch(detail, {"environment": "production"}, format="json").data
            self.assertEqual(data["status"], "configured_untested")
            self.assertFalse(data["enabled"])

    def test_a_prepared_carrier_cannot_be_tested_or_enabled(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(reverse("tracking-integration-test", args=["fedex"])).status_code, 400)
        self.assertEqual(
            self.client.patch(reverse("tracking-integration", args=["fedex"]), {"enabled": True}, format="json")
            .status_code,
            400,
        )

    def test_an_unconfigured_carrier_cannot_be_tested(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(reverse("tracking-integration-test", args=["dhl"]))
        self.assertEqual(response.status_code, 400)
        self.assertIn("DHL_API_KEY", str(response.data))
