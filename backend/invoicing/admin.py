"""Invoices in Django's admin: readable, not editable.

The state machine is the only way an invoice moves, and it lives on the model
rather than in a form. An admin change page with a status dropdown would be a
second way in that knows none of the rules, so there isn't one.

The one action here is not an exception to that. Re-queueing a render does not
write a status; it hands the invoice to the same task an approval would have,
which goes through mark_sent like every other caller.
"""

from django.contrib import admin, messages

from .models import (
    ChargeType,
    Invoice,
    InvoiceHistory,
    InvoiceLine,
    InvoiceNumberSequence,
    InvoiceSettings,
    Port,
)
from .tasks import render_approved_invoice


class InvoiceLineInline(admin.TabularInline):
    """The charges on a composed invoice, shown and never edited here."""

    model = InvoiceLine
    fields = ("position", "kind", "description", "amount")
    readonly_fields = fields
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    inlines = (InvoiceLineInline,)
    list_display = (
        "id",
        "tracking_number",
        "status",
        "awaiting_document",
        "reviewed_by",
        "reviewed_at",
    )
    list_filter = ("status",)
    search_fields = ("package__tracking_number", "package__user__email")
    list_select_related = ("package", "reviewed_by")
    ordering = ("-created_at",)
    actions = ("rerender",)

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in self.model._meta.fields]

    def has_add_permission(self, request):
        # Invoices are created by ensure_invoice_for_package when a package is
        # paid, never by hand.
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_rerender_permission(self, request):
        """Who may re-queue a render.

        Editing is closed to everyone (has_change_permission above), so the
        action needs a permission of its own or Django would offer it to anyone
        who can open the list. It is gated on the model's change bit: the
        action cannot corrupt an invoice, but it does cause a document to be
        written and a customer to be e-mailed, which is not a thing a
        view-only account should be able to set off.
        """
        return request.user.has_perm("invoicing.change_invoice")

    @admin.display(boolean=True, description="has document")
    def awaiting_document(self, obj):
        return bool(obj.pdf)

    @admin.action(
        description="Re-queue the PDF render for approved invoices",
        permissions=["rerender"],
    )
    def rerender(self, request, queryset):
        """Re-queue anything in the selection that is stuck.

        Anything already sent, or still under review, is counted and reported
        rather than skipped in silence — selecting a mixed set of rows and
        being told "3 queued" without hearing what happened to the other four
        invites the assumption that all seven went.

        With no broker configured, .delay() runs the render inline and this
        request blocks for as long as that takes. That is a development
        setting; see the Celery section of config/settings.py.
        """
        stuck = queryset.filter(status=Invoice.Status.APPROVED, pdf="")
        skipped = queryset.count() - stuck.count()

        queued = 0
        for invoice in stuck.select_related("package"):
            try:
                render_approved_invoice.delay(invoice.pk)
            except Exception as error:
                self.message_user(
                    request,
                    f"Invoice {invoice.pk} could not be queued: {error}",
                    level=messages.ERROR,
                )
            else:
                queued += 1

        if queued:
            self.message_user(
                request,
                f"Re-queued the render for {queued} invoice(s).",
                level=messages.SUCCESS,
            )

        if skipped:
            self.message_user(
                request,
                f"{skipped} selected invoice(s) were not awaiting a document "
                "and were left alone.",
                level=messages.WARNING,
            )

    @admin.display(description="tracking number", ordering="package__tracking_number")
    def tracking_number(self, obj):
        return obj.package.tracking_number


@admin.register(InvoiceNumberSequence)
class InvoiceNumberSequenceAdmin(admin.ModelAdmin):
    """Where the office sets the counter to carry on from paper invoices.

    The only reason to touch it: the first website invoice of a year should
    follow the last one written by hand. Setting it lower than a number
    already issued is harmless - InvoiceNumberSequence.take steps past it.
    """

    list_display = ("year", "last_number", "next_reference")

    @admin.display(description="next invoice number")
    def next_reference(self, obj):
        return InvoiceSettings.load().format_number(obj.year, obj.last_number + 1)


@admin.register(InvoiceSettings)
class InvoiceSettingsAdmin(admin.ModelAdmin):
    """Numbering, VAT, insurance and wording. Also editable on the dashboard's
    invoice settings page, which is where admins normally change it."""

    def has_add_permission(self, request):
        return not InvoiceSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Port)
class PortAdmin(admin.ModelAdmin):
    list_display = ("name", "freight", "for_loading", "for_discharge", "is_default", "active")
    list_editable = ("active",)


@admin.register(ChargeType)
class ChargeTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "freight", "default_amount", "position", "active")
    list_editable = ("position", "active")


@admin.register(InvoiceHistory)
class InvoiceHistoryAdmin(admin.ModelAdmin):
    """The audit trail. Read-only: a history you can edit is not a history."""

    list_display = ("at", "reference", "action", "actor")
    list_filter = ("action",)
    search_fields = ("reference",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
