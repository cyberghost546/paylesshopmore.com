"""Managing integrations in Django's /admin/.

Only admins (role "admin" or a superuser) see this section - not the office.
Handing out an API key or pointing our events at a new URL is handing out
access, the same reason only an admin may change roles.

Creating an API key:
    1. /admin/ -> Integrations -> API keys -> Add.
    2. Give it a name and tick the scopes it needs. Save.
    3. The next page shows the key ONCE. Copy it now; it cannot be shown
       again (we only keep its hash).

Creating a webhook endpoint works the same way; its signing secret is shown
once. Use the "Send a test event" action to check the other side receives it.
"""

from django import forms
from django.contrib import admin
from django.template.response import TemplateResponse
from django.utils import timezone

from . import keys
from .models import ApiKey, EventType, InboundEvent, Scope, WebhookDelivery, WebhookEndpoint
from .tasks import deliver_webhook
from .webhooks import UnsafeUrl, check_url, send_test_event


def show_secret_once(request, model_admin, obj, label, secret, note):
    """Answer the "Add" form with a page that shows a new secret once.

    A page of its own rather than Django's green "messages": those are kept in
    a cookie until shown, and a key must never sit in a cookie.
    """
    return TemplateResponse(
        request,
        "admin/integrations/show_secret.html",
        {
            **model_admin.admin_site.each_context(request),
            "title": f"{label} for {obj}",
            "secret": secret,
            "note": note,
            "back_url": "../",
            "opts": model_admin.model._meta,
        },
    )


class AdminOnly:
    """Hide this section from everybody but admins."""

    @staticmethod
    def _is_admin(request):
        return bool(getattr(request.user, "is_admin", False))

    def has_module_permission(self, request):
        return self._is_admin(request)

    def has_view_permission(self, request, obj=None):
        return self._is_admin(request)

    def has_add_permission(self, request):
        return self._is_admin(request)

    def has_change_permission(self, request, obj=None):
        return self._is_admin(request)

    def has_delete_permission(self, request, obj=None):
        return self._is_admin(request)


# ---- API keys -------------------------------------------------------------------


class ApiKeyForm(forms.ModelForm):
    scopes = forms.MultipleChoiceField(choices=Scope.choices, widget=forms.CheckboxSelectMultiple)

    class Meta:
        model = ApiKey
        fields = ["name", "scopes", "expires_at"]


@admin.register(ApiKey)
class ApiKeyAdmin(AdminOnly, admin.ModelAdmin):
    form = ApiKeyForm
    list_display = ["name", "prefix", "scopes", "created_at", "last_used_at", "expires_at", "revoked_at"]
    readonly_fields = ["prefix", "created_by", "created_at", "last_used_at", "revoked_at"]
    actions = ["revoke"]

    def save_model(self, request, obj, form, change):
        if not change:
            # The same three values services.create_api_key makes, set on the
            # admin's own object so the admin's change log points at it.
            raw_key, obj.prefix, obj.key_hash = keys.new_key()
            obj.created_by = request.user
            # Kept on this one request only, for response_add below.
            request._new_api_key = raw_key
        super().save_model(request, obj, form, change)

    def response_add(self, request, obj, post_url_continue=None):
        return show_secret_once(
            request, self, obj, "API key", request._new_api_key,
            "Copy it now and give it to whoever sets up the other program. "
            "It cannot be shown again; if it is lost, revoke it and make a new one.",
        )

    def has_delete_permission(self, request, obj=None):
        # Revoke instead: the inbound events it sent keep pointing at it.
        return False

    @admin.action(description="Revoke the selected keys (they stop working at once)")
    def revoke(self, request, queryset):
        count = queryset.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        self.message_user(request, f"{count} key(s) revoked.")


# ---- webhooks -----------------------------------------------------------------------


class WebhookEndpointForm(forms.ModelForm):
    events = forms.MultipleChoiceField(
        choices=[c for c in EventType.choices if c[0] != EventType.PING],
        widget=forms.CheckboxSelectMultiple,
    )

    class Meta:
        model = WebhookEndpoint
        fields = ["name", "url", "events", "is_active"]

    def clean_url(self):
        url = self.cleaned_data["url"]
        try:
            check_url(url)
        except UnsafeUrl as error:
            raise forms.ValidationError(str(error)) from error
        return url


@admin.register(WebhookEndpoint)
class WebhookEndpointAdmin(AdminOnly, admin.ModelAdmin):
    form = WebhookEndpointForm
    list_display = ["name", "url", "events", "is_active", "created_at"]
    actions = ["test_event"]

    def save_model(self, request, obj, form, change):
        if not change:
            obj.secret = keys.new_webhook_secret()
        super().save_model(request, obj, form, change)

    def response_add(self, request, obj, post_url_continue=None):
        return show_secret_once(
            request, self, obj, "Signing secret", obj.secret,
            "Give it to whoever builds the receiver: they use it to check our "
            "X-PLSM-Signature header (docs/INTEGRATIONS.md). It is not shown again.",
        )

    @admin.action(description="Send a test event")
    def test_event(self, request, queryset):
        for endpoint in queryset:
            send_test_event(endpoint)
        self.message_user(request, "Test event queued. Check Webhook deliveries for the result.")


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(AdminOnly, admin.ModelAdmin):
    list_display = ["event_type", "endpoint", "status", "attempts", "last_status_code", "last_error", "created_at"]
    list_filter = ["status", "event_type", "endpoint"]
    readonly_fields = [f.name for f in WebhookDelivery._meta.fields]
    actions = ["retry"]

    def has_add_permission(self, request):
        return False

    @admin.action(description="Try the selected deliveries again")
    def retry(self, request, queryset):
        ids = list(queryset.values_list("pk", flat=True))
        queryset.update(status=WebhookDelivery.Status.PENDING, attempts=0, next_attempt_at=timezone.now())
        for pk in ids:
            deliver_webhook.delay(str(pk))
        self.message_user(request, f"{len(ids)} delivery(ies) queued again.")


@admin.register(InboundEvent)
class InboundEventAdmin(AdminOnly, admin.ModelAdmin):
    list_display = ["type", "api_key", "external_id", "received_at", "processed_at"]
    list_filter = ["type", "api_key"]
    readonly_fields = [f.name for f in InboundEvent._meta.fields]

    def has_add_permission(self, request):
        return False
