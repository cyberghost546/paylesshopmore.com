"""Django admin (/admin/) for pre-alerts: read-only. They change through the
customer's form, the warehouse scanner and the dashboard, which record who
did what."""

from django.contrib import admin

from .models import PreAlert, PreAlertDocument


class DocumentInline(admin.TabularInline):
    model = PreAlertDocument
    extra = 0
    can_delete = False
    fields = ["original_name", "content_type", "size_bytes", "created_at"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(PreAlert)
class PreAlertAdmin(admin.ModelAdmin):
    list_display = ["reference", "tracking_number", "carrier", "shop_name", "user", "status", "created_at"]
    list_filter = ["status", "carrier"]
    search_fields = ["reference", "tracking_number", "shop_name", "user__email"]
    readonly_fields = [field.name for field in PreAlert._meta.fields]
    inlines = [DocumentInline]

    def has_add_permission(self, request):
        return False
