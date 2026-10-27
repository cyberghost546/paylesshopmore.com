"""Outbound webhooks: building, signing and safely sending one message.

READ THIS FIRST - the life of a webhook:

    1. Something happens, e.g. an invoice is sent. accounts/events.py calls
       emit_for_package_event(), which calls emit("invoice.sent", data).
    2. emit() writes one WebhookDelivery row per endpoint that wants that
       event, and - once the database transaction has committed - asks the
       worker to send it (tasks.deliver_webhook).
    3. send() POSTs the JSON, signed, and reports what happened. tasks.py
       decides whether to try again.

THE SIGNATURE (how the receiver knows the message is really from us):

    X-PLSM-Signature: t=1792146030,v1=5d41402abc4b2a76b9719d911017c592...

    v1 = HMAC-SHA256(key = the endpoint's secret, message = "<t>.<raw body>")

    The receiver recomputes v1 with the same secret and compares. `t` is the
    send time in Unix seconds; the receiver should refuse messages older than a
    few minutes, so a captured message cannot be replayed later.

SAFETY (why send() is fussier than a plain urlopen):
    The URL is typed in by an admin, but a URL that points inside our own
    network (localhost, 10.x.x.x, the cloud's metadata address...) would let
    whoever controls it make our server call internal services. So:
      - https only;
      - every address the host name resolves to must be public;
      - the connection goes to the address that was checked, not to whatever
        the name resolves to a moment later (a DNS server can answer "public"
        for the check and "10.0.0.5" for the real request - DNS rebinding);
      - redirects are not followed (a redirect could point inside);
      - proxy settings in the environment are ignored (they would decide
        where the request really goes).
"""

import hashlib
import hmac
import http.client
import ipaddress
import json
import logging
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from django.db import transaction
from django.utils import timezone

from .models import EventType, WebhookDelivery, WebhookEndpoint

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10
USER_AGENT = "PayLesShopMore-Webhooks/1"


class UnsafeUrl(Exception):
    """The URL is not one we are willing to call."""


# ---- 1. queueing ------------------------------------------------------------


def emit(event_type, data):
    """Queue `data` as `event_type` for every endpoint that wants it.

    Cheap when nobody is subscribed: one query, then nothing. Returns the
    deliveries made (handy in tests).
    """
    endpoints = [e for e in WebhookEndpoint.objects.filter(is_active=True) if e.wants(event_type)]
    deliveries = []
    for endpoint in endpoints:
        delivery = WebhookDelivery.objects.create(endpoint=endpoint, event_type=event_type, payload=data)
        deliveries.append(delivery)

    if deliveries:
        # on_commit: if the change that caused the event is rolled back, the
        # message is never sent. Imported here because tasks.py imports us.
        from .tasks import deliver_webhook

        ids = [str(d.pk) for d in deliveries]
        transaction.on_commit(lambda: [deliver_webhook.delay(i) for i in ids])
    return deliveries


def emit_for_package_event(package, kind, context):
    """Turn an order-history event (accounts.models.PackageEvent) into a webhook.

    Called from accounts.events.record_event. Never raises: a webhook problem
    must never stop an invoice being approved or a status being changed.
    """
    # Imported here to keep accounts and invoicing free to import this module.
    from accounts.models import PackageEvent
    from invoicing.models import Invoice

    from .payloads import invoice_data, shipment_data

    try:
        if kind == PackageEvent.Kind.STATUS_CHANGED:
            data = shipment_data(package) | {
                "from_status": context.get("from_status"),
                "to_status": context.get("to_status"),
            }
            emit(EventType.SHIPMENT_STATUS_CHANGED, data)
            return

        invoice_events = {
            PackageEvent.Kind.INVOICE_APPROVED: EventType.INVOICE_APPROVED,
            PackageEvent.Kind.INVOICE_SENT: EventType.INVOICE_SENT,
        }
        if kind in invoice_events and context.get("invoice_id"):
            invoice = (
                Invoice.objects.select_related("package", "package__user")
                .prefetch_related("lines")
                .filter(pk=context["invoice_id"])
                .first()
            )
            if invoice is not None:
                emit(invoice_events[kind], invoice_data(invoice))
    except Exception:
        logger.exception("Could not queue a webhook for a %s event on package %s.", kind, package.pk)


# ---- 2. the message -----------------------------------------------------------


def envelope(delivery):
    """The JSON body we send. Example:
    {"id": "6f1c...", "type": "invoice.sent", "created_at": "2026-10-16T...", "data": {...}}
    """
    return {
        "id": str(delivery.pk),
        "type": delivery.event_type,
        "created_at": delivery.created_at.isoformat(),
        "data": delivery.payload,
    }


def sign(secret, timestamp, body):
    """The v1 signature of `body` (bytes) sent at `timestamp` (int seconds)."""
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


# ---- 3. sending -----------------------------------------------------------------


def check_url(url):
    """Raise UnsafeUrl unless `url` is https and every address it resolves to is public.

    Returns the first of those addresses: send() connects to exactly that one.
    """
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise UnsafeUrl("Only https:// URLs are allowed.")
    try:
        infos = socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as error:
        raise UnsafeUrl(f"Cannot resolve {parts.hostname}.") from error
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise UnsafeUrl(f"{parts.hostname} points to a private address ({address}).")
    return infos[0][4][0]


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    """Treat any 3xx as a failure instead of following it (see SAFETY above)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """An HTTPS connection to one fixed address, whatever DNS says now.

    The certificate is still checked against the host name in the URL
    (server_hostname), so pinning the address takes nothing away from TLS.
    """

    pinned_address = None

    def connect(self):
        sock = socket.create_connection((self.pinned_address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, address):
        super().__init__()
        self._address = address

    def https_open(self, req):
        connection = type(
            "PinnedConnection", (_PinnedHTTPSConnection,), {"pinned_address": self._address}
        )
        return self.do_open(connection, req, context=self._context)


def _opener_for(address):
    """An opener that connects only to `address`, follows no redirects and
    uses no proxy."""
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), _NoRedirects, _PinnedHTTPSHandler(address)
    )


def send(delivery):
    """POST one delivery once. Returns (ok, status_code_or_None, error_text)."""
    endpoint = delivery.endpoint
    try:
        address = check_url(endpoint.url)
    except UnsafeUrl as error:
        return False, None, str(error)

    body = json.dumps(envelope(delivery), separators=(",", ":")).encode()
    timestamp = int(time.time())
    request = urllib.request.Request(
        endpoint.url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "X-PLSM-Event": delivery.event_type,
            "X-PLSM-Delivery": str(delivery.pk),
            "X-PLSM-Signature": f"t={timestamp},v1={sign(endpoint.secret, timestamp, body)}",
        },
    )
    try:
        with _opener_for(address).open(request, timeout=TIMEOUT_SECONDS) as response:
            return 200 <= response.status < 300, response.status, ""
    except urllib.error.HTTPError as error:
        return False, error.code, f"HTTP {error.code}"
    except (urllib.error.URLError, OSError) as error:
        return False, None, str(getattr(error, "reason", error))[:300]


def send_test_event(endpoint):
    """Queue a "ping" to one endpoint, whatever events it subscribes to."""
    delivery = WebhookDelivery.objects.create(
        endpoint=endpoint,
        event_type=EventType.PING,
        payload={"message": "Test event from PayLesShopMore.", "sent_at": timezone.now().isoformat()},
    )
    from .tasks import deliver_webhook

    deliver_webhook.delay(str(delivery.pk))
    return delivery
