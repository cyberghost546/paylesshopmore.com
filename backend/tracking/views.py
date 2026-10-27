"""The courier-tracking endpoints for customers and for the tracking service.

  GET  /api/tracking/carriers/            the "Courier company" list
  POST /api/tracking/webhooks/17track/    17TRACK pushing an update to us

The customer saves a courier and number on their order through the existing
bookings endpoint (bookings/views.py, MyOrderTrackingView), and reads the
result on their booking (bookings/serializers.py, MyOrderSerializer).
Staff endpoints are in staff_views.py.
"""

import hashlib
import hmac
import json
import logging

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Carrier, CarrierShipment, TrackingEvent, TrackingSyncLog
from .providers import SeventeenTrack
from .serializers import CarrierSerializer
from .sync import apply_result

logger = logging.getLogger(__name__)


class CarrierListView(APIView):
    """GET: the couriers a customer can choose from, in list order."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        carriers = Carrier.objects.filter(is_active=True)
        return Response(CarrierSerializer(carriers, many=True).data)


def valid_seventeen_track_signature(raw_body, sign, key):
    """Whether a push really came from 17TRACK.

    17TRACK's rule: sign = SHA-256 of (the request body exactly as sent + "/" +
    our security key), written as 64 hex characters. Anyone can POST to our
    URL; only 17TRACK knows the key, so only 17TRACK can produce this value.
    compare_digest takes the same time however much matches, so the answer's
    speed gives nothing away.
    """
    if not key or not sign:
        return False
    expected = hashlib.sha256(raw_body + b"/" + key.encode()).hexdigest()
    return hmac.compare_digest(expected, sign.strip().lower())


class SeventeenTrackWebhookView(APIView):
    """POST from 17TRACK when a registered number has news.

    Set this URL in 17TRACK's dashboard (Settings -> Webhook) as
        https://<your site>/api/tracking/webhooks/17track/
    - the address of the website, not the Railway one, so the request passes
    the origin check (config/origin_guard.py).

    Answers 200 to every correctly signed push, even about a number we do not
    know: anything else makes 17TRACK send it again three more times.
    """

    permission_classes = [AllowAny]
    # No session, so no CSRF check: the signature is what proves the sender.
    authentication_classes = []
    # 17TRACK pushes in bursts; its signature, not a rate limit, keeps others out.
    throttle_classes = []

    def post(self, request):
        raw_body = request.body  # the exact bytes: the signature covers them
        key = getattr(settings, "SEVENTEEN_TRACK_API_KEY", "")
        if not valid_seventeen_track_signature(raw_body, request.headers.get("sign", ""), key):
            logger.warning("Rejected a 17TRACK webhook with a missing or wrong signature.")
            return Response({"detail": "Invalid signature."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            payload = json.loads(raw_body.decode() or "{}")
        except ValueError:
            return Response({"detail": "Not JSON."}, status=status.HTTP_400_BAD_REQUEST)

        event = payload.get("event")
        data = payload.get("data") or {}
        number = str(data.get("number") or "").strip().upper()
        shipments = list(
            CarrierShipment.objects.select_related("carrier").filter(tracking_number=number)
        ) if number else []

        added = 0
        if event == "TRACKING_UPDATED":
            track = SeventeenTrack.parse(data)
            for shipment in shipments:
                added += apply_result(shipment, track, TrackingEvent.Source.WEBHOOK)
        elif event == "TRACKING_STOPPED":
            # 17TRACK stopped following it; the scheduled job need not ask either.
            CarrierShipment.objects.filter(pk__in=[s.pk for s in shipments]).update(next_sync_at=None)

        TrackingSyncLog.objects.create(
            kind=TrackingSyncLog.Kind.WEBHOOK,
            shipment=shipments[0] if len(shipments) == 1 else None,
            numbers=len(shipments),
            ok=True,
            events_added=added,
            message=f"{event or 'unknown event'} for {number or 'no number'}"[:500],
        )
        return Response({"received": True})
