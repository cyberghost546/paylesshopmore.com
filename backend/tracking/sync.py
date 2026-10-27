"""Keeping courier shipments up to date.

HOW UPDATES ARRIVE (two ways, both end in apply_result())
1. Push (webhook): 17TRACK calls /api/tracking/webhooks/17track/ when a number
   changes. Fast and costs no requests. See views.SeventeenTrackWebhookView.
2. Poll: `python manage.py sync_carrier_tracking`, run on a schedule
   (carrier-tracking in .do/app.yaml), asks about every shipment whose next_sync_at
   has come. A safety net for missed pushes.

AVOIDING UNNECESSARY REQUESTS
- Numbers are sent in batches of 40 (one request instead of forty).
- Each shipment is only checked when its next_sync_at is due.
- A shipment that is delivered, returned or with us is never checked again.
- After a failure we wait longer each time (15 min, 30, 1 h, ... up to a day).

WHO IS ASKED (tracking/adapters/)
Each shipment is tracked by one adapter, chosen by adapters.choose_adapter:
the mock provider for MOCK... test numbers (development only), the courier's
own API once it is set up and tested, otherwise 17TRACK, otherwise nobody
(staff update it by hand). The adapter's code is stored in
CarrierShipment.provider, and shipments are batched per adapter.

NEVER MAKING THINGS UP
Only data that came from the courier is stored as a courier event. If the
service has nothing, the shipment simply does not move. Staff can add their
own lines (add_staff_event), and those are always marked as ours. Mock data is
stored with source "mock", so it can never pass for courier data.
"""

import hashlib
import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .adapters import SEVENTEEN_TRACK, choose_adapter
from .models import CarrierShipment, TrackingEvent, TrackingSyncLog
from .providers import CredentialsError, ProviderError, TemporaryProviderError
from .statuses import NOTIFY_STATUSES, TrackingStatus

logger = logging.getLogger(__name__)

# Stop polling a shipment this long after it was registered: a parcel that has
# not arrived in two months will not, and staff can still update it by hand.
GIVE_UP_AFTER = timedelta(days=60)
MAX_BACKOFF = timedelta(hours=24)


def poll_interval():
    """Time between automatic checks of one shipment (TRACKING_POLL_HOURS, default 6)."""
    return timedelta(hours=getattr(settings, "TRACKING_POLL_HOURS", 6))


def _backoff(failures):
    """How long to wait after `failures` failed checks in a row: 15 min, 30, 60, ... max 24 h."""
    return min(timedelta(minutes=15) * (2 ** max(failures - 1, 0)), MAX_BACKOFF)


# ---- starting to follow a number ---------------------------------------------------


def start_tracking(shipment):
    """Mark a new (or changed) number as due for its first automatic check.

    Called when the customer saves a tracking number. The actual call to the
    service happens in the next sync run (or straight away from the view, see
    register_now), so a slow tracking service never slows down the customer.
    """
    adapter = choose_adapter(shipment)
    shipment.provider = adapter.code if adapter else ""
    shipment.registered_at = None
    shipment.provider_carrier_code = None
    shipment.sync_failures = 0
    shipment.last_sync_error = ""
    shipment.next_sync_at = timezone.now() if shipment.provider else None
    shipment.save()


def register_now(shipment):
    """Try to register and fetch one shipment immediately; never raises.

    Used right after the customer saves a number, so the first courier data
    usually shows up within seconds. If the service is slow or down, the
    scheduled sync picks the shipment up later.
    """
    try:
        sync_shipments([shipment])
    except Exception:  # noqa: BLE001 - a tracking hiccup must not break saving the number
        logger.exception("Immediate tracking sync failed for shipment %s.", shipment.pk)


# ---- the scheduled run --------------------------------------------------------------


def due_shipments(limit=400):
    """Shipments whose automatic check is due now."""
    return (
        CarrierShipment.objects.select_related("carrier", "owner")
        .filter(next_sync_at__lte=timezone.now())
        .exclude(provider="")
        .order_by("next_sync_at")[:limit]
    )


def sync_due(limit=400):
    """Check every due shipment. Returns a short summary dict (for the command's output)."""
    return sync_shipments(list(due_shipments(limit)))


def sync_shipments(shipments):
    """Register what still needs registering, then fetch updates for the rest.

    Shipments are grouped per adapter (17TRACK, DHL, mock ...) and each group
    is asked in batches of that adapter's size.

    Returns {"registered": n, "updated": n, "failed": n}.
    Raises CredentialsError (after recording it, and after the other adapters
    had their turn) when a key is refused, so the scheduled job fails loudly
    instead of quietly doing nothing.
    """
    summary = {"registered": 0, "updated": 0, "failed": 0}
    if not shipments:
        return summary

    # Old shipments are given up on rather than checked forever.
    now = timezone.now()
    groups = {}
    for shipment in shipments:
        if shipment.is_final or shipment.created_at < now - GIVE_UP_AFTER:
            CarrierShipment.objects.filter(pk=shipment.pk).update(next_sync_at=None)
            continue
        adapter = choose_adapter(shipment)
        if adapter is None:
            # Nobody can track it any more (e.g. the key was removed): stop
            # asking; staff can still update it by hand.
            CarrierShipment.objects.filter(pk=shipment.pk).update(provider="", next_sync_at=None)
            continue
        if adapter.code != shipment.provider:
            # A different adapter took over (a carrier's own API was switched
            # on, say): start fresh with it.
            shipment.provider = adapter.code
            shipment.registered_at = None
            shipment.provider_carrier_code = None
            shipment.save(update_fields=["provider", "registered_at", "provider_carrier_code", "updated_at"])
        groups.setdefault(adapter.code, (adapter, []))[1].append(shipment)

    refused = None
    for adapter, group in groups.values():
        try:
            _sync_group(adapter, group, summary)
        except CredentialsError as error:
            refused = refused or error
    if refused is not None:
        raise refused
    return summary


def _sync_group(adapter, group, summary):
    new = [s for s in group if s.registered_at is None]
    if adapter.needs_registration:
        for batch in _batches(new, adapter.batch_size):
            summary["registered"] += _register_batch(adapter, batch, summary)
    else:
        # Nothing to register with this API: ask about the number directly.
        now = timezone.now()
        for shipment in new:
            shipment.registered_at = now
            shipment.save(update_fields=["registered_at", "updated_at"])

    registered = [s for s in group if s.registered_at is not None]
    for batch in _batches(registered, adapter.batch_size):
        summary["updated"] += _fetch_batch(adapter, batch, summary)


def _batches(items, size):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _carrier_code(adapter, shipment):
    """What we tell the adapter about the courier along with the number."""
    if adapter is SEVENTEEN_TRACK:
        if shipment.provider_carrier_code:
            return shipment.provider_carrier_code
        return shipment.carrier.seventeen_track_code if shipment.carrier else None
    return shipment.carrier.code if shipment.carrier else None


def _note_integration(adapter, error=None):
    """The last sync (or the last error) on the adapter's settings row."""
    try:
        row = adapter.integration()
        now = timezone.now()
        if error is None:
            row.last_sync_at = now
            row.save(update_fields=["last_sync_at", "updated_at"])
        else:
            row.last_error = str(error)[:300]
            row.last_error_at = now
            row.save(update_fields=["last_error", "last_error_at", "updated_at"])
    except Exception:  # noqa: BLE001 - bookkeeping must not stop the sync
        logger.exception("Could not note the sync on integration %s.", adapter.code)


def _register_batch(adapter, batch, summary):
    items = [(s.tracking_number, _carrier_code(adapter, s)) for s in batch]
    try:
        result = adapter.register(items)
    except ProviderError as error:
        _record_failure(adapter, batch, error, TrackingSyncLog.Kind.REGISTER, summary)
        return 0

    accepted = dict(result.accepted)
    rejected = dict(result.rejected)
    now = timezone.now()
    count = 0
    for shipment in batch:
        if shipment.tracking_number in accepted:
            shipment.registered_at = now
            shipment.provider_carrier_code = accepted[shipment.tracking_number] or (
                shipment.provider_carrier_code if adapter is not SEVENTEEN_TRACK else _carrier_code(adapter, shipment)
            )
            shipment.sync_failures = 0
            shipment.last_sync_error = ""
            # Fetch straight away in the same run: data may already be there.
            shipment.next_sync_at = now
            count += 1
        else:
            # The service does not recognise the number (a typo, or a courier
            # it does not cover). Keep it for staff, stop asking.
            shipment.last_sync_error = str(rejected.get(shipment.tracking_number, "Not accepted"))[:300]
            shipment.next_sync_at = None
        shipment.save(
            update_fields=[
                "registered_at",
                "provider_carrier_code",
                "sync_failures",
                "last_sync_error",
                "next_sync_at",
                "updated_at",
            ]
        )
    TrackingSyncLog.objects.create(
        kind=TrackingSyncLog.Kind.REGISTER,
        numbers=len(batch),
        ok=True,
        http_status=result.http_status,
        message=f"{adapter.code}: {count} accepted, {len(batch) - count} rejected",
    )
    return count


def _fetch_batch(adapter, batch, summary):
    items = [(s.tracking_number, _carrier_code(adapter, s)) for s in batch]
    try:
        result = adapter.fetch(items)
    except ProviderError as error:
        _record_failure(adapter, batch, error, TrackingSyncLog.Kind.FETCH, summary)
        return 0

    by_number = {}
    for shipment in batch:
        by_number.setdefault(shipment.tracking_number, []).append(shipment)

    source = TrackingEvent.Source(adapter.event_source)
    added = 0
    updated = 0
    for track in result.accepted:
        for shipment in by_number.pop(track.number, []):
            added += apply_result(shipment, track, source)
            updated += 1

    # Numbers the service said it does not know: keep them for staff, note why.
    rejected = dict(result.rejected)
    now = timezone.now()
    for number, leftovers in by_number.items():
        for shipment in leftovers:
            if number in rejected:
                shipment.last_sync_error = str(rejected[number])[:300]
            # Try again at the normal pace: a brand-new number is often
            # unknown for the first hours.
            shipment.next_sync_at = now + poll_interval()
            shipment.save(update_fields=["last_sync_error", "next_sync_at", "updated_at"])

    TrackingSyncLog.objects.create(
        kind=TrackingSyncLog.Kind.FETCH,
        numbers=len(batch),
        ok=True,
        http_status=result.http_status,
        events_added=added,
        message=f"{adapter.code}: {updated} updated",
    )
    _note_integration(adapter)
    return updated


def _record_failure(adapter, batch, error, kind, summary):
    """Note a failed call on every shipment in the batch and plan the retry."""
    summary["failed"] += len(batch)
    now = timezone.now()
    for shipment in batch:
        shipment.sync_failures += 1
        shipment.last_sync_error = str(error)[:300]
        shipment.next_sync_at = now + _backoff(shipment.sync_failures)
        shipment.save(update_fields=["sync_failures", "last_sync_error", "next_sync_at", "updated_at"])
    TrackingSyncLog.objects.create(
        kind=kind,
        numbers=len(batch),
        ok=False,
        http_status=error.http_status,
        message=f"{adapter.code}: {error}"[:500],
    )
    _note_integration(adapter, error)
    if isinstance(error, CredentialsError):
        # Every further call would fail the same way.
        logger.error("Courier tracking via %s stopped: %s", adapter.code, error)
        raise error
    if not isinstance(error, TemporaryProviderError):
        logger.warning("Courier tracking call to %s refused: %s", adapter.code, error)


# ---- storing what the courier said ------------------------------------------------------


def event_fingerprint(event):
    """A short id for a courier event, the same every time it is fetched.

    Couriers do not give their events ids, so the time, text and place
    together identify one. Stored in TrackingEvent.external_id; the database
    refuses a second copy (see TrackingEvent.Meta.constraints).
    """
    text = f"{event.raw_time or event.occurred_at}|{event.description}|{event.location}"
    return hashlib.sha256(text.encode()).hexdigest()[:64]


def apply_result(shipment, track, source):
    """Store a TrackResult on `shipment`. Returns how many new events were added.

    In one transaction: new events, the shipment's status, location and
    expected delivery, and the sync bookkeeping all change together or not
    at all.
    """
    with transaction.atomic():
        # Lock the row, so a webhook and the scheduled job arriving at the
        # same moment cannot both decide the status changed.
        shipment = CarrierShipment.objects.select_for_update().select_related(
            "carrier", "owner"
        ).get(pk=shipment.pk)
        previous_status = shipment.status

        added = 0
        for event in track.events:
            try:
                # A savepoint per row: a duplicate fails alone, not the batch.
                with transaction.atomic():
                    TrackingEvent.objects.create(
                        shipment=shipment,
                        status=event.status,
                        description=event.description,
                        location=event.location,
                        occurred_at=event.occurred_at,
                        source=source,
                        external_id=event_fingerprint(event),
                    )
                    added += 1
            except IntegrityError:
                pass  # seen before

        now = timezone.now()
        # The courier's status wins - unless we already have the parcel in our
        # warehouse; a late "out for delivery" from the courier must not move
        # it backwards.
        warehouse_statuses = {
            TrackingStatus.RECEIVED_AT_WAREHOUSE,
            TrackingStatus.PROCESSING_AT_WAREHOUSE,
            TrackingStatus.READY_FOR_SHIPMENT,
        }
        if track.status and shipment.status not in warehouse_statuses:
            shipment.status = track.status
        if track.location:
            shipment.last_location = track.location
        if track.estimated_delivery:
            shipment.estimated_delivery = track.estimated_delivery
        if track.carrier_code:
            shipment.provider_carrier_code = track.carrier_code
        if shipment.status == TrackingStatus.DELIVERED and shipment.delivered_at is None:
            shipment.delivered_at = now

        shipment.last_synced_at = now
        shipment.sync_failures = 0
        shipment.last_sync_error = ""
        shipment.next_sync_at = None if shipment.is_final else now + poll_interval()
        shipment.save()

        if shipment.status != previous_status and shipment.status in NOTIFY_STATUSES:
            notify_customer(shipment)
    return added


def add_staff_event(shipment, user, *, status, description="", location="", occurred_at=None,
                    source=None):
    """A line typed by our staff (or added by our own system). Returns the event.

    It moves the shipment's status like a courier event would, and is always
    marked as ours, so the customer can tell it apart from courier data.
    """
    source = source or TrackingEvent.Source.STAFF
    with transaction.atomic():
        shipment = CarrierShipment.objects.select_for_update().get(pk=shipment.pk)
        previous_status = shipment.status
        event = TrackingEvent.objects.create(
            shipment=shipment,
            status=status,
            description=description[:500],
            location=location[:200],
            occurred_at=occurred_at or timezone.now(),
            source=source,
            created_by=user,
        )
        if status:
            shipment.status = status
            if status == TrackingStatus.DELIVERED and shipment.delivered_at is None:
                shipment.delivered_at = event.occurred_at
        if location:
            shipment.last_location = location[:200]
        if shipment.is_final:
            shipment.next_sync_at = None
        shipment.save()
        if status and status != previous_status and status in NOTIFY_STATUSES:
            notify_customer(shipment)
    return event


def recompute_status(shipment):
    """After voiding a line: the status becomes that of the newest line left."""
    newest = (
        shipment.events.filter(voided_at__isnull=True).exclude(status="").first()
    )
    shipment.status = newest.status if newest else TrackingStatus.ORDER_REGISTERED
    if shipment.status != TrackingStatus.DELIVERED:
        shipment.delivered_at = None
    shipment.save(update_fields=["status", "delivered_at", "updated_at"])


# ---- our warehouse receiving the parcel -----------------------------------------------------


def mark_received_at_warehouse(package, actor=None):
    """The warehouse received `package`: close the courier leg of its orders.

    Called by accounts.warehouse.move_warehouse_stage. Never raises: receiving
    a parcel must work even if this bookkeeping fails.
    """
    try:
        booking = getattr(package, "booking", None)
        if booking is None:
            return
        shipments = CarrierShipment.objects.filter(
            order__booking=booking, stage=CarrierShipment.Stage.INCOMING
        ).exclude(
            status=TrackingStatus.RECEIVED_AT_WAREHOUSE
        )
        for shipment in shipments:
            add_staff_event(
                shipment,
                actor,
                status=TrackingStatus.RECEIVED_AT_WAREHOUSE,
                description="Received at our warehouse.",
                source=TrackingEvent.Source.SYSTEM,
            )
    except Exception:  # noqa: BLE001
        logger.exception("Could not close the courier tracking of package %s.", package.pk)


# ---- telling the customer ----------------------------------------------------------------------


def notify_customer(shipment):
    """A notification (and e-mail, if they allow it) about an important change."""
    try:
        from notifications.models import Notification
        from notifications.services import _queue_email

        user = shipment.owner
        if user is None:
            return
        notification = Notification.objects.create(
            user=user,
            kind=Notification.Kind.SHIPMENT_STATUS,
            package=shipment.package,
            context={
                "tracking_number": shipment.tracking_number,
                # "courier_delivered", "courier_delayed", ... - the wording is in
                # notifications/messages.py and the frontend translations.
                "status": f"courier_{shipment.status}",
                "shop": shipment.shop_name,
            },
        )
        _queue_email(notification)
    except Exception:  # noqa: BLE001 - a notification problem must not lose the update
        logger.exception("Could not notify about courier shipment %s.", shipment.pk)
