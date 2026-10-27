"""The dashboard's Integrations page talks to these routes.

Mounted under /api/staff/integrations/ by staff/urls.py. ADMINS ONLY (IsAdmin):
handing out an API key or sending our data to a new URL is handing out
access, the same reason only an admin may change roles.

    GET    options/                    the scopes and event types, with labels
    GET    keys/                       every API key (never the key itself)
    POST   keys/                       make one -> answers it with "key" ONCE
    POST   keys/<id>/revoke/           stop it working now
    GET    webhooks/                   every endpoint (never the secret)
    POST   webhooks/                   make one -> answers it with "secret" ONCE
    PATCH  webhooks/<id>/              rename, change URL / events, switch on/off
    DELETE webhooks/<id>/              remove it and its delivery log
    POST   webhooks/<id>/test/         send it a "ping"
    GET    deliveries/                 the newest 50 webhook deliveries
    POST   deliveries/<id>/retry/      try a failed one again
    GET    inbound-events/             the newest 50 events programs sent us

The secret values appear in exactly two answers - the two creates - and
nowhere else, not even to an admin later.
"""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.reauth import require_recent_reauth
from staff.permissions import IsAdmin

from .models import ApiKey, EventType, InboundEvent, Scope, WebhookDelivery, WebhookEndpoint
from .services import create_api_key, create_webhook_endpoint
from .tasks import deliver_webhook
from .webhooks import UnsafeUrl, check_url, send_test_event

# What an admin may subscribe an endpoint to ("ping" is only for the test button).
SUBSCRIBABLE = [value for value in EventType.values if value != EventType.PING]
RECENT = 50


class AdminView(APIView):
    permission_classes = [IsAdmin]


# ---- what goes in and out ----------------------------------------------------------


def key_row(api_key):
    """An API key as the page shows it. No hash, no key."""
    if api_key.revoked_at:
        state = "revoked"
    elif not api_key.is_usable:
        state = "expired"
    else:
        state = "active"
    return {
        "id": api_key.pk,
        "name": api_key.name,
        "prefix": api_key.prefix,
        "scopes": api_key.scopes,
        "state": state,
        "created_at": api_key.created_at,
        "created_by": str(api_key.created_by) if api_key.created_by_id else None,
        "last_used_at": api_key.last_used_at,
        "expires_at": api_key.expires_at,
        "revoked_at": api_key.revoked_at,
    }


def endpoint_row(endpoint):
    """A webhook endpoint as the page shows it. No secret."""
    return {
        "id": endpoint.pk,
        "name": endpoint.name,
        "url": endpoint.url,
        "events": endpoint.events,
        "is_active": endpoint.is_active,
        "created_at": endpoint.created_at,
    }


def delivery_row(delivery):
    return {
        "id": str(delivery.pk),
        "endpoint": delivery.endpoint.name,
        "event_type": delivery.event_type,
        "status": delivery.status,
        "attempts": delivery.attempts,
        "last_status_code": delivery.last_status_code,
        "last_error": delivery.last_error,
        "created_at": delivery.created_at,
        "delivered_at": delivery.delivered_at,
        "next_attempt_at": delivery.next_attempt_at if delivery.status == WebhookDelivery.Status.PENDING else None,
    }


def inbound_row(event):
    return {
        "id": event.pk,
        "type": event.type,
        "external_id": event.external_id,
        "key": event.api_key.name,
        "received_at": event.received_at,
        "processed_at": event.processed_at,
        "payload": event.payload,
    }


class KeyInput(serializers.Serializer):
    name = serializers.CharField(max_length=100, trim_whitespace=True)
    scopes = serializers.MultipleChoiceField(choices=Scope.choices, allow_empty=False)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_expires_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Pick a moment in the future, or leave it empty.")
        return value


class EndpointInput(serializers.Serializer):
    name = serializers.CharField(max_length=100, trim_whitespace=True)
    url = serializers.URLField(max_length=500)
    events = serializers.MultipleChoiceField(choices=SUBSCRIBABLE, allow_empty=False)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate_url(self, value):
        try:
            check_url(value)
        except UnsafeUrl as error:
            raise serializers.ValidationError(str(error)) from error
        return value


# ---- the routes ------------------------------------------------------------------------


class OptionsView(AdminView):
    def get(self, request):
        return Response(
            {
                "scopes": [{"value": v, "label": label} for v, label in Scope.choices],
                "events": [{"value": v, "label": label} for v, label in EventType.choices if v in SUBSCRIBABLE],
            }
        )


class KeyListView(AdminView):
    def get(self, request):
        rows = ApiKey.objects.select_related("created_by")
        return Response([key_row(k) for k in rows])

    def post(self, request):
        # A new key is a new way into our data: confirm it is really the admin.
        require_recent_reauth(request)
        body = KeyInput(data=request.data)
        body.is_valid(raise_exception=True)
        api_key, raw_key = create_api_key(
            name=body.validated_data["name"],
            # A set from MultipleChoiceField; sorted so the order is stable.
            scopes=sorted(body.validated_data["scopes"]),
            expires_at=body.validated_data.get("expires_at"),
            created_by=request.user,
        )
        # The one and only time the key leaves the server.
        return Response(key_row(api_key) | {"key": raw_key}, status=status.HTTP_201_CREATED)


class KeyRevokeView(AdminView):
    def post(self, request, pk):
        api_key = get_object_or_404(ApiKey, pk=pk)
        if api_key.revoked_at is None:
            api_key.revoked_at = timezone.now()
            api_key.save(update_fields=["revoked_at"])
        return Response(key_row(api_key))


class EndpointListView(AdminView):
    def get(self, request):
        return Response([endpoint_row(e) for e in WebhookEndpoint.objects.all()])

    def post(self, request):
        # Our data will be sent to this address: confirm it is really the admin.
        require_recent_reauth(request)
        body = EndpointInput(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        endpoint = create_webhook_endpoint(
            name=data["name"], url=data["url"], events=sorted(data["events"]), is_active=data["is_active"]
        )
        # The one and only time the secret leaves the server.
        return Response(endpoint_row(endpoint) | {"secret": endpoint.secret}, status=status.HTTP_201_CREATED)


class EndpointDetailView(AdminView):
    def patch(self, request, pk):
        require_recent_reauth(request)
        endpoint = get_object_or_404(WebhookEndpoint, pk=pk)
        body = EndpointInput(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        for field, value in body.validated_data.items():
            setattr(endpoint, field, sorted(value) if field == "events" else value)
        endpoint.save()
        return Response(endpoint_row(endpoint))

    def delete(self, request, pk):
        require_recent_reauth(request)
        get_object_or_404(WebhookEndpoint, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class EndpointTestView(AdminView):
    def post(self, request, pk):
        endpoint = get_object_or_404(WebhookEndpoint, pk=pk)
        delivery = send_test_event(endpoint)
        delivery.refresh_from_db()  # without a worker it has already been tried
        return Response(delivery_row(delivery), status=status.HTTP_202_ACCEPTED)


class DeliveryListView(AdminView):
    def get(self, request):
        rows = WebhookDelivery.objects.select_related("endpoint")[:RECENT]
        return Response([delivery_row(d) for d in rows])


class DeliveryRetryView(AdminView):
    def post(self, request, pk):
        delivery = get_object_or_404(WebhookDelivery, pk=pk)
        WebhookDelivery.objects.filter(pk=delivery.pk).update(
            status=WebhookDelivery.Status.PENDING, attempts=0, next_attempt_at=timezone.now()
        )
        deliver_webhook.delay(str(delivery.pk))
        delivery.refresh_from_db()
        return Response(delivery_row(delivery))


class InboundEventListView(AdminView):
    def get(self, request):
        rows = InboundEvent.objects.select_related("api_key")[:RECENT]
        return Response([inbound_row(e) for e in rows])
