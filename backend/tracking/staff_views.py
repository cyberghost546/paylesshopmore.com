"""Courier tracking in the back office: /api/staff/carrier-tracking/.

  GET    /                       list; ?search= (tracking number, customer,
                                 shop, our PLSM number), ?status=, ?problems=1,
                                 ?stage=incoming|outgoing
  POST   /                       register a number for a customer: {customer,
                                 stage, order | prealert | package, carrier,
                                 tracking_number}
  GET    /lookup/?q=             find a customer and what a number can hang
                                 off: their orders, pre-alerts and shipments
  GET    /<id>/                  one shipment with its whole history,
                                 corrected lines included
  PATCH  /<id>/                  {carrier, estimated_delivery}
  POST   /<id>/events/           add a line by hand (staff)
  POST   /<id>/events/<eid>/void/  {reason}: correct a wrong line, keeping it on record
  POST   /<id>/refresh/          ask the courier now instead of waiting
  POST   /<id>/correct-number/   {tracking_number, carrier, reason}: fix a
                                 wrong number, kept on record (TrackingNumberChange)

Who may do what:
  - office staff and admins (IsStaff): everything;
  - customers: nothing here. They add numbers to their own orders and
    pre-alerts only, and can never change what staff entered, a correction,
    or a warehouse confirmation.
  - the warehouse manager (IsStaffOrWarehouseManager): read, and add lines
    (arrivals, handovers). Correcting lines and changing the courier is for
    the office.
  - floor workers: nothing here - these pages show customers' names and
    e-mail addresses. Their part happens by itself: receiving a package on
    the floor closes the courier leg (sync.mark_received_at_warehouse).
Every change is stored with the person who made it (TrackingEvent.created_by,
voided_by) and logged.
"""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import Package
from bookings.models import BookingOrder
from prealerts.models import PreAlert
from staff.permissions import IsStaff, IsStaffOrWarehouseManager

from .adapters import choose_adapter
from .models import Carrier, CarrierShipment, TrackingEvent, TrackingNumberChange
from .normalize import InvalidTrackingNumber, normalize_tracking_number
from .serializers import StaffEventInputSerializer, StaffShipmentSerializer
from .statuses import TrackingStatus
from .sync import add_staff_event, recompute_status, register_now, start_tracking

logger = logging.getLogger("tracking.audit")

PROBLEM_STATUSES = [
    TrackingStatus.DELIVERY_FAILED,
    TrackingStatus.DELAYED,
    TrackingStatus.RETURNED,
    TrackingStatus.EXCEPTION,
]


User = get_user_model()

# Courier lines that came from outside (the courier, or the mock provider).
# A corrected number hides them: they were about the wrong parcel.
AUTOMATIC_SOURCES = [TrackingEvent.Source.CARRIER_API, TrackingEvent.Source.WEBHOOK, TrackingEvent.Source.MOCK]


def _clean_number(value):
    try:
        return normalize_tracking_number(value)
    except InvalidTrackingNumber as error:
        raise ValidationError({"tracking_number": str(error)}) from None


def _carrier_from(code):
    """The Carrier for a code, None for "", or a 400 for an unknown one."""
    code = str(code or "").strip()
    if not code:
        return None
    carrier = Carrier.objects.filter(code=code, is_active=True).first()
    if carrier is None:
        raise ValidationError({"carrier": "Unknown courier."})
    return carrier


def _int(value, field):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValidationError({field: "Choose one from the list."}) from None


class StaffCarrierShipmentViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    serializer_class = StaffShipmentSerializer
    # Only the "refresh" action sets a scope (see its decorator); declared here
    # because DRF only lets an action override attributes the class has.
    throttle_scope = None

    def get_permissions(self):
        # Reading and adding lines: the warehouse manager too. Everything
        # else: the office.
        if self.action in ("list", "retrieve", "add_event"):
            return [IsStaffOrWarehouseManager()]
        return [IsStaff()]

    def get_queryset(self):
        queryset = CarrierShipment.objects.select_related(
            "carrier", "owner", "entered_by", "order__booking__package", "prealert__package", "onward_package"
        ).prefetch_related(
            "events__created_by",
            "events__voided_by",
            "number_changes__old_carrier",
            "number_changes__new_carrier",
            "number_changes__changed_by",
        )

        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            compact = search.replace(" ", "").upper()
            queryset = queryset.filter(
                Q(tracking_number__icontains=compact)
                | Q(order__booking__package__tracking_number__icontains=search)
                | Q(prealert__package__tracking_number__icontains=search)
                | Q(onward_package__tracking_number__icontains=search)
                | Q(prealert__reference__icontains=search)
                | Q(order__shop_name__icontains=search)
                | Q(prealert__shop_name__icontains=search)
                | Q(owner__email__icontains=search)
                | Q(owner__first_name__icontains=search)
                | Q(owner__last_name__icontains=search)
            )
        wanted = params.get("status", "").strip()
        if wanted in TrackingStatus.values:
            queryset = queryset.filter(status=wanted)
        if params.get("problems") == "1":
            queryset = queryset.filter(status__in=PROBLEM_STATUSES)
        stage = params.get("stage", "").strip()
        if stage in CarrierShipment.Stage.values:
            queryset = queryset.filter(stage=stage)
        return queryset

    def create(self, request):
        """Staff register a courier number for a customer.

        Incoming (shop -> our warehouse): on one of the customer's orders or
        pre-alerts. Outgoing (us -> the island): on one of their shipments.
        Everything named must belong to the chosen customer.
        """
        data = request.data
        customer = User.objects.filter(pk=_int(data.get("customer"), "customer"), is_active=True).first()
        if customer is None:
            raise ValidationError({"customer": "Choose a customer."})
        stage = data.get("stage") or CarrierShipment.Stage.INCOMING
        if stage not in CarrierShipment.Stage.values:
            raise ValidationError({"stage": "Choose incoming or outgoing."})
        number = _clean_number(data.get("tracking_number"))
        carrier = _carrier_from(data.get("carrier"))

        parent = {}
        if stage == CarrierShipment.Stage.OUTGOING:
            package = Package.objects.filter(pk=_int(data.get("package"), "package"), user=customer).first()
            if package is None:
                raise ValidationError({"package": "Choose one of this customer's shipments."})
            parent["onward_package"] = package
        elif data.get("prealert"):
            prealert = PreAlert.objects.filter(pk=_int(data.get("prealert"), "prealert"), user=customer).first()
            if prealert is None:
                raise ValidationError({"prealert": "Choose one of this customer's pre-alerts."})
            if CarrierShipment.objects.filter(prealert=prealert).exists():
                raise ValidationError({"prealert": "This pre-alert already has a tracking number."})
            parent["prealert"] = prealert
        else:
            order = BookingOrder.objects.filter(
                pk=_int(data.get("order"), "order"), booking__user=customer
            ).first()
            if order is None:
                raise ValidationError({"order": "Choose one of this customer's orders."})
            parent["order"] = order

        if CarrierShipment.objects.filter(tracking_number=number, **parent).exists():
            raise ValidationError({"tracking_number": "This number is already registered here."})

        shipment = CarrierShipment.objects.create(
            stage=stage,
            owner=customer,
            entered_by=request.user,
            carrier=carrier,
            tracking_number=number,
            **parent,
        )
        start_tracking(shipment)
        register_now(shipment)
        logger.info(
            "User %s registered %s number %s (shipment %s) for customer %s.",
            request.user.pk, stage, number, shipment.pk, customer.pk,
        )
        return Response(
            self.get_serializer(self.get_queryset().get(pk=shipment.pk)).data, status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Customers matching ?q= (name, e-mail or PLSM-C number) with what a
        number can be registered on."""
        query = request.query_params.get("q", "").strip()
        if len(query) < 2:
            return Response([])
        match = Q(email__icontains=query) | Q(first_name__icontains=query) | Q(last_name__icontains=query)
        digits = query.upper().removeprefix(User.CUSTOMER_CODE_PREFIX)
        if digits.isdigit():
            match |= Q(customer_number=int(digits))
        customers = User.objects.filter(match, is_active=True, is_staff=False).order_by("first_name", "last_name")[:10]
        result = []
        for customer in customers:
            orders = BookingOrder.objects.filter(booking__user=customer).select_related("booking").order_by("-id")[:30]
            prealerts = PreAlert.objects.filter(user=customer, carrier_shipment__isnull=True).order_by("-id")[:30]
            packages = Package.objects.filter(user=customer).order_by("-id")[:30]
            result.append(
                {
                    "id": customer.pk,
                    "name": str(customer),
                    "email": customer.email,
                    "customer_code": customer.customer_code,
                    "orders": [
                        {
                            "id": order.pk,
                            "shop_name": order.shop_name,
                            "description": order.description,
                            "booking_id": order.booking_id,
                            "reference": order.booking.shipping_number or "",
                        }
                        for order in orders
                    ],
                    "prealerts": [
                        {"id": prealert.pk, "reference": prealert.reference, "shop_name": prealert.shop_name}
                        for prealert in prealerts
                    ],
                    "packages": [
                        {
                            "id": package.pk,
                            "tracking_number": package.tracking_number,
                            "description": package.description,
                            "status": package.status,
                        }
                        for package in packages
                    ],
                }
            )
        return Response(result)

    @action(detail=True, methods=["post"], url_path="correct-number")
    def correct_number(self, request, pk=None):
        """Fix a wrong courier or number. The old one is kept on record, the
        courier lines fetched for it are hidden (they were about another
        parcel), and tracking starts again for the new number."""
        shipment = self.get_object()
        number = _clean_number(request.data.get("tracking_number"))
        carrier = _carrier_from(request.data.get("carrier")) if "carrier" in request.data else shipment.carrier
        reason = str(request.data.get("reason") or "").strip()[:300]
        if not reason:
            raise ValidationError({"reason": "Say why the number is corrected."})
        if number == shipment.tracking_number and carrier == shipment.carrier:
            raise ValidationError({"tracking_number": "That is the number it already has."})

        with transaction.atomic():
            TrackingNumberChange.objects.create(
                shipment=shipment,
                old_carrier=shipment.carrier,
                old_tracking_number=shipment.tracking_number,
                new_carrier=carrier,
                new_tracking_number=number,
                reason=reason,
                changed_by=request.user,
            )
            for event in shipment.events.filter(source__in=AUTOMATIC_SOURCES, voided_at__isnull=True):
                event.void(request.user, f"Tracking number corrected: {reason}")
            shipment.tracking_number = number
            shipment.carrier = carrier
            shipment.last_location = ""
            shipment.estimated_delivery = None
            shipment.last_synced_at = None
            shipment.save()
            recompute_status(shipment)
            start_tracking(shipment)
        register_now(shipment)
        logger.info("User %s corrected the number of courier shipment %s: %s", request.user.pk, shipment.pk, reason)
        return Response(self.get_serializer(self.get_object()).data)

    def partial_update(self, request, pk=None):
        """Change the courier or the expected delivery date."""
        shipment = self.get_object()
        changed = []

        if "carrier" in request.data:
            code = request.data.get("carrier") or ""
            carrier = Carrier.objects.filter(code=code).first() if code else None
            if code and carrier is None:
                raise ValidationError({"carrier": "Unknown courier."})
            if carrier != shipment.carrier:
                TrackingNumberChange.objects.create(
                    shipment=shipment,
                    old_carrier=shipment.carrier,
                    old_tracking_number=shipment.tracking_number,
                    new_carrier=carrier,
                    new_tracking_number=shipment.tracking_number,
                    reason="Courier changed",
                    changed_by=request.user,
                )
                shipment.carrier = carrier
                shipment.save(update_fields=["carrier", "updated_at"])
                # A different courier means asking again from scratch.
                start_tracking(shipment)
                changed.append("carrier")

        if "estimated_delivery" in request.data:
            value = request.data.get("estimated_delivery") or None
            day = parse_date(value) if value else None
            if value and day is None:
                raise ValidationError({"estimated_delivery": "Use a date like 2026-11-30."})
            shipment.estimated_delivery = day
            shipment.save(update_fields=["estimated_delivery", "updated_at"])
            changed.append("estimated_delivery")

        logger.info("User %s changed %s on courier shipment %s.", request.user.pk, changed, shipment.pk)
        return Response(self.get_serializer(self.get_object()).data)

    @action(detail=True, methods=["post"], url_path="events")
    def add_event(self, request, pk=None):
        """Add a line by hand. It is marked as ours, never as the courier's."""
        shipment = self.get_object()
        body = StaffEventInputSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data

        description = data.get("description", "").strip()
        if data.get("confirmation"):
            description = f"{description} (Confirmed: {data['confirmation'].strip()})".strip()

        event = add_staff_event(
            shipment,
            request.user,
            status=data["status"],
            description=description,
            location=data.get("location", "").strip(),
            occurred_at=data.get("occurred_at"),
        )
        logger.info(
            "User %s added a %s line to courier shipment %s.", request.user.pk, event.status, shipment.pk
        )
        return Response(self.get_serializer(self.get_object()).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path=r"events/(?P<event_id>\d+)/void")
    def void_event(self, request, pk=None, event_id=None):
        """Correct a wrong line: hidden from the customer, kept on record."""
        shipment = self.get_object()
        event = get_object_or_404(shipment.events, pk=event_id, voided_at__isnull=True)
        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Say why this line is wrong."})

        event.void(request.user, reason)
        recompute_status(shipment)
        logger.info(
            "User %s voided line %s on courier shipment %s: %s", request.user.pk, event.pk, shipment.pk, reason
        )
        return Response(self.get_serializer(self.get_object()).data)

    @action(
        detail=True,
        methods=["post"],
        throttle_classes=[ScopedRateThrottle],
        throttle_scope="tracking_refresh",
    )
    def refresh(self, request, pk=None):
        """Ask the courier now. Limited per user (each call costs quota)."""
        shipment = self.get_object()
        if choose_adapter(shipment) is None:
            raise ValidationError({"detail": "Automatic tracking is not available for this shipment."})
        if shipment.registered_at is None or not shipment.provider:
            # Never registered (or saved before tracking was set up): start now.
            start_tracking(shipment)
        register_now(shipment)
        return Response(self.get_serializer(self.get_object()).data)
