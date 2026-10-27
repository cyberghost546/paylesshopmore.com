"""Read-only views for developers. The real work happens in the dashboard's
Document review page; everything here is evidence, so nothing is editable."""

from django.contrib import admin

from .models import DocumentJob, DocumentJobAttempt, DocumentJobEvent


class ReadOnly:
    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class AttemptInline(ReadOnly, admin.TabularInline):
    model = DocumentJobAttempt
    extra = 0
    fields = ("number", "started_at", "ok", "model", "error", "input_tokens", "output_tokens")
    readonly_fields = fields


class EventInline(ReadOnly, admin.TabularInline):
    model = DocumentJobEvent
    extra = 0
    fields = ("created_at", "action", "actor", "field", "before", "after", "reason")
    readonly_fields = fields


@admin.register(DocumentJob)
class DocumentJobAdmin(ReadOnly, admin.ModelAdmin):
    list_display = ("id", "source", "status", "original_name", "customer", "package", "created_at")
    list_filter = ("status", "source", "auto_linked")
    search_fields = ("original_name", "dedupe_key", "sha256")
    readonly_fields = [field.name for field in DocumentJob._meta.fields]
    inlines = [AttemptInline, EventInline]
