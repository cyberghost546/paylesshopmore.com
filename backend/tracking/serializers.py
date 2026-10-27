"""How courier tracking is turned into JSON for the browser.

Two audiences, two serializers:
- CustomerShipmentSerializer: the customer's own parcel. Only what helps them
  follow it - no staff names, no voided lines, no error messages.
- StaffShipmentSerializer: everything, including corrected lines and why the
  last automatic check failed.
Every field is listed by hand (never `__all__`), so adding a column to a model
never publishes it by accident.
"""

from urllib.parse import quote

from rest_framework import serializers

from .models import UNIVERSAL_TRACKING_URL, Carrier, CarrierShipment, TrackingEvent
from .statuses import TIMELINE, TrackingStatus, timeline_index


class CarrierSerializer(serializers.ModelSerializer):
    """A courier in the list. The link template stays on the server: the
    finished link is on each shipment (`tracking_url`)."""

    class Meta:
        model = Carrier
        fields = ["code", "name", "trackable"]
        read_only_fields = fields


class CustomerEventSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    # True = it came from the courier; False = our staff or our system wrote it.
    verified = serializers.BooleanField(read_only=True)
    # True = made up by the mock provider for testing; the page labels it
    # "Test data" so it can never pass for real courier information.
    test_data = serializers.BooleanField(read_only=True)

    class Meta:
        model = TrackingEvent
        fields = [
            "id", "status", "status_display", "description", "location", "occurred_at", "verified", "test_data",
        ]
        read_only_fields = fields


class StaffEventSerializer(CustomerEventSerializer):
    source = serializers.CharField(read_only=True)
    source_display = serializers.CharField(source="get_source_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    voided_by_name = serializers.SerializerMethodField()

    class Meta(CustomerEventSerializer.Meta):
        fields = CustomerEventSerializer.Meta.fields + [
            "source",
            "source_display",
            "created_by_name",
            "created_at",
            "voided_at",
            "voided_by_name",
            "void_reason",
        ]
        read_only_fields = fields

    def get_created_by_name(self, event):
        return str(event.created_by) if event.created_by_id else None

    def get_voided_by_name(self, event):
        return str(event.voided_by) if event.voided_by_id else None


class _ShipmentSerializer(serializers.ModelSerializer):
    carrier = CarrierSerializer(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    # The steps of the timeline and how far along it the parcel is.
    timeline = serializers.SerializerMethodField()
    timeline_index = serializers.SerializerMethodField()
    # A warning to show on top of the timeline ("Delivery attempt failed").
    problem = serializers.SerializerMethodField()
    # Whether data comes in by itself. False = only our staff update it.
    automatic = serializers.SerializerMethodField()
    # The shop, what was bought, our own reference (pre-alert or booking) and
    # our shipment number once it is in one - so a courier number typed in the
    # Track & Trace box shows which order it is. The same whether the parcel
    # hangs off a booking order or a pre-alert (CarrierShipment's helpers).
    shop_name = serializers.CharField(read_only=True)
    order_description = serializers.CharField(source="item_description", read_only=True)
    reference = serializers.CharField(read_only=True)
    package_tracking_number = serializers.SerializerMethodField()
    # The courier's own tracking page for this number, or null (walk-in).
    tracking_url = serializers.SerializerMethodField()
    # "incoming" (shop -> our warehouse) or "outgoing" (us -> the island).
    stage_display = serializers.CharField(source="get_stage_display", read_only=True)
    # True when this shipment is followed by the mock provider: everything
    # automatic on it is test data.
    test_data = serializers.SerializerMethodField()

    base_fields = [
        "id",
        "stage",
        "stage_display",
        "test_data",
        "tracking_number",
        "carrier",
        "shop_name",
        "order_description",
        "reference",
        "package_tracking_number",
        "tracking_url",
        "status",
        "status_display",
        "last_location",
        "estimated_delivery",
        "delivered_at",
        "last_synced_at",
        "automatic",
        "timeline",
        "timeline_index",
        "problem",
        "events",
    ]

    def get_timeline(self, shipment):
        return [{"value": value, "label": TrackingStatus(value).label} for value in TIMELINE]

    def get_timeline_index(self, shipment):
        # The furthest step any (not voided) line reached, so a problem status
        # keeps the parcel where it was rather than sending it back to zero.
        index = 0
        for event in reversed(self._live_events(shipment)):
            index = max(index, timeline_index(event.status, index))
        return max(index, timeline_index(shipment.status, index))

    def get_problem(self, shipment):
        problems = {
            TrackingStatus.DELIVERY_FAILED,
            TrackingStatus.DELAYED,
            TrackingStatus.RETURNED,
            TrackingStatus.EXCEPTION,
        }
        if shipment.status in problems:
            return {"status": shipment.status, "label": shipment.get_status_display()}
        return None

    def get_tracking_url(self, shipment):
        if shipment.carrier is None:
            return UNIVERSAL_TRACKING_URL.replace("{number}", quote(shipment.tracking_number, safe=""))
        return shipment.carrier.tracking_url(shipment.tracking_number)

    def get_package_tracking_number(self, shipment):
        package = shipment.package
        return package.tracking_number if package else None

    def get_test_data(self, shipment):
        return shipment.provider == "mock" or any(event.test_data for event in shipment.events.all())

    def get_automatic(self, shipment):
        return bool(shipment.provider) and shipment.registered_at is not None

    @staticmethod
    def _live_events(shipment):
        return [event for event in shipment.events.all() if event.voided_at is None]


class CustomerShipmentSerializer(_ShipmentSerializer):
    events = serializers.SerializerMethodField()

    class Meta:
        model = CarrierShipment
        fields = _ShipmentSerializer.base_fields
        read_only_fields = fields

    def get_events(self, shipment):
        # Corrected (voided) lines are not shown to the customer.
        return CustomerEventSerializer(self._live_events(shipment), many=True).data


class StaffShipmentSerializer(_ShipmentSerializer):
    events = StaffEventSerializer(many=True, read_only=True)
    customer_name = serializers.SerializerMethodField()
    customer_email = serializers.SerializerMethodField()
    booking_id = serializers.SerializerMethodField()
    prealert_id = serializers.IntegerField(read_only=True)
    order_id = serializers.IntegerField(read_only=True)
    onward_package_id = serializers.IntegerField(read_only=True)
    customer_code = serializers.SerializerMethodField()
    entered_by_name = serializers.SerializerMethodField()
    entered_by_customer = serializers.BooleanField(read_only=True)
    number_changes = serializers.SerializerMethodField()

    class Meta:
        model = CarrierShipment
        fields = _ShipmentSerializer.base_fields + [
            "customer_name",
            "customer_email",
            "customer_code",
            "booking_id",
            "prealert_id",
            "order_id",
            "onward_package_id",
            "entered_by_name",
            "entered_by_customer",
            "number_changes",
            "provider",
            "registered_at",
            "next_sync_at",
            "sync_failures",
            "last_sync_error",
            "created_at",
        ]
        read_only_fields = fields

    def get_customer_name(self, shipment):
        return str(shipment.owner) if shipment.owner_id else None

    def get_customer_email(self, shipment):
        return shipment.owner.email if shipment.owner_id else None

    def get_booking_id(self, shipment):
        return shipment.order.booking_id if shipment.order_id else None

    def get_customer_code(self, shipment):
        return shipment.owner.customer_code if shipment.owner_id else None

    def get_entered_by_name(self, shipment):
        return str(shipment.entered_by) if shipment.entered_by_id else None

    def get_number_changes(self, shipment):
        return [
            {
                "old_carrier": change.old_carrier.name if change.old_carrier_id else None,
                "old_tracking_number": change.old_tracking_number,
                "new_carrier": change.new_carrier.name if change.new_carrier_id else None,
                "new_tracking_number": change.new_tracking_number,
                "reason": change.reason,
                "changed_by": str(change.changed_by) if change.changed_by_id else None,
                "changed_at": change.changed_at,
            }
            for change in shipment.number_changes.all()
        ]


class StaffEventInputSerializer(serializers.Serializer):
    """A line typed by staff on the dashboard."""

    status = serializers.ChoiceField(choices=TrackingStatus.choices)
    description = serializers.CharField(max_length=500, required=False, allow_blank=True)
    location = serializers.CharField(max_length=200, required=False, allow_blank=True)
    occurred_at = serializers.DateTimeField(required=False, allow_null=True)
    # Required for "Delivered": what proves it (courier proof of delivery,
    # signed receipt, warehouse scan). Stored in the description.
    confirmation = serializers.CharField(max_length=300, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["status"] == TrackingStatus.DELIVERED and not attrs.get("confirmation", "").strip():
            raise serializers.ValidationError(
                {"confirmation": "Say how delivery was confirmed (proof of delivery, scan, signature)."}
            )
        return attrs
