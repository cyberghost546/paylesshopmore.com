"""Carrier integration settings: /api/staff/tracking-integrations/ (admins only).

  GET    /                 every tracking source and how far it is set up
  PATCH  /<code>/          {enabled, environment}
  POST   /<code>/test/     one harmless real request with the server's keys

WHAT IS (AND IS NOT) SHOWN
For each environment variable an adapter needs, only its NAME and whether it
is set. Never its value: credentials live in the server's environment only
(see adapters/base.py) and no response, log line or database row holds them.

SWITCHING ON
A carrier's own API is only used once (1) its calls are built, (2) its keys
are set, (3) "Test connection" succeeded and (4) an admin enabled it. Enabling
is refused before a successful test, and changing the environment (sandbox /
production) asks for a new test. 17TRACK and the mock provider are switched by
their settings alone, so they have no switch here.
"""

import logging

from django.db.models import Count
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from staff.permissions import IsAdmin

from .adapters import ADAPTERS, CARRIER_ADAPTERS, MOCK, SEVENTEEN_TRACK
from .adapters.base import STATUS_LABELS, record_test
from .models import CarrierIntegration, CarrierShipment

logger = logging.getLogger("tracking.audit")

# The order the page lists them: the aggregator, the carriers, then test data.
ORDER = [SEVENTEEN_TRACK, *CARRIER_ADAPTERS, MOCK]


def _status(adapter):
    """Like adapter.status(), for the two sources that have no switch."""
    if adapter is SEVENTEEN_TRACK:
        # In use as soon as its key is set; "verified" once a test worked.
        if not adapter.is_configured():
            return "not_configured"
        return "connected" if _row(adapter).verified_at else "configured_untested"
    if adapter is MOCK:
        return "connected" if adapter.is_configured() else "disabled"
    return adapter.status()


def _row(adapter):
    return adapter.integration()


def describe(adapter, counts):
    row = _row(adapter)
    code = _status(adapter)
    return {
        "code": adapter.code,
        "name": adapter.name,
        "implemented": adapter.implemented,
        "switchable": adapter not in (SEVENTEEN_TRACK, MOCK),
        "test_data": adapter is MOCK,
        "status": code,
        "status_label": STATUS_LABELS.get(code, code),
        "active": adapter.is_active(),
        "enabled": row.enabled,
        "environment": row.environment,
        # Names only - whether each is set, never what it is set to.
        "settings": [{"name": name, "set": bool(adapter.setting(name))} for name in adapter.required_settings],
        "docs_url": adapter.docs_url,
        "account_requirements": adapter.account_requirements,
        "capabilities": adapter.capabilities,
        "last_test_at": row.last_test_at,
        "last_test_ok": row.last_test_ok,
        "last_test_message": row.last_test_message,
        "verified_at": row.verified_at,
        "last_sync_at": row.last_sync_at,
        "last_error": row.last_error,
        "last_error_at": row.last_error_at,
        "shipments": counts.get(adapter.code, 0),
    }


def _counts():
    rows = CarrierShipment.objects.exclude(provider="").values("provider").annotate(n=Count("id"))
    return {row["provider"]: row["n"] for row in rows}


def _adapter(code):
    adapter = ADAPTERS.get(code)
    if adapter is None:
        raise NotFound()
    return adapter


class IntegrationListView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        counts = _counts()
        return Response([describe(adapter, counts) for adapter in ORDER])


class IntegrationDetailView(APIView):
    permission_classes = [IsAdmin]

    def patch(self, request, code):
        adapter = _adapter(code)
        if adapter in (SEVENTEEN_TRACK, MOCK):
            raise ValidationError({"detail": "This source is switched by its server settings, not here."})
        row = _row(adapter)

        if "environment" in request.data:
            environment = request.data.get("environment")
            if environment not in CarrierIntegration.Environment.values:
                raise ValidationError({"environment": "Choose sandbox or production."})
            if environment != row.environment:
                # Other keys, other address: the old test says nothing now.
                row.environment = environment
                row.verified_at = None
                row.last_test_ok = None
                row.enabled = False

        if "enabled" in request.data:
            enabled = request.data.get("enabled") in (True, "true", "1", 1)
            if enabled and not adapter.implemented:
                raise ValidationError({"enabled": "This carrier's API calls are not built yet."})
            if enabled and not adapter.is_configured():
                raise ValidationError({"enabled": "Set its environment variables on the server first."})
            if enabled and row.verified_at is None:
                raise ValidationError({"enabled": "Run a successful Test connection first."})
            row.enabled = enabled

        row.updated_by = request.user
        row.save()
        logger.info(
            "User %s set integration %s: enabled=%s environment=%s.",
            request.user.pk, adapter.code, row.enabled, row.environment,
        )
        return Response(describe(adapter, _counts()))


class IntegrationTestView(APIView):
    permission_classes = [IsAdmin]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "tracking_refresh"

    def post(self, request, code):
        adapter = _adapter(code)
        if not adapter.implemented:
            raise ValidationError({"detail": "This carrier's API calls are not built yet."})
        if not adapter.is_configured():
            missing = ", ".join(adapter.missing_settings()) or "its settings"
            raise ValidationError({"detail": f"Not configured: set {missing} on the server."})
        ok, message = adapter.test_connection()
        record_test(adapter, ok, message, request.user)
        logger.info("User %s tested integration %s: %s.", request.user.pk, adapter.code, "ok" if ok else "failed")
        return Response(describe(adapter, _counts()), status=status.HTTP_200_OK)
