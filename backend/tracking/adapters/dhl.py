"""DHL: the "Shipment Tracking - Unified" API.

Official documentation: https://developer.dhl.com/api-reference/shipment-tracking

WHAT IT CAN DO FOR US
It tracks any DHL number (Parcel, eCommerce, Express, Freight) for anyone who
has the number - the recipient included. So it suits parcels coming to our
warehouse.

WHAT YOU NEED
1. An account on https://developer.dhl.com, an app with "Shipment Tracking -
   Unified" added to it, and the app approved by DHL.
2. Its key ("Consumer Key", under My Apps) as DHL_API_KEY on the server.
3. Limits: a new app gets 250 calls a day, at most one every 5 seconds -
   enough to test, not for daily use. Ask DHL for more on the app's page
   ("Request Upgrade") before switching it on for everyone.

THE CALL (from the documentation)
    GET https://api-eu.dhl.com/track/shipments?trackingNumber=<number>
    Header: DHL-API-Key: <key>
The documentation gives one address for both test and live use; the "demo"
key only returns made-up answers. Fields read below: shipments[].status,
.events[], .estimatedTimeOfDelivery, each event's timestamp, statusCode,
status, description and location.address.addressLocality. DHL marks fields as
optional and asks clients to treat unknown values as unknown - so does this.

NOT VERIFIED YET: these calls are written from the documentation and tested
against made-up answers only. Switch the integration on only after "Test
connection" succeeds with your real key, and check a few real numbers.
"""

from urllib.parse import urlencode

from django.utils.dateparse import parse_datetime

from ..providers import ProviderResult, TrackEvent, TrackResult, _day
from ..statuses import TrackingStatus
from .base import CarrierAdapter

URL = "https://api-eu.dhl.com/track/shipments"

# DHL's statusCode values -> ours. Anything else is treated as unknown ("").
STATUS = {
    "pre-transit": TrackingStatus.ORDER_REGISTERED,
    "transit": TrackingStatus.IN_TRANSIT,
    "delivered": TrackingStatus.DELIVERED,
    "failure": TrackingStatus.EXCEPTION,
}


class DhlAdapter(CarrierAdapter):
    code = "dhl"
    name = "DHL"
    carrier_codes = ("dhl-parcel-nl", "dhl-express")
    required_settings = ("DHL_API_KEY",)
    docs_url = "https://developer.dhl.com/api-reference/shipment-tracking"
    account_requirements = (
        "A free developer.dhl.com account with an approved app using 'Shipment Tracking - Unified'."
    )
    capabilities = "Tracks any DHL number, also as the recipient. Starts at 250 calls/day, 1 call per 5 s."
    implemented = True
    batch_size = 1

    def normalize_status(self, code):
        return STATUS.get((code or "").lower(), "")

    def _headers(self):
        return {"DHL-API-Key": self.setting("DHL_API_KEY"), "Accept": "application/json"}

    def fetch(self, items):
        result = ProviderResult()
        for number, _carrier in items:
            data, status = self.get_json(f"{URL}?{urlencode({'trackingNumber': number})}", self._headers())
            result.http_status = status
            shipments = data.get("shipments") or []
            if status == 404 or not shipments:
                result.rejected.append((number, "DHL does not know this number (yet)."))
                continue
            result.accepted.append(self.parse(number, shipments[0]))
        return result

    def parse(self, number, shipment):
        """One DHL shipment object -> TrackResult."""
        status = shipment.get("status") or {}
        events = [
            TrackEvent(
                status=self.normalize_status(event.get("statusCode")),
                description=str(event.get("description") or event.get("status") or "")[:500],
                location=_place(event)[:200],
                occurred_at=_when(event.get("timestamp")),
                raw_time=str(event.get("timestamp") or ""),
            )
            for event in shipment.get("events") or []
        ]
        return TrackResult(
            number=number,
            carrier_code=None,
            status=self.normalize_status(status.get("statusCode")),
            location=_place(status)[:200],
            estimated_delivery=_day(shipment.get("estimatedTimeOfDelivery")),
            events=events,
        )

    def test_connection(self):
        """Ask about a number that does not exist: "not found" means the key
        was accepted; "refused" means it was not. Nothing real is looked up."""
        try:
            _data, status = self.get_json(f"{URL}?{urlencode({'trackingNumber': '0000000000'})}", self._headers())
        except Exception as error:  # noqa: BLE001 - reported to the admin as text
            return False, str(error)[:300]
        return True, f"DHL accepted the key (HTTP {status})."


def _place(item):
    address = (item.get("location") or {}).get("address") or {}
    parts = [address.get("addressLocality"), address.get("countryCode")]
    return ", ".join(str(part) for part in parts if part)


def _when(value):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    # Without a time zone DHL means the place's local time, which we cannot
    # know: kept as None rather than guessed.
    return parsed if parsed is not None and parsed.tzinfo is not None else None
