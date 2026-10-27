"""The statuses a courier shipment can be in, and how outside data maps onto them.

WHY A LIST OF OUR OWN
Every courier and every tracking service uses its own words: 17TRACK says
"InTransit_CustomsProcessing", PostNL says "Zending is gesorteerd". We turn
all of them into the one list below, so the customer's page, the dashboard and
the notifications only ever have to understand these values.

ADDING OR CHANGING A STATUS
1. Add it to TrackingStatus (value in snake_case, label in plain English).
2. If a provider should produce it, add it to the mapping for that provider
   (SEVENTEEN_TRACK_SUB_STATUS / SEVENTEEN_TRACK_STATUS below).
3. Add the wording to the frontend translations (`tracking.status.<value>`),
   in all three languages.
The value is stored in the database, so never rename an existing value -
add a new one instead.
"""

from django.db import models


class TrackingStatus(models.TextChoices):
    # Before the parcel moves: the shop or customer told us the number.
    ORDER_REGISTERED = "order_registered", "Order registered"
    AWAITING_ARRIVAL = "awaiting_arrival", "Awaiting package arrival"
    # At our warehouse (set by us, never by a courier).
    RECEIVED_AT_WAREHOUSE = "received_at_warehouse", "Received at warehouse"
    PROCESSING_AT_WAREHOUSE = "processing_at_warehouse", "Processing at warehouse"
    READY_FOR_SHIPMENT = "ready_for_shipment", "Ready for shipment"
    # Moving.
    DISPATCHED = "dispatched", "Dispatched"
    IN_TRANSIT = "in_transit", "In transit"
    ARRIVED_AT_DESTINATION = "arrived_at_destination", "Arrived at destination country"
    CUSTOMS = "customs", "Customs clearance"
    OUT_FOR_DELIVERY = "out_for_delivery", "Out for delivery"
    DELIVERED = "delivered", "Delivered"
    # Something went wrong.
    DELIVERY_FAILED = "delivery_failed", "Delivery attempt failed"
    DELAYED = "delayed", "Delayed"
    RETURNED = "returned", "Returned to sender"
    EXCEPTION = "exception", "Exception or problem"


# Statuses after which there is nothing more to fetch from the courier: the
# parcel is with us, or it is not coming. Polling stops at these.
FINAL_STATUSES = {
    TrackingStatus.DELIVERED,
    TrackingStatus.RECEIVED_AT_WAREHOUSE,
    TrackingStatus.PROCESSING_AT_WAREHOUSE,
    TrackingStatus.READY_FOR_SHIPMENT,
    TrackingStatus.RETURNED,
}

# Statuses worth telling the customer about straight away (a notification in
# the bell and, if they allow it, an e-mail). "In transit" is not one: a
# parcel moving between sorting centres is not news.
NOTIFY_STATUSES = {
    TrackingStatus.DELIVERED,
    TrackingStatus.DELIVERY_FAILED,
    TrackingStatus.DELAYED,
    TrackingStatus.RETURNED,
    TrackingStatus.EXCEPTION,
}

# The steps the customer's courier timeline draws, in order. The problem
# statuses are not steps: they are shown as a warning on top of the step the
# parcel had reached.
TIMELINE = [
    TrackingStatus.ORDER_REGISTERED,
    TrackingStatus.IN_TRANSIT,
    TrackingStatus.OUT_FOR_DELIVERY,
    TrackingStatus.DELIVERED,
    TrackingStatus.RECEIVED_AT_WAREHOUSE,
]

# Where each status puts the parcel on TIMELINE (its index).
_TIMELINE_POSITION = {
    TrackingStatus.ORDER_REGISTERED: 0,
    TrackingStatus.AWAITING_ARRIVAL: 0,
    TrackingStatus.DISPATCHED: 1,
    TrackingStatus.IN_TRANSIT: 1,
    TrackingStatus.ARRIVED_AT_DESTINATION: 1,
    TrackingStatus.CUSTOMS: 1,
    TrackingStatus.OUT_FOR_DELIVERY: 2,
    TrackingStatus.DELIVERED: 3,
    TrackingStatus.RECEIVED_AT_WAREHOUSE: 4,
    TrackingStatus.PROCESSING_AT_WAREHOUSE: 4,
    TrackingStatus.READY_FOR_SHIPMENT: 4,
}


def timeline_index(status, previous_index=0):
    """How far along TIMELINE `status` is.

    A problem status (failed, delayed, ...) has no place of its own, so the
    parcel stays at `previous_index` - the step it had reached before.
    """
    return _TIMELINE_POSITION.get(status, previous_index)


# ---- 17TRACK -------------------------------------------------------------------
#
# 17TRACK gives each event a main status and a more precise sub-status
# (https://api.17track.net/en/doc, "Status"). The sub-status is checked first;
# when it is not in this table, the main status decides.

SEVENTEEN_TRACK_SUB_STATUS = {
    "InTransit_PickedUp": TrackingStatus.DISPATCHED,
    "InTransit_CustomsProcessing": TrackingStatus.CUSTOMS,
    "InTransit_CustomsRequiringInformation": TrackingStatus.CUSTOMS,
    "Exception_Returning": TrackingStatus.RETURNED,
    "Exception_Returned": TrackingStatus.RETURNED,
    "Exception_Delayed": TrackingStatus.DELAYED,
}

SEVENTEEN_TRACK_STATUS = {
    "NotFound": TrackingStatus.ORDER_REGISTERED,
    "InfoReceived": TrackingStatus.ORDER_REGISTERED,
    "InTransit": TrackingStatus.IN_TRANSIT,
    # No updates for a long time: the courier has gone quiet.
    "Expired": TrackingStatus.DELAYED,
    # Left at a pick-up point instead of our door: somebody has to go and get
    # it, so for us it is a failed delivery.
    "AvailableForPickup": TrackingStatus.DELIVERY_FAILED,
    "OutForDelivery": TrackingStatus.OUT_FOR_DELIVERY,
    "DeliveryFailure": TrackingStatus.DELIVERY_FAILED,
    "Delivered": TrackingStatus.DELIVERED,
    "Exception": TrackingStatus.EXCEPTION,
}


def from_seventeen_track(status, sub_status=None):
    """Our TrackingStatus for a 17TRACK (status, sub_status) pair, or "" if unknown.

    Example: from_seventeen_track("InTransit", "InTransit_CustomsProcessing")
             -> TrackingStatus.CUSTOMS
    """
    if sub_status and sub_status in SEVENTEEN_TRACK_SUB_STATUS:
        return SEVENTEEN_TRACK_SUB_STATUS[sub_status]
    if not status and sub_status:
        # Events sometimes carry only the sub-status: "Delivered_Other".
        status = sub_status.split("_", 1)[0]
    return SEVENTEEN_TRACK_STATUS.get(status or "", "")
