"""The four tables behind integrations.

    ApiKey            a password for one outside program (inbound)
    InboundEvent      a message an outside program pushed to us (inbound)
    WebhookEndpoint   a URL we send our events to (outbound)
    WebhookDelivery   one attempt-tracked message to one endpoint (outbound)
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class Scope(models.TextChoices):
    """What an API key is allowed to do. A key gets only what it needs.

    Example: an accounting program needs "invoices:read" and nothing else, so
    a stolen copy of its key cannot read shipments or push events.
    """

    SHIPMENTS_READ = "shipments:read", "Read shipments"
    INVOICES_READ = "invoices:read", "Read issued invoices and their PDFs"
    EVENTS_WRITE = "events:write", "Send events to us (e.g. tracking or payment updates)"
    # A mail service forwarding e-mails with documents to read (docreview/views.py).
    DOCUMENTS_WRITE = "documents:write", "Send us e-mails and documents to read"


class EventType(models.TextChoices):
    """The events we can send out by webhook."""

    SHIPMENT_STATUS_CHANGED = "shipment.status_changed", "Shipment status changed"
    INVOICE_APPROVED = "invoice.approved", "Invoice approved"
    INVOICE_SENT = "invoice.sent", "Invoice sent to the customer"
    # Sent only by the admin's "send test event" button, so the other side can
    # check their receiver before real events start arriving.
    PING = "ping", "Test event"


class ApiKey(models.Model):
    """One outside program's key.

    We never store the key itself, only a SHA-256 hash of it (see keys.py).
    The key is shown once, when it is created; if it is lost, revoke it and
    make a new one. `prefix` is the short public part, e.g. "plsm_a1b2c3d4",
    so an admin can tell keys apart without seeing the secret.
    """

    name = models.CharField(max_length=100, help_text='Who uses it, e.g. "Moneybird accounting".')
    prefix = models.CharField(max_length=32, unique=True, editable=False)
    key_hash = models.CharField(max_length=64, editable=False)
    scopes = models.JSONField(default=list, help_text="What this key may do.")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Updated at most once a minute (authentication.py), so a busy key does not
    # write to the database on every request.
    last_used_at = models.DateTimeField(null=True, blank=True, editable=False)
    expires_at = models.DateTimeField(null=True, blank=True, help_text="Optional. Empty = never expires.")
    revoked_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "API key"

    def __str__(self):
        return f"{self.name} ({self.prefix}…)"

    @property
    def is_usable(self):
        """Not revoked and not expired."""
        if self.revoked_at is not None:
            return False
        return self.expires_at is None or self.expires_at > timezone.now()

    def has_scope(self, scope):
        return scope in (self.scopes or [])


class InboundEvent(models.Model):
    """A message an outside program sent us with POST /api/integrations/v1/events/.

    Stored as it came, so nothing is lost while we decide what each type
    should do. `external_id` is THEIR id for the message: sending the same id
    twice stores it once (they can safely retry after a timeout).
    """

    api_key = models.ForeignKey(ApiKey, on_delete=models.PROTECT, related_name="events")
    external_id = models.CharField(max_length=100, blank=True)
    type = models.CharField(max_length=100)
    payload = models.JSONField(default=dict)
    received_at = models.DateTimeField(auto_now_add=True)
    # Set by whatever code later acts on the event. Empty = not handled yet.
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-received_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["api_key", "external_id"],
                condition=~models.Q(external_id=""),
                name="inbound_event_once_per_external_id",
            )
        ]

    def __str__(self):
        return f"{self.type} from {self.api_key.name}"


class WebhookEndpoint(models.Model):
    """Where we send events, and which ones.

    `secret` signs every message (webhooks.sign). It is kept in plain text
    because signing needs the real value - unlike an API key, which we only
    ever have to compare against.
    """

    name = models.CharField(max_length=100, help_text='Who receives it, e.g. "Moneybird accounting".')
    url = models.URLField(max_length=500, help_text="Must start with https://")
    secret = models.CharField(max_length=100, editable=False)
    events = models.JSONField(default=list, help_text="Which events to send.")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "webhook endpoint"

    def __str__(self):
        return self.name

    def wants(self, event_type):
        return self.is_active and event_type in (self.events or [])


class WebhookDelivery(models.Model):
    """One event on its way to one endpoint, with its attempts.

    Life of a delivery:
        pending  -> delivered   (their server answered 2xx)
        pending  -> pending     (failed; tried again later, see tasks.py)
        pending  -> failed      (gave up after MAX_ATTEMPTS)
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"

    # Also sent as the message's "id", so the receiver can ignore duplicates.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    endpoint = models.ForeignKey(WebhookEndpoint, on_delete=models.CASCADE, related_name="deliveries")
    event_type = models.CharField(max_length=50)
    payload = models.JSONField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    last_error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "webhook deliveries"
        indexes = [models.Index(fields=["status", "next_attempt_at"])]

    def __str__(self):
        return f"{self.event_type} -> {self.endpoint.name} ({self.status})"
