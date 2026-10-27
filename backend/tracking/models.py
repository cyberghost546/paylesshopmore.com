"""The database tables for courier tracking.

THE BIG PICTURE
A parcel travels in two stages, and each stage can have a courier tracking
number of its own:

  1. INCOMING  webshop -> our warehouse in the Netherlands. The tracking number
               of a webshop order on a booking (bookings.BookingOrder - one
               order can arrive in several parcels) or of a pre-alert.
  2. OUTGOING  our warehouse -> Aruba, Bonaire or Curacao. The courier or
               forwarder number of one of OUR shipments (accounts.Package,
               PLSM-00001), entered by the office when it leaves.

    BookingOrder 1 --- *    CarrierShipment (incoming)
    PreAlert     1 --- 0..1 CarrierShipment (incoming)
    Package      1 --- *    CarrierShipment (outgoing)

    CarrierShipment 1 --- * TrackingEvent          its history
    CarrierShipment 1 --- * TrackingNumberChange   corrections, for the record
    Carrier         1 --- 0..1 CarrierIntegration  the carrier's own API: on/off,
                                                   tested or not (never secrets)

  Carrier              a courier we can pick from the list (PostNL, DHL, ...).
  CarrierShipment      one courier tracking number, which stage it is, and where
                       that parcel is now (status, location, delivery date).
  TrackingEvent        one line of its history: "In transit - Utrecht - 14:02".
  TrackingNumberChange a wrong number or courier corrected by staff: old, new,
                       who and why.
  CarrierIntegration   whether the carrier's own API is switched on and whether
                       a real test succeeded. The API keys themselves are never
                       here: they live in environment variables (adapters/).
  TrackingSyncLog      one call to a tracking service, for when something breaks.

Our own shipment record (statuses, warehouse stages, invoice) is still
accounts.Package and accounts.PackageEvent; an outgoing CarrierShipment only
adds the carrier's own tracking of that trip.
"""

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .statuses import FINAL_STATUSES, TrackingStatus


class Carrier(models.Model):
    """A courier in the "Courier company" list.

    Rows, not code, so the office can add one in Django's admin without a
    deploy. The list starts with the couriers Dutch webshops use (see the
    migration 0002_seed_carriers).
    """

    # Short, stable name used by the API and the frontend: "postnl".
    code = models.SlugField(max_length=40, unique=True)
    # What people see: "PostNL".
    name = models.CharField(max_length=80)
    # This courier's number in 17TRACK's list
    # (https://res.17track.net/asset/carrier/info/apicarrier.all.json).
    # Empty = let 17TRACK work out the courier from the number itself.
    seventeen_track_code = models.PositiveIntegerField(null=True, blank=True)
    # The courier's own tracking page, with {number} where the tracking number
    # goes, e.g. "https://www.ups.com/track?tracknum={number}". Empty = the
    # site links to 17TRACK's page instead, which knows every courier.
    tracking_url_template = models.URLField(max_length=300, blank=True)
    # False for "Walk-in" (brought by hand): there is no courier to ask.
    trackable = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    # Order in the drop-down list; lower comes first.
    position = models.PositiveSmallIntegerField(default=100)

    class Meta:
        ordering = ["position", "name"]

    def __str__(self):
        return self.name

    def tracking_url(self, number):
        """The link to follow `number` on this courier's own site.

        The number is URL-encoded before it goes in, so whatever a customer
        typed can never change where the link points.
        """
        from urllib.parse import quote

        if not self.trackable or not number:
            return None
        template = self.tracking_url_template or UNIVERSAL_TRACKING_URL
        return template.replace("{number}", quote(number, safe=""))


# Works for any courier: 17TRACK detects it from the number.
UNIVERSAL_TRACKING_URL = "https://t.17track.net/en#nums={number}"


class CarrierShipment(models.Model):
    """One courier tracking number for one stage of a parcel, and its latest state."""

    class Stage(models.TextChoices):
        INCOMING = "incoming", "Incoming (to our warehouse)"
        OUTGOING = "outgoing", "Outgoing (to the destination)"

    # Which tracking service fetches its updates (tracking/adapters/). Blank:
    # none - only staff add updates.
    PROVIDER_CHOICES = [
        ("", "None (manual updates only)"),
        ("17track", "17TRACK"),
        ("postnl", "PostNL API"),
        ("dhl", "DHL API"),
        ("dpd", "DPD API"),
        ("amazon", "Amazon Shipping API"),
        ("fedex", "FedEx API"),
        ("mock", "Mock provider (test data)"),
    ]

    stage = models.CharField(max_length=10, choices=Stage.choices, default=Stage.INCOMING)

    # What this parcel belongs to: exactly ONE of these three (see the
    # constraint below).
    #   order           a webshop order on a booking (incoming). An order may
    #                   arrive in several parcels, so several rows.
    #   prealert        a pre-alert the customer registered (incoming).
    #   onward_package  one of our shipments, on its way to the island
    #                   (outgoing). Several rows if it travels in several legs.
    order = models.ForeignKey(
        "bookings.BookingOrder",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="carrier_shipments",
    )
    prealert = models.OneToOneField(
        "prealerts.PreAlert",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="carrier_shipment",
    )
    onward_package = models.ForeignKey(
        "accounts.Package",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="onward_shipments",
    )
    # Who registered the number: the customer (on their order or pre-alert)
    # or a staff member (Dashboard -> Courier tracking). Null for rows made
    # before this was recorded, which were all the customer's own.
    entered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    # Whose parcel it is, written once when the row is made, so "this
    # customer's parcels" is one simple query whichever of the two it hangs
    # off. Null for a booking sent without signing in.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="carrier_shipments",
    )
    # PROTECT: a courier that has shipments cannot be deleted by accident -
    # switch it off (is_active) instead.
    carrier = models.ForeignKey(
        Carrier, on_delete=models.PROTECT, null=True, blank=True, related_name="shipments"
    )
    # Cleaned up by normalize.normalize_tracking_number: upper case, no spaces.
    tracking_number = models.CharField(max_length=64, db_index=True)

    # Where the parcel is now - copied from the newest event, so lists can be
    # shown without reading every event.
    status = models.CharField(
        max_length=32, choices=TrackingStatus.choices, default=TrackingStatus.ORDER_REGISTERED
    )
    last_location = models.CharField(max_length=200, blank=True)
    estimated_delivery = models.DateField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    # --- Talking to the tracking service ---
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES, blank=True)
    # The courier code the service detected or was given (17TRACK's number).
    provider_carrier_code = models.PositiveIntegerField(null=True, blank=True)
    # When the number was registered with the service (it only sends data for
    # registered numbers). Null = not yet.
    registered_at = models.DateTimeField(null=True, blank=True)
    # The last time fresh data arrived without an error. Shown to customers as
    # "last updated".
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # When the next automatic check is due. Null = never again (finished, or
    # tracking is off for this courier).
    next_sync_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Failed checks in a row; used to wait longer between retries.
    sync_failures = models.PositiveSmallIntegerField(default=0)
    last_sync_error = models.CharField(max_length=300, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["status"])]
        constraints = [
            # Belongs to exactly one thing, and the stage matches it: an order
            # or a pre-alert comes IN, one of our shipments goes OUT.
            models.CheckConstraint(
                condition=(
                    Q(order__isnull=False, prealert__isnull=True, onward_package__isnull=True, stage="incoming")
                    | Q(order__isnull=True, prealert__isnull=False, onward_package__isnull=True, stage="incoming")
                    | Q(order__isnull=True, prealert__isnull=True, onward_package__isnull=False, stage="outgoing")
                ),
                name="carrier_shipment_one_parent_and_stage",
            ),
        ]

    def __str__(self):
        return f"{self.carrier or 'Unknown courier'} {self.tracking_number}"

    @property
    def is_final(self):
        """True when the parcel is with us or not coming: nothing left to fetch."""
        return self.status in FINAL_STATUSES

    # ---- What the rest of the site reads, whichever parent it has ----

    @property
    def customer(self):
        return self.owner

    @property
    def is_outgoing(self):
        return self.stage == self.Stage.OUTGOING

    @property
    def entered_by_customer(self):
        """True when the customer registered this number themselves (or the
        row predates recording who did)."""
        return self.entered_by_id is None or self.entered_by_id == self.owner_id

    @property
    def booking(self):
        """The booking the order is on, or None (pre-alert, outgoing)."""
        return self.order.booking if self.order_id else None

    @property
    def shop_name(self):
        if self.order_id:
            return self.order.shop_name
        if self.prealert_id:
            return self.prealert.shop_name
        return ""

    @property
    def item_description(self):
        """What is inside, in the customer's words (or our shipment's)."""
        if self.order_id:
            return self.order.description
        if self.prealert_id:
            return self.prealert.description
        return self.onward_package.description

    @property
    def package(self):
        """Our shipment (PLSM-...) it belongs to, or None while it has none."""
        if self.onward_package_id:
            return self.onward_package
        if self.order_id:
            return self.order.booking.package
        return self.prealert.package

    @property
    def reference(self):
        """Our own reference: the pre-alert's, the booking's or the shipment's number."""
        if self.prealert_id:
            return self.prealert.reference
        if self.onward_package_id:
            return self.onward_package.tracking_number
        return self.order.booking.shipping_number or None


class TrackingEvent(models.Model):
    """One line in a courier shipment's history.

    Never deleted. A wrong line is "voided" (voided_at set) with the reason
    and who did it, so the history stays honest about what was shown before.
    """

    class Source(models.TextChoices):
        # Verified: the data came from the courier, via the tracking service.
        CARRIER_API = "carrier_api", "Courier (fetched)"
        WEBHOOK = "webhook", "Courier (pushed)"
        # Made up by the mock provider for testing - never real, always
        # labelled "Test data" wherever it is shown (adapters/mock.py).
        MOCK = "mock", "Test data (mock provider)"
        # Entered by a person at our office or warehouse.
        STAFF = "staff", "Our staff"
        # Done by our own system, e.g. the warehouse receiving the parcel.
        SYSTEM = "system", "Our system"

    VERIFIED_SOURCES = {Source.CARRIER_API, Source.WEBHOOK}

    shipment = models.ForeignKey(CarrierShipment, on_delete=models.CASCADE, related_name="events")
    # Blank for a courier line that is just information ("Parcel sorted").
    status = models.CharField(max_length=32, choices=TrackingStatus.choices, blank=True)
    description = models.CharField(max_length=500, blank=True)
    location = models.CharField(max_length=200, blank=True)
    # When it happened according to the courier (or the staff member). Null
    # when the courier gave no usable time.
    occurred_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices)
    # The staff member who typed it; null for courier data.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    # A fingerprint of a courier event, so fetching the same history twice
    # does not add the same lines twice (see the constraint below).
    external_id = models.CharField(max_length=64, blank=True)

    # Correcting a mistake without erasing it.
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    void_reason = models.CharField(max_length=300, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Newest first; events without a time go last.
        ordering = [models.F("occurred_at").desc(nulls_last=True), "-id"]
        constraints = [
            # The same courier event can be stored only once per shipment.
            models.UniqueConstraint(
                fields=["shipment", "external_id"],
                condition=~Q(external_id=""),
                name="tracking_event_unique_external_id",
            )
        ]

    def __str__(self):
        return f"{self.shipment}: {self.get_status_display() or self.description}"

    @property
    def verified(self):
        """True when the line came from the courier, not from us."""
        return self.source in self.VERIFIED_SOURCES

    @property
    def test_data(self):
        """True for made-up lines from the mock provider (never real)."""
        return self.source == self.Source.MOCK

    def void(self, user, reason):
        """Hide this line from the customer, keeping it on record."""
        self.voided_at = timezone.now()
        self.voided_by = user
        self.void_reason = reason[:300]
        self.save(update_fields=["voided_at", "voided_by", "void_reason"])


class TrackingSyncLog(models.Model):
    """One conversation with the tracking service - kept for troubleshooting.

    "Why has this parcel not updated?" is answered here: was it checked, and
    what did the service say. Old rows can be deleted at any time.
    """

    class Kind(models.TextChoices):
        REGISTER = "register", "Register numbers"
        FETCH = "fetch", "Fetch updates"
        WEBHOOK = "webhook", "Webhook received"

    kind = models.CharField(max_length=20, choices=Kind.choices)
    # Null when one call covered many shipments (a batch).
    shipment = models.ForeignKey(
        CarrierShipment, on_delete=models.SET_NULL, null=True, blank=True, related_name="sync_logs"
    )
    numbers = models.PositiveSmallIntegerField(default=0)
    ok = models.BooleanField(default=False)
    http_status = models.PositiveSmallIntegerField(null=True, blank=True)
    message = models.CharField(max_length=500, blank=True)
    events_added = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()} ({'ok' if self.ok else 'failed'})"


class TrackingNumberChange(models.Model):
    """A courier or tracking number corrected by staff - kept for the record.

    The shipment row then carries the new number; this says what it was, what
    it became, who changed it and why, so "the number changed" is never a
    mystery later.
    """

    shipment = models.ForeignKey(CarrierShipment, on_delete=models.CASCADE, related_name="number_changes")
    old_carrier = models.ForeignKey(Carrier, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    old_tracking_number = models.CharField(max_length=64)
    new_carrier = models.ForeignKey(Carrier, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    new_tracking_number = models.CharField(max_length=64)
    reason = models.CharField(max_length=300)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at"]

    def __str__(self):
        return f"{self.old_tracking_number} -> {self.new_tracking_number}"


class CarrierIntegration(models.Model):
    """The state of one carrier's own API connection (tracking/adapters/).

    What is stored here is only what is safe to show on the settings page:
    whether the office switched it on, which environment, and the result of
    the last real test. The credentials themselves are NEVER stored in the
    database - they are environment variables on the server (see
    adapters/<carrier>.py for each one's names, and docs/CARRIER_INTEGRATIONS.md).

    The adapter is only used for real requests when all of these hold:
      - its environment variables are set (adapters say so),
      - enabled is on (the admin switched it on),
      - verified_at is set: a "Test connection" succeeded after the last
        change. A change of environment clears it again.
    """

    class Environment(models.TextChoices):
        SANDBOX = "sandbox", "Sandbox (test)"
        PRODUCTION = "production", "Production (live)"

    # The adapter's name: "postnl", "dhl", "dpd", "amazon", "fedex".
    code = models.SlugField(max_length=20, unique=True)
    enabled = models.BooleanField(default=False)
    environment = models.CharField(max_length=12, choices=Environment.choices, default=Environment.SANDBOX)

    # The last "Test connection": when, whether it worked, what it said.
    last_test_at = models.DateTimeField(null=True, blank=True)
    last_test_ok = models.BooleanField(null=True, blank=True)
    last_test_message = models.CharField(max_length=300, blank=True)
    # Set by a successful test, cleared by a failed one or a change of
    # environment. Only a verified, enabled integration makes real requests.
    verified_at = models.DateTimeField(null=True, blank=True)

    # From real use: the last successful fetch and the last error.
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_error = models.CharField(max_length=300, blank=True)
    last_error_at = models.DateTimeField(null=True, blank=True)

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} ({'on' if self.enabled else 'off'})"
