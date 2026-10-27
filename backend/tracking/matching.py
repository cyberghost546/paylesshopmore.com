"""The warehouse scanning a courier's barcode.

A parcel arrives with the courier's label on it (PostNL, DHL, ...). That label's
barcode is the courier tracking number the customer typed on their order, so
scanning it tells us whose parcel it is - without anybody reading a name.

Two functions:
  find_by_courier_number(code)   which order a scanned code belongs to
  confirm_arrival(shipment, user) record "received at our warehouse", once

MATCHING RULE
Only an exact match on the whole tracking number counts (after the same clean-
up as when the customer typed it: upper case, no spaces). Never a partial
match, never a name: a parcel assigned to the wrong customer is far worse than
one that has to be looked up by hand.
"""

from django.db import transaction

from .models import CarrierShipment, TrackingEvent
from .normalize import InvalidTrackingNumber, normalize_tracking_number
from .statuses import TrackingStatus

# Statuses that mean "we already have it": a second scan must not record a
# second arrival.
ARRIVED = {
    TrackingStatus.RECEIVED_AT_WAREHOUSE,
    TrackingStatus.PROCESSING_AT_WAREHOUSE,
    TrackingStatus.READY_FOR_SHIPMENT,
}


def find_by_courier_number(code):
    """The CarrierShipment whose tracking number is exactly `code`, or None.

    None as well when two customers entered the same number (a typo, or a
    parcel forwarded twice): that is for a person to sort out, not a guess.
    Only incoming numbers: a parcel arriving at the warehouse is never one of
    our own outgoing shipments.
    """
    try:
        number = normalize_tracking_number(code)
    except InvalidTrackingNumber:
        return None
    matches = list(
        CarrierShipment.objects.select_related(
            "carrier", "owner", "order__booking__package", "prealert__package"
        ).filter(tracking_number=number, stage=CarrierShipment.Stage.INCOMING)[:2]
    )
    return matches[0] if len(matches) == 1 else None


def arrival_event(shipment):
    """The (not corrected) "received at our warehouse" line, or None."""
    return (
        shipment.events.filter(status=TrackingStatus.RECEIVED_AT_WAREHOUSE, voided_at__isnull=True)
        .select_related("created_by")
        .first()
    )


def confirm_arrival(shipment, user):
    """Record that this parcel is at our warehouse. Returns (event, already).

    `already` is True when it had been recorded before: the earlier line is
    returned and nothing is added, so scanning the same box twice is harmless.
    The row is locked while checking, so two scanners reading the same box at
    the same moment still record it only once.
    """
    from .sync import add_staff_event

    with transaction.atomic():
        locked = CarrierShipment.objects.select_for_update().get(pk=shipment.pk)
        existing = arrival_event(locked)
        if existing is not None or locked.status in ARRIVED:
            return existing, True
        event = add_staff_event(
            locked,
            user,
            status=TrackingStatus.RECEIVED_AT_WAREHOUSE,
            description="Scanned at our warehouse.",
            source=TrackingEvent.Source.STAFF,
        )
        # A pre-alert: it is with us now (and can no longer be cancelled).
        if locked.prealert_id:
            from prealerts.models import PreAlert

            PreAlert.objects.filter(pk=locked.prealert_id, status=PreAlert.Status.SUBMITTED).update(
                status=PreAlert.Status.ARRIVED, arrived_at=event.occurred_at, arrived_by=user
            )
    return event, False


def scan_summary(shipment):
    """What the scanner shows about a courier match: whose parcel, from where.

    The customer's name, the shop and what was bought - what the floor needs
    to put the box with the right order. No e-mail, phone or address.
    """
    user = shipment.owner
    booking = shipment.booking
    package = shipment.package
    arrival = arrival_event(shipment)
    return {
        "carrier": shipment.carrier.name if shipment.carrier else None,
        "tracking_number": shipment.tracking_number,
        "customer": (user.get_full_name() or user.get_username()) if user else None,
        "shop_name": shipment.shop_name,
        "order_description": shipment.item_description,
        "booking_number": (booking.shipping_number or None) if booking else None,
        # A pre-alert's reference (PA-2026-000123), when it came in that way,
        # and how many invoice files the customer sent with it.
        "prealert_reference": shipment.prealert.reference if shipment.prealert_id else None,
        "invoice_files": shipment.prealert.documents.count() if shipment.prealert_id else None,
        "package_tracking_number": package.tracking_number if package else None,
        "status": shipment.status,
        "status_display": shipment.get_status_display(),
        "arrived": arrival is not None or shipment.status in ARRIVED,
        "arrived_at": arrival.occurred_at if arrival else None,
        "arrived_by": (str(arrival.created_by) if arrival and arrival.created_by else None),
    }
