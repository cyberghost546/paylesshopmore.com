"""Tests for integrations: API keys in, webhooks out.

Each class is one promise the integration makes. The security ones (a key
cannot reach other routes, a session cannot use a key's routes, private URLs
are refused) are the ones that must never start failing.
"""

import hashlib
import hmac
import json
import shutil
import socket
import tempfile
import urllib.error
import urllib.request
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.events import record_event
from accounts.models import Package, PackageEvent
from config.testing import ThrottleFreeAPITestCase
from invoicing.services import ensure_invoice_for_package

from . import keys
from .models import ApiKey, EventType, InboundEvent, Scope, WebhookDelivery, WebhookEndpoint
from .tasks import MAX_ATTEMPTS, deliver_webhook
from .webhooks import UnsafeUrl, _PinnedHTTPSHandler, check_url, emit, sign

User = get_user_model()
PASSWORD = "a-long-enough-password"
PUBLIC_ADDRESS = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]


def make_user(email, **extra):
    return User.objects.create_user(
        username=email, email=email, password=PASSWORD,
        first_name="Test", last_name="User", phone_number="+599 9 000 0000", **extra,
    )


def make_key(scopes, **fields):
    """An ApiKey row and the raw key to send."""
    raw, prefix, key_hash = keys.new_key()
    return ApiKey.objects.create(name="Test program", prefix=prefix, key_hash=key_hash, scopes=scopes, **fields), raw


class IntegrationTestCase(ThrottleFreeAPITestCase):
    def setUp(self):
        super().setUp()
        self.customer = make_user("klant@example.com")
        self.staff = make_user("office@example.com", role=User.Role.OFFICE)
        self.package = Package.objects.create(
            user=self.customer, tracking_number="PLSM-0001", description="Twee dozen",
            status=Package.Status.PAID, value_eur="149.95",
        )

    def with_key(self, raw):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
        return client


class ApiKeyAuthenticationTests(IntegrationTestCase):
    url = "/api/integrations/v1/ping/"

    def test_no_key_is_401(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_a_valid_key_works_and_is_marked_used(self):
        key, raw = make_key([Scope.INVOICES_READ])
        response = self.with_key(raw).get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scopes"], ["invoices:read"])
        key.refresh_from_db()
        self.assertIsNotNone(key.last_used_at)

    def test_wrong_secret_unknown_prefix_and_garbage_are_401(self):
        _, raw = make_key([])
        prefix = keys.split_prefix(raw)
        for bad in (f"{prefix}_not-the-secret", "plsm_00000000_whatever", "nonsense", ""):
            with self.subTest(bad=bad):
                self.assertEqual(self.with_key(bad).get(self.url).status_code, 401)

    def test_revoked_and_expired_keys_are_401(self):
        _, revoked = make_key([], revoked_at=timezone.now())
        _, expired = make_key([], expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.with_key(revoked).get(self.url).status_code, 401)
        self.assertEqual(self.with_key(expired).get(self.url).status_code, 401)

    def test_only_the_hash_is_stored(self):
        key, raw = make_key([])
        self.assertNotIn(raw.split("_", 2)[2], key.key_hash)
        self.assertEqual(key.key_hash, hashlib.sha256(raw.encode()).hexdigest())


class KeysOnlyOpenIntegrationRoutesTests(IntegrationTestCase):
    """The main security promise: a key is not a login for the rest of the site."""

    def test_a_key_with_every_scope_cannot_reach_staff_or_customer_routes(self):
        _, raw = make_key(list(Scope.values))
        client = self.with_key(raw)
        for url in ("/api/staff/invoices/", "/api/staff/customers/", "/api/profile/", "/api/packages/"):
            with self.subTest(url=url):
                self.assertIn(client.get(url).status_code, (401, 403))

    def test_a_signed_in_staff_session_cannot_use_integration_routes(self):
        # force_login, a real session cookie (force_authenticate would skip
        # authentication altogether and so test nothing).
        self.client.force_login(self.staff)
        for url in ("/api/integrations/v1/ping/", "/api/integrations/v1/invoices/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 401)

    def test_a_key_without_the_scope_is_403(self):
        _, raw = make_key([Scope.SHIPMENTS_READ])
        self.assertEqual(self.with_key(raw).get("/api/integrations/v1/invoices/").status_code, 403)
        self.assertEqual(self.with_key(raw).post("/api/integrations/v1/events/", {}, format="json").status_code, 403)


class ShipmentAndInvoiceListTests(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)

    def test_shipments_list_with_updated_since(self):
        _, raw = make_key([Scope.SHIPMENTS_READ])
        client = self.with_key(raw)

        rows = client.get("/api/integrations/v1/shipments/").data["results"]
        self.assertEqual([r["tracking_number"] for r in rows], ["PLSM-0001"])
        self.assertEqual(rows[0]["value_eur"], "149.95")
        self.assertEqual(rows[0]["customer"]["email"], "klant@example.com")

        later = (timezone.now() + timedelta(minutes=1)).isoformat()
        self.assertEqual(client.get("/api/integrations/v1/shipments/", {"updated_since": later}).data["count"], 0)
        self.assertEqual(client.get("/api/integrations/v1/shipments/", {"updated_since": "yesterday"}).status_code, 400)

    def test_only_issued_invoices_are_listed_and_downloadable(self):
        _, raw = make_key([Scope.INVOICES_READ])
        client = self.with_key(raw)
        invoice = ensure_invoice_for_package(self.package)  # pending review

        self.assertEqual(client.get("/api/integrations/v1/invoices/").data["count"], 0)
        self.assertEqual(client.get(f"/api/integrations/v1/invoices/{invoice.pk}/pdf/").status_code, 404)

        with patch("integrations.tasks.send", return_value=(True, 200, "")), \
                self.captureOnCommitCallbacks(execute=True):
            invoice.approve(self.staff)  # renders the PDF and marks it sent
        invoice.refresh_from_db()

        rows = client.get("/api/integrations/v1/invoices/").data["results"]
        self.assertEqual(rows[0]["status"], "sent")
        self.assertTrue(rows[0]["pdf_available"])
        response = client.get(f"/api/integrations/v1/invoices/{invoice.pk}/pdf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(client.get("/api/integrations/v1/invoices/", {"status": "pending_review"}).status_code, 400)


class InboundEventTests(IntegrationTestCase):
    url = "/api/integrations/v1/events/"

    def setUp(self):
        super().setUp()
        self.key, raw = make_key([Scope.EVENTS_WRITE])
        self.client = self.with_key(raw)

    def test_an_event_is_stored_once_per_id(self):
        body = {"type": "shipment.tracking_updated", "id": "abc-1", "data": {"carrier": "DHL", "code": "JD01"}}
        first = self.client.post(self.url, body, format="json")
        again = self.client.post(self.url, body, format="json")
        self.assertEqual(first.status_code, 202)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.data["id"], again.data["id"])
        self.assertEqual(InboundEvent.objects.get().payload["carrier"], "DHL")

    def test_bad_bodies_are_400(self):
        for body in (
            {"data": {}},                                   # no type
            {"type": "Has Spaces", "data": {}},             # bad type
            {"type": "x", "data": ["not", "an", "object"]},  # data not an object
            {"type": "x", "data": {"blob": "a" * 70_000}},  # too large
        ):
            with self.subTest(body=str(body)[:40]):
                self.assertEqual(self.client.post(self.url, body, format="json").status_code, 400)
        self.assertEqual(InboundEvent.objects.count(), 0)


@patch("integrations.webhooks.socket.getaddrinfo", return_value=PUBLIC_ADDRESS)
class WebhookTests(IntegrationTestCase):
    def setUp(self):
        super().setUp()
        self.endpoint = WebhookEndpoint.objects.create(
            name="Accounting", url="https://hooks.example.com/plsm", secret="whsec_test",
            events=[EventType.SHIPMENT_STATUS_CHANGED, EventType.INVOICE_SENT],
        )

    def test_signature_is_hmac_sha256_of_timestamp_and_body(self, _dns):
        body = b'{"id":"1"}'
        expected = hmac.new(b"whsec_test", b"1700000000." + body, hashlib.sha256).hexdigest()
        self.assertEqual(sign("whsec_test", 1700000000, body), expected)

    def test_only_subscribed_active_endpoints_get_a_delivery(self, _dns):
        WebhookEndpoint.objects.create(name="Off", url="https://x.example.com", secret="s",
                                       events=[EventType.INVOICE_SENT], is_active=False)
        with patch("integrations.tasks.deliver_webhook.delay"):
            self.assertEqual(len(emit(EventType.INVOICE_SENT, {"id": 1})), 1)
            self.assertEqual(len(emit(EventType.INVOICE_APPROVED, {"id": 1})), 0)

    def test_a_status_change_in_the_history_sends_a_signed_webhook(self, _dns):
        sent = []

        def fake_open(request, timeout):
            sent.append(request)

            class Answer:
                status = 200

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return False

            return Answer()

        opener = type("Opener", (), {"open": staticmethod(fake_open)})()
        with patch("integrations.webhooks._opener_for", return_value=opener) as opener_for, \
                self.captureOnCommitCallbacks(execute=True):
            record_event(self.package, PackageEvent.Kind.STATUS_CHANGED,
                         from_status="paid", to_status="in_transit")

        self.assertEqual(len(sent), 1)
        # To the address that was checked, not one looked up again later.
        opener_for.assert_called_once_with("93.184.216.34")
        request = sent[0]
        body = json.loads(request.data)
        self.assertEqual(body["type"], "shipment.status_changed")
        self.assertEqual(body["data"]["tracking_number"], "PLSM-0001")
        self.assertEqual(body["data"]["to_status"], "in_transit")

        signature = dict(part.split("=", 1) for part in request.get_header("X-plsm-signature").split(","))
        self.assertEqual(signature["v1"], sign("whsec_test", int(signature["t"]), request.data))
        self.assertEqual(WebhookDelivery.objects.get().status, WebhookDelivery.Status.DELIVERED)

    def test_a_failure_is_retried_later_then_given_up(self, _dns):
        delivery = WebhookDelivery.objects.create(endpoint=self.endpoint, event_type="ping", payload={})
        with patch("integrations.tasks.send", return_value=(False, 500, "HTTP 500")):
            deliver_webhook(str(delivery.pk))
            delivery.refresh_from_db()
            self.assertEqual(delivery.status, WebhookDelivery.Status.PENDING)
            self.assertEqual(delivery.attempts, 1)
            self.assertGreater(delivery.next_attempt_at, timezone.now())

            for _ in range(MAX_ATTEMPTS - 1):
                deliver_webhook(str(delivery.pk))
            delivery.refresh_from_db()
            self.assertEqual(delivery.status, WebhookDelivery.Status.FAILED)
            self.assertEqual(delivery.attempts, MAX_ATTEMPTS)

    def test_an_endpoint_switched_off_is_not_called(self, _dns):
        delivery = WebhookDelivery.objects.create(endpoint=self.endpoint, event_type="ping", payload={})
        self.endpoint.is_active = False
        self.endpoint.save()
        with patch("integrations.tasks.send") as send:
            deliver_webhook(str(delivery.pk))
        send.assert_not_called()


class UnsafeUrlTests(ThrottleFreeAPITestCase):
    """A webhook URL must not let anyone make our server call our own network."""

    def test_http_is_refused(self):
        with self.assertRaises(UnsafeUrl):
            check_url("http://hooks.example.com/")

    def test_private_and_loopback_addresses_are_refused(self):
        for address in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1"):
            family = socket.AF_INET6 if ":" in address else socket.AF_INET
            answer = [(family, socket.SOCK_STREAM, 6, "", (address, 443))]
            with self.subTest(address=address), patch("integrations.webhooks.socket.getaddrinfo", return_value=answer):
                with self.assertRaises(UnsafeUrl):
                    check_url("https://looks-public.example.com/")

    def test_a_public_https_url_is_allowed(self):
        with patch("integrations.webhooks.socket.getaddrinfo", return_value=PUBLIC_ADDRESS):
            self.assertEqual(check_url("https://hooks.example.com/plsm"), "93.184.216.34")

    def test_the_connection_goes_to_the_checked_address(self):
        """DNS rebinding: the name is not looked up a second time to connect."""
        request = urllib.request.Request("https://hooks.example.com/plsm", data=b"{}", method="POST")
        request.timeout = 5
        handler = _PinnedHTTPSHandler("93.184.216.34")
        with patch(
            "integrations.webhooks.socket.create_connection", side_effect=OSError("stop")
        ) as connect, patch("integrations.webhooks.socket.getaddrinfo") as dns:
            with self.assertRaises(urllib.error.URLError):
                handler.https_open(request)
        connect.assert_called_once()
        self.assertEqual(connect.call_args.args[0], ("93.184.216.34", 443))
        dns.assert_not_called()


class AdminTests(ThrottleFreeAPITestCase):
    def setUp(self):
        super().setUp()
        self.admin_user = make_user("boss@example.com", role=User.Role.ADMIN)
        self.office = make_user("office@example.com", role=User.Role.OFFICE)

    def test_office_cannot_open_the_integrations_admin(self):
        self.client.force_login(self.office)
        self.assertEqual(self.client.get("/admin/integrations/apikey/").status_code, 403)

    def test_an_admin_creates_a_key_and_sees_it_once(self):
        self.client.force_login(self.admin_user)
        response = self.client.post(
            "/admin/integrations/apikey/add/",
            {"name": "Accounting", "scopes": ["invoices:read"], "expires_at_0": "", "expires_at_1": ""},
        )
        self.assertEqual(response.status_code, 200)
        key = ApiKey.objects.get()
        raw = response.context["secret"]
        self.assertTrue(raw.startswith(key.prefix + "_"))
        self.assertTrue(keys.matches(raw, key.key_hash))
        self.assertEqual(key.created_by, self.admin_user)
        # Not in a messages cookie.
        self.assertNotIn(raw, str(response.cookies))


@patch("integrations.webhooks.socket.getaddrinfo", return_value=PUBLIC_ADDRESS)
class DashboardIntegrationsApiTests(ThrottleFreeAPITestCase):
    """The dashboard's Integrations page (staff_api.py). Admins only."""

    base = "/api/staff/integrations"

    def setUp(self):
        super().setUp()
        self.admin_user = make_user("boss@example.com", role=User.Role.ADMIN)
        self.office = make_user("office@example.com", role=User.Role.OFFICE)
        self.client.force_authenticate(self.admin_user)

    def test_office_staff_are_refused_everywhere(self, _dns):
        self.client.force_authenticate(self.office)
        for method, url in [
            ("get", "/options/"), ("get", "/keys/"), ("post", "/keys/"), ("get", "/webhooks/"),
            ("post", "/webhooks/"), ("get", "/deliveries/"), ("get", "/inbound-events/"),
        ]:
            with self.subTest(url=url, method=method):
                self.assertEqual(getattr(self.client, method)(self.base + url, {}, format="json").status_code, 403)

    def test_a_key_is_shown_once_then_never_again(self, _dns):
        response = self.client.post(f"{self.base}/keys/", {"name": "Accounting", "scopes": ["invoices:read"]},
                                    format="json")
        self.assertEqual(response.status_code, 201)
        raw = response.data["key"]
        key = ApiKey.objects.get()
        self.assertTrue(keys.matches(raw, key.key_hash))
        self.assertEqual(key.created_by, self.admin_user)

        listing = self.client.get(f"{self.base}/keys/")
        self.assertNotIn(raw, json.dumps(listing.data, default=str))
        self.assertNotIn("key", listing.data[0])
        self.assertEqual(listing.data[0]["state"], "active")

    def test_a_key_needs_a_name_and_a_known_scope(self, _dns):
        for body in ({"name": "", "scopes": ["invoices:read"]}, {"name": "X", "scopes": []},
                     {"name": "X", "scopes": ["admin:everything"]}):
            with self.subTest(body=body):
                self.assertEqual(self.client.post(f"{self.base}/keys/", body, format="json").status_code, 400)

    def test_revoke_stops_the_key(self, _dns):
        raw = self.client.post(f"{self.base}/keys/", {"name": "A", "scopes": ["shipments:read"]},
                               format="json").data["key"]
        key = ApiKey.objects.get()
        response = self.client.post(f"{self.base}/keys/{key.pk}/revoke/")
        self.assertEqual(response.data["state"], "revoked")

        program = APIClient()
        program.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
        self.assertEqual(program.get("/api/integrations/v1/ping/").status_code, 401)

    def test_an_endpoint_shows_its_secret_once_and_refuses_unsafe_urls(self, _dns):
        response = self.client.post(
            f"{self.base}/webhooks/",
            {"name": "Accounting", "url": "https://hooks.example.com/x", "events": ["invoice.sent"]},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["secret"].startswith("whsec_"))
        self.assertNotIn("secret", self.client.get(f"{self.base}/webhooks/").data[0])

        refused = self.client.post(
            f"{self.base}/webhooks/",
            {"name": "Bad", "url": "http://hooks.example.com/x", "events": ["invoice.sent"]},
            format="json",
        )
        self.assertEqual(refused.status_code, 400)
        self.assertIn("url", refused.data)

    def test_edit_switch_off_test_and_delete_an_endpoint(self, _dns):
        endpoint_id = self.client.post(
            f"{self.base}/webhooks/",
            {"name": "A", "url": "https://hooks.example.com/x", "events": ["invoice.sent"]},
            format="json",
        ).data["id"]

        changed = self.client.patch(f"{self.base}/webhooks/{endpoint_id}/", {"is_active": False}, format="json")
        self.assertFalse(changed.data["is_active"])
        self.assertEqual(changed.data["events"], ["invoice.sent"])

        with patch("integrations.tasks.send", return_value=(True, 200, "")):
            self.client.patch(f"{self.base}/webhooks/{endpoint_id}/", {"is_active": True}, format="json")
            tested = self.client.post(f"{self.base}/webhooks/{endpoint_id}/test/")
        self.assertEqual(tested.status_code, 202)
        self.assertEqual(tested.data["status"], "delivered")
        self.assertEqual(len(self.client.get(f"{self.base}/deliveries/").data), 1)

        self.assertEqual(self.client.delete(f"{self.base}/webhooks/{endpoint_id}/").status_code, 204)
        self.assertFalse(WebhookEndpoint.objects.exists())
