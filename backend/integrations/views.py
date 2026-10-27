"""The inbound API: what an outside program can call with its API key.

All under /api/integrations/v1/ (urls.py). "v1" so that a later change to the
shapes can be "v2" without breaking programs that already use v1.

    GET  ping/                     any valid key: "is my key working?"
    GET  shipments/                shipments:read   (?updated_since=...)
    GET  invoices/                 invoices:read    (?updated_since=...&status=sent)
    GET  invoices/<id>/pdf/        invoices:read    the invoice document
    POST events/                   events:write     push us an event
    POST documents/                documents:write  an e-mail with documents to read (docreview/views.py)

Every view here uses ONLY ApiKeyAuthentication (see authentication.py for why),
so a browser session cannot use these routes and a key cannot use any other.
"""

import json
import re

from django.db import IntegrityError, transaction
from django.http import FileResponse, Http404
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Package
from invoicing.models import Invoice
from invoicing.pdf import invoice_number

from .authentication import ApiKeyAuthentication, ApiKeyThrottle
from .models import InboundEvent, Scope
from .payloads import invoice_data, shipment_data
from .permissions import HasApiKeyScope

# The largest event body we accept. Status updates are a few hundred bytes;
# this leaves plenty of room and stops anyone filling the database.
MAX_EVENT_BYTES = 64 * 1024
EVENT_TYPE_PATTERN = re.compile(r"^[a-z0-9_.:-]{1,100}$")

# Invoices an outside program may see: only ones that have been issued.
# Drafts, the review queue and rejected ones are internal.
ISSUED = (Invoice.Status.APPROVED, Invoice.Status.SENT)


class IntegrationView(APIView):
    """The settings every integration route shares."""

    authentication_classes = [ApiKeyAuthentication]
    permission_classes = [HasApiKeyScope]
    throttle_classes = [ApiKeyThrottle]
    required_scope = None


def updated_since(request):
    """Read ?updated_since=2026-10-01T00:00:00Z, or None when not given.

    Lets a program ask "what changed since my last check?" instead of
    downloading everything every time.
    """
    raw = request.query_params.get("updated_since")
    if not raw:
        return None
    when = parse_datetime(raw)
    if when is None or when.tzinfo is None:
        raise ValidationError({"updated_since": "Use an ISO 8601 time with a timezone, e.g. 2026-10-01T00:00:00Z."})
    return when


class PingView(IntegrationView):
    def get(self, request):
        key = request.auth
        return Response({"ok": True, "key": key.name, "scopes": key.scopes})


class ShipmentListView(IntegrationView, ListAPIView):
    required_scope = Scope.SHIPMENTS_READ

    def get_queryset(self):
        # Oldest change first, so a program can page forward and remember the
        # last updated_at it saw.
        shipments = Package.objects.select_related("user").order_by("updated_at", "id")
        since = updated_since(self.request)
        if since is not None:
            shipments = shipments.filter(updated_at__gt=since)
        return shipments

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([shipment_data(p) for p in page])


class InvoiceListView(IntegrationView, ListAPIView):
    required_scope = Scope.INVOICES_READ

    def get_queryset(self):
        invoices = (
            Invoice.objects.filter(status__in=ISSUED)
            .select_related("package", "package__user")
            .prefetch_related("lines")
            .order_by("updated_at", "id")
        )
        wanted = self.request.query_params.get("status")
        if wanted:
            if wanted not in ISSUED:
                raise ValidationError({"status": "Use approved or sent."})
            invoices = invoices.filter(status=wanted)
        since = updated_since(self.request)
        if since is not None:
            invoices = invoices.filter(updated_at__gt=since)
        return invoices

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        return self.get_paginated_response([invoice_data(i) for i in page])


class InvoicePdfView(IntegrationView):
    required_scope = Scope.INVOICES_READ

    def get(self, request, pk):
        invoice = Invoice.objects.filter(pk=pk, status__in=ISSUED).select_related("package").first()
        if invoice is None or not invoice.pdf:
            raise Http404("No issued invoice with a document has that id.")
        try:
            handle = invoice.pdf.open("rb")
        except FileNotFoundError as error:
            raise Http404("This invoice's document is missing.") from error
        return FileResponse(
            handle,
            as_attachment=True,
            filename=f"{invoice_number(invoice)}.pdf",
            content_type="application/pdf",
        )


class EventCreateView(IntegrationView):
    """Store an event an outside program pushed to us.

    Body: {"type": "shipment.tracking_updated", "id": "their-id-123", "data": {...}}

    Answers 202 Accepted: stored, not yet acted on. Sending the same "id"
    again answers 200 with the stored event, so retrying is always safe.
    Nothing acts on these yet - each type gets its handler once we know which
    software sends it.
    """

    required_scope = Scope.EVENTS_WRITE

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        event_type = str(body.get("type") or "")
        external_id = str(body.get("id") or "")[:100]
        data = body.get("data", {})

        if not EVENT_TYPE_PATTERN.match(event_type):
            raise ValidationError({"type": "Required: lowercase letters, digits and . _ : - (max 100)."})
        if not isinstance(data, dict):
            raise ValidationError({"data": "Must be a JSON object."})
        if len(json.dumps(data)) > MAX_EVENT_BYTES:
            raise ValidationError({"data": f"Too large (max {MAX_EVENT_BYTES // 1024} KB)."})

        if external_id:
            existing = InboundEvent.objects.filter(api_key=request.auth, external_id=external_id).first()
            if existing is not None:
                return Response(self._answer(existing), status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                event = InboundEvent.objects.create(
                    api_key=request.auth, external_id=external_id, type=event_type, payload=data
                )
        except IntegrityError:
            # The same id arrived twice at the same moment; the other one won.
            event = InboundEvent.objects.get(api_key=request.auth, external_id=external_id)
            return Response(self._answer(event), status=status.HTTP_200_OK)

        return Response(self._answer(event), status=status.HTTP_202_ACCEPTED)

    @staticmethod
    def _answer(event):
        return {"id": event.pk, "type": event.type, "received_at": event.received_at.isoformat()}
