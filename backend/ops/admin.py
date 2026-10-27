from django.contrib import admin

from .models import BackupRun


@admin.register(BackupRun)
class BackupRunAdmin(admin.ModelAdmin):
    """Read-only: these rows are a log of what happened, written by the backup job."""

    list_display = ("started_at", "status", "size_bytes", "location", "pruned")
    list_filter = ("status",)
    readonly_fields = ("started_at", "finished_at", "status", "location", "size_bytes", "pruned", "error")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
