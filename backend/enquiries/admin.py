"""Where staff actually read what came in through the forms."""

from django.contrib import admin

from .models import ContactMessage, ContactReply, QuoteReply, QuoteRequest


class ContactReplyInline(admin.TabularInline):
    """The answers sent from the dashboard, shown under the message.

    Read-only: a reply is what the customer was told, so it is never edited
    afterwards. New replies are written in the dashboard, which also e-mails
    them (enquiries/replies.py).
    """

    model = ContactReply
    extra = 0
    can_delete = False
    fields = ("created_at", "author", "body", "emailed_at", "send_error")
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


class QuoteReplyInline(ContactReplyInline):
    """The answers to a quote request, read-only for the same reasons."""

    model = QuoteReply


@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ("subject", "name", "email", "handled", "created_at")
    list_filter = ("handled", "subject", "created_at")
    search_fields = ("name", "email", "subject", "message")
    date_hierarchy = "created_at"

    # Submissions are a record of what someone sent; only the handled flag is
    # ours to change.
    readonly_fields = ("name", "email", "subject", "message", "language", "created_at")
    inlines = [ContactReplyInline]

    actions = ["mark_handled"]

    @admin.action(description="Mark selected messages as handled")
    def mark_handled(self, request, queryset):
        updated = queryset.update(handled=True)
        self.message_user(request, f"{updated} message(s) marked as handled.")


@admin.register(QuoteRequest)
class QuoteRequestAdmin(admin.ModelAdmin):
    list_display = ("full_name", "destination", "email", "status", "created_at")
    list_filter = ("status", "destination", "created_at")
    search_fields = ("first_name", "last_name", "email", "message")
    date_hierarchy = "created_at"
    inlines = [QuoteReplyInline]

    readonly_fields = (
        "destination",
        "first_name",
        "last_name",
        "email",
        "message",
        "file",
        "language",
        "created_at",
        "updated_at",
    )
