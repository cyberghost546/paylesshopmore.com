"""Django admin (/admin/) for courier tracking.

Carriers are edited here: add a courier, change its 17TRACK code, switch one
off. Shipments and events are read-only here - they change through the
dashboard, which records who did what.
"""

from django.contrib import admin

from .models import Carrier, CarrierShipment, TrackingEvent, TrackingSyncLog


@admin.register(Carrier)
class CarrierAdmin(admin.ModelAdmin):
    list_display = [
        "name", "code", "seventeen_track_code", "tracking_url_template", "trackable", "is_active", "position",
    ]
    list_editable = ["is_active", "position"]
    search_fields = ["name", "code"]


class TrackingEventInline(admin.TabularInline):
    model = TrackingEvent
    extra = 0
    can_delete = False
    fields = ["occurred_at", "status", "description", "location", "source", "created_by", "voided_at"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(CarrierShipment)
class CarrierShipmentAdmin(admin.ModelAdmin):
    list_display = ["tracking_number", "carrier", "status", "last_synced_at", "next_sync_at", "sync_failures"]
    list_filter = ["status", "carrier", "provider"]
    search_fields = ["tracking_number", "order__shop_name", "prealert__reference", "owner__email"]
    readonly_fields = [field.name for field in CarrierShipment._meta.fields]
    inlines = [TrackingEventInline]

    def has_add_permission(self, request):
        return False


@admin.register(TrackingSyncLog)
class TrackingSyncLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "kind", "ok", "numbers", "events_added", "http_status", "message"]
    list_filter = ["kind", "ok"]
    readonly_fields = [field.name for field in TrackingSyncLog._meta.fields]

    def has_add_permission(self, request):
        return False
