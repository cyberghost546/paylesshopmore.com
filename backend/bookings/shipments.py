"""Turning a booking into a shipment.

A booking is what the customer filled in ("My bookings" on their profile).
A shipment - accounts.Package - is what the company actually moves, with a
tracking number, a journey and an invoice ("My shipments"). Until the office
picks a booking up the two are unrelated; the moment the office starts working
on it, the booking becomes a shipment, so the customer can follow it under
"My shipments" from then on.

"Starts working on it" is a status change in the dashboard away from New to
any of CREATES_SHIPMENT. Called from staff.views.BookingViewSet.perform_update,
the one place staff change a booking.

Each booking makes at most ONE shipment (Booking.package), however often the
status is changed afterwards: ensure_package_for_booking() returns the shipment
it already made instead of making a second.

Two later booking statuses also move the shipment, so the customer sees it
in the right section of "My shipments" (follow_booking_status):

    booking Shipped    ->  shipment In transit   ("On the way")
    booking Cancelled  ->  shipment Cancelled    ("Cancelled")

Everything else about the shipment's journey (paid, arrived, delivered...) is
done under Packages in the dashboard, with the rules in accounts.models.Package.
"""

from django.db import transaction
from django.utils import timezone

from accounts.events import record_event
from accounts.models import InvalidShipmentTransition, Package, PackageEvent
from accounts.warehouse import follow_status
from notifications.services import notify_shipment_status

from .models import Booking

# The booking statuses that mean "the office is working on this": changing a
# booking to any of these creates its shipment. Not NEW (nobody has looked at
# it yet) and not CANCELLED (there is nothing to ship).
CREATES_SHIPMENT = (
    Booking.Status.CONFIRMED,
    Booking.Status.BOOKED_IN,
    Booking.Status.SHIPPED,
)

# The booking's Zeevracht / Luchtvracht, as the shipment's own freight values.
# Both use "sea" and "air" today; the mapping keeps it that way if one changes.
FREIGHT = {
    Booking.Freight.SEA: Package.Freight.SEA,
    Booking.Freight.AIR: Package.Freight.AIR,
}


# Booking statuses that move the shipment too, and where to.
MOVES_SHIPMENT = {
    Booking.Status.SHIPPED: Package.Status.IN_TRANSIT,
    Booking.Status.CANCELLED: Package.Status.CANCELLED,
}


def why_no_shipment(booking):
    """Why this booking cannot become a shipment, or None if it can.

    The answers are codes for the dashboard to put into words:
      "no_account"  sent without signing in: there is no customer account for
                    the shipment to belong to, so it could never show under
                    anybody's "My shipments".
    """
    if booking.user_id is None:
        return "no_account"
    return None


def ensure_package_for_booking(booking):
    """The booking's shipment: the one it already has, or a new one now.

    Returns None - and creates nothing - while the booking is still New or
    is cancelled, or when it was sent without an account (see why_no_shipment).

    Safe to call as often as you like: a booking never gets two shipments.
    """
    if booking.package_id:
        return booking.package
    if booking.status not in CREATES_SHIPMENT or why_no_shipment(booking):
        return None

    with transaction.atomic():
        # Lock the booking row, so two staff saving it at the same moment
        # can't both see "no shipment yet" and make one each.
        locked = Booking.objects.select_for_update().get(pk=booking.pk)
        if locked.package_id:
            booking.package = locked.package
            return locked.package

        package = Package.objects.create(
            user=booking.user,
            tracking_number=tracking_number_for(booking),
            description=description_for(booking),
            freight=FREIGHT.get(booking.freight, ""),
            # The counter's figures, when it has already filled them in.
            weight_kg=booking.weight_kg,
            value_eur=booking.value_eur,
            delivery_address_text=delivery_address_for(booking),
            # status and warehouse_stage keep the model's defaults: a quote
            # that is expected at the warehouse - the start of every journey.
        )
        # .update() writes only the link column. A save() would also write
        # back everything else on this in-memory copy of the booking.
        booking.package = package
        Booking.objects.filter(pk=booking.pk).update(package=package)
        return package


def tracking_number_for(booking):
    """A tracking number nobody else has.

    The office's shipping number when it has given one (so the customer sees
    the number on their paperwork), otherwise one made from the booking's own
    number: booking 3 -> PLSM-B00003. If that is somehow taken, -2, -3 ... is
    added until it isn't.
    """
    base = booking.shipping_number.strip() or f"PLSM-B{booking.pk:05d}"
    candidate = base
    suffix = 2
    while Package.objects.filter(tracking_number__iexact=candidate).exists():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def description_for(booking):
    """What is in it, in the customer's words: "Bol.com: PS5; Bol.com: Gaming pc".

    The same summary "My bookings" shows. Falls back to the contents line,
    and then to the booking's number, so the shipment is never nameless.
    """
    orders = "; ".join(f"{order.shop_name}: {order.description}" for order in booking.orders.all())
    return orders or booking.contents.strip() or f"Booking #{booking.pk}"


def delivery_address_for(booking):
    """The recipient's address as text, country on the LAST line.

    Package.destination_label reads the country from the last line, which is
    what "My shipments" and the tracking page show as the destination.
    """
    lines = [
        booking.recipient_name,
        booking.recipient_address,
        booking.recipient_city,
        booking.destination_label,
    ]
    return "\n".join(line.strip() for line in lines if line and line.strip())


def follow_booking_status(booking, actor=None):
    """Make the booking's shipment match the booking, after a status change.

    Creates the shipment if it doesn't exist yet (ensure_package_for_booking),
    then moves it when the booking says so (MOVES_SHIPMENT): a booking marked
    Shipped puts its shipment In transit, which is "On the way" under the
    customer's "My shipments".

    Does the same as marking the shipment by hand under Packages
    (staff.views.PackageViewSet.perform_update): stamps when it left, writes
    the move into the shipment's history, updates the warehouse board, and
    e-mails the customer.

    Leaves the shipment alone - and does not complain - when it can't move
    that way, because the booking change itself was fine:
      - it is already there, or further (a shipment that has arrived is not
        sent back to In transit);
      - it was delivered or cancelled, which is final;
      - cancelling, but it has already left.

    Returns the shipment, or None when the booking has none.
    """
    package = ensure_package_for_booking(booking)
    if package is None:
        return None

    target = MOVES_SHIPMENT.get(booking.status)
    if target is None or package.status == target:
        return package

    # Ask the shipment's own rules first (forwards only, nothing after final).
    try:
        package.check_transition(target)
    except InvalidShipmentTransition:
        return package

    previous_status = package.status
    with transaction.atomic():
        package.status = target
        # Only ever set, never overwritten: the first time it left is when it left.
        if target == Package.Status.IN_TRANSIT and package.shipped_at is None:
            package.shipped_at = timezone.now()
        package.save()

        # The same three follow-ups as a change made under Packages.
        record_event(
            package,
            PackageEvent.Kind.STATUS_CHANGED,
            actor=actor,
            from_status=previous_status,
            to_status=target,
        )
        follow_status(package, actor=actor)
        notify_shipment_status(package, previous_status)

    return package


# The warehouse stages that mean it has been measured: from here the office
# has what it needs to make the invoice (see ready_to_invoice).
MEASURED_STAGES = (
    Package.WarehouseStage.MEASURED,
    Package.WarehouseStage.AWAITING_PACKAGING,
    Package.WarehouseStage.PACKED,
    Package.WarehouseStage.READY,
    Package.WarehouseStage.SHIPPED,
)


def ready_to_invoice(package):
    """The warehouse has measured it and nobody has made its invoice yet."""
    return bool(
        package is not None
        and package.status != Package.Status.CANCELLED
        and package.warehouse_stage in MEASURED_STAGES
        and getattr(package, "invoice", None) is None
    )

def send_to_warehouse(booking, actor=None):
    """Put a booking that has its shipping number on the warehouse floor.

    The office's order of work: a booking comes in, the office gives it a
    shipping number, and from then on it is the warehouse's to receive, check
    and measure - before anything is paid, because the invoice is made from
    what the warehouse measured.

    So, once the booking has a shipping number:
      - a booking still New is confirmed (the number is the office taking it
        on), which creates its shipment as any confirmation does;
      - the shipment is marked sent (Package.sent_to_warehouse_at), which is
        what puts an unpaid shipment on the floor's list (warehouse/
        shipments.py board_queryset), as "Package expected".

    Returns the shipment, or None when the booking cannot go: no shipping
    number yet, cancelled, or sent without an account (there is no customer
    for a shipment to belong to - see why_no_shipment). Safe to repeat.
    """
    if not (booking.shipping_number or "").strip():
        return None
    if booking.status == Booking.Status.CANCELLED or why_no_shipment(booking):
        return None

    if booking.status == Booking.Status.NEW:
        booking.status = Booking.Status.CONFIRMED
        Booking.objects.filter(pk=booking.pk).update(status=booking.status, updated_at=timezone.now())

    package = ensure_package_for_booking(booking)
    if package is None or package.sent_to_warehouse_at is not None:
        return package

    now = timezone.now()
    fields = ["sent_to_warehouse_at", "updated_at"]
    package.sent_to_warehouse_at = now
    # "Waiting too long" on the floor counts from when it was sent there,
    # not from when the booking was first confirmed.
    if package.warehouse_stage == Package.WarehouseStage.AWAITING_PICKUP:
        package.warehouse_stage_at = now
        fields.append("warehouse_stage_at")
    package.save(update_fields=fields)
    intake_sheet_for(booking, package)
    return package


def intake_sheet_for(booking, package):
    """The intake sheet for a booking sent to the warehouse: one ready for the
    floor, with the shipping number written on it, or the one it already has.

    Every shipment that goes to the warehouse gets its own sheet, so when the
    goods come in the workers open it, check them against it and fill in the
    rest - colli, packaging, the checks, the measurements - instead of starting
    a blank form and copying the number off a screen.

    Filled in from what the office knows (a head start, all of it editable):
    the shipping number as its reference, the freight, where it goes, who sends
    and receives it, the shops ordered from, the count and the contents.

    Nobody has signed it yet: the first person to save it does (warehouse/
    views.py IntakeSheetViewSet.perform_update). Returns the sheet.
    """
    from warehouse.models import IntakeSheet

    existing = IntakeSheet.objects.filter(models_q_for(booking, package)).order_by("created_at").first()
    if existing is not None:
        return existing

    shops = ", ".join(dict.fromkeys(order.shop_name for order in booking.orders.all() if order.shop_name))
    return IntakeSheet.objects.create(
        reference=booking.shipping_number.strip(),
        booking=booking,
        package=package,
        freight=booking.freight or "",
        destination=booking.destination_other or booking.destination_label,
        sender=booking.sender_name,
        recipient=booking.recipient_name,
        supplier=shops[:255],
        colli_count=booking.quantity,
        notes=(booking.contents or "").strip(),
    )


def models_q_for(booking, package):
    """Sheets linked to this booking or its shipment."""
    from django.db.models import Q

    return Q(booking=booking) | Q(package=package)


class SendRefused(Exception):
    """Why a booking cannot go to the warehouse - a sentence for the office."""


def number_and_send(booking, actor=None):
    """The office's "Send to warehouse" button.

    Gives the booking the next shipping number (PLSM-00001, PLSM-00002 ...)
    when it has none - a number typed by hand is kept - and sends it to the
    warehouse with its intake sheet (send_to_warehouse). Raises SendRefused
    for a booking that cannot go.
    """
    from .models import ShippingNumberSequence

    if booking.status == Booking.Status.CANCELLED:
        raise SendRefused("This booking was cancelled, so it cannot go to the warehouse.")
    if why_no_shipment(booking) == "no_account":
        raise SendRefused(
            "This booking was sent without an account, so it cannot go to the warehouse. "
            "Add it under Packages instead."
        )

    with transaction.atomic():
        if not booking.shipping_number.strip():
            booking.shipping_number = ShippingNumberSequence.next_number()
            Booking.objects.filter(pk=booking.pk).update(
                shipping_number=booking.shipping_number, updated_at=timezone.now()
            )
        package = send_to_warehouse(booking, actor=actor)
    return package
