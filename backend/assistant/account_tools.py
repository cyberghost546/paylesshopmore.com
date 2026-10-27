"""The chat tool that runs HERE, on the server: "where are my parcels?".

Unlike the browser tools (ai.py), this one reads the database, so it runs in
the request, as the signed-in visitor, and only ever for them:

* It is only offered to the model when the visitor is signed in (views.py).
* It takes NO arguments. The model cannot ask for somebody else's parcels,
  because there is nothing to put a customer number or an id into: every
  query below is filtered by `request.user`, and nothing else.
* It returns only what the customer already sees on their own profile page
  (the same journey steps as Track & Trace, accounts/public.py), never staff
  notes, damage reports, photos or addresses.

The answer goes to OpenAI so the model can talk about it, but is not sent
back to the browser: the visitor only sees the model's answer.
"""

import json

from accounts.models import Package
from accounts.public import public_stage_index, public_stages
from bookings.models import Booking
from prealerts.models import PreAlert

# The most recent ones are what people ask about; this also keeps the
# answer (and the cost of the next call) small.
MAX_PACKAGES = 10
MAX_BOOKINGS = 5
MAX_PREALERTS = 10

TOOL = {
    "type": "function",
    "name": "my_shipments",
    "description": (
        "The signed-in visitor's own shipments, open bookings and pre-alerts, newest first: "
        "where each one is and when it is expected. Use it when they ask about their "
        "parcels, a shipment, a booking or a tracking number."
    ),
    "strict": True,
    "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
}


def _day(value):
    """A date or datetime as 2026-10-26, or None."""
    return value.date().isoformat() if hasattr(value, "date") else (value.isoformat() if value else None)


def _package(package):
    stages = public_stages(package)
    index = public_stage_index(package)
    return {
        "tracking_number": package.tracking_number,
        "description": (package.description or "")[:120],
        "status": package.get_status_display(),
        # The step on the customer's timeline, e.g. "In transit"; null before
        # the warehouse has it, or when quoted or cancelled.
        "journey_step": stages[index]["label"] if index >= 0 else None,
        "journey_steps": [stage["label"] for stage in stages],
        "destination": package.destination_label,
        "estimated_arrival": _day(package.estimated_arrival),
        "shipped_on": _day(package.shipped_at),
        "delivered_on": _day(package.delivered_at),
        "weight_kg": str(package.weight_kg) if package.weight_kg is not None else None,
    }


def my_shipments(user):
    """What the tool answers, as JSON text, for `user` only."""
    packages = Package.objects.filter(user=user).select_related("delivery_address").order_by("-created_at")
    # A booking the office confirmed became a shipment and shows above;
    # only the ones still waiting are listed (as on the profile page).
    bookings = Booking.objects.filter(user=user, package__isnull=True).order_by("-created_at")
    prealerts = PreAlert.objects.filter(user=user).select_related("carrier").order_by("-created_at")

    result = {
        "shipments": [_package(package) for package in packages[:MAX_PACKAGES]],
        "bookings_waiting_for_the_office": [
            {
                "shipping_number": booking.shipping_number or None,
                "status": booking.get_status_display(),
                "destination": booking.destination_label,
                "sent_on": _day(booking.created_at),
            }
            for booking in bookings[:MAX_BOOKINGS]
        ],
        "prealerts": [
            {
                "reference": alert.reference,
                "shop": alert.shop_name,
                "courier": alert.carrier.name,
                "courier_tracking_number": alert.tracking_number,
                "status": alert.get_status_display(),
                "arrived_at_warehouse_on": _day(alert.arrived_at),
            }
            for alert in prealerts[:MAX_PREALERTS]
        ],
        "note": "Full details and Track & Trace are on the visitor's profile page.",
    }
    return json.dumps(result, ensure_ascii=False)
