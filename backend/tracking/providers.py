"""Talking to an outside tracking service (17TRACK).

WHAT A PROVIDER DOES
Two things, both in batches of numbers:
  register(items)  "please start following these numbers"
  fetch(items)     "what do you know about these numbers now?"
Each returns a ProviderResult (see below). The rest of the app (sync.py) never
sees 17TRACK's JSON shape directly - it only reads TrackResult objects - so
another service (AfterShip, a courier's own API) can be added later by writing
one more class with the same two methods.

CONFIGURATION (environment variables, server side only - never in the frontend)
  SEVENTEEN_TRACK_API_KEY   the "security key" from 17TRACK's dashboard.
                            Unset = no automatic tracking; staff update by hand.
  SEVENTEEN_TRACK_API_URL   defaults to https://api.17track.net/track/v2.2

ERRORS
Network trouble and "too many requests" raise TemporaryProviderError: try
again later. A wrong or expired key raises CredentialsError: stop and tell a
person, because retrying will never fix it.
"""

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime

from django.conf import settings
from django.utils.dateparse import parse_date, parse_datetime

from .statuses import from_seventeen_track

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 15
# 17TRACK accepts at most 40 numbers per call.
BATCH_SIZE = 40
# 17TRACK's answer when a number is registered already. Not an error for us.
ALREADY_REGISTERED = -18019901


class ProviderError(Exception):
    """The service refused the request. `http_status` when there was one."""

    def __init__(self, message, http_status=None):
        super().__init__(message)
        self.http_status = http_status


class TemporaryProviderError(ProviderError):
    """Timeout, network failure, server error or rate limit: retry later."""


class CredentialsError(ProviderError):
    """The API key is missing, wrong or expired: retrying will not help."""


@dataclass
class TrackEvent:
    """One history line as the service reported it, already in our words."""

    status: str  # a TrackingStatus value, or "" for a plain information line
    description: str
    location: str
    occurred_at: datetime | None
    raw_time: str = ""


@dataclass
class TrackResult:
    """Everything the service knows about one number."""

    number: str
    carrier_code: int | None
    status: str  # a TrackingStatus value, or "" when unknown
    location: str = ""
    estimated_delivery: date | None = None
    events: list = field(default_factory=list)


@dataclass
class ProviderResult:
    """What one call returned: the numbers it handled and the ones it refused."""

    accepted: list = field(default_factory=list)  # TrackResult, or (number, carrier_code) for register
    rejected: list = field(default_factory=list)  # (number, message)
    http_status: int | None = None


class SeventeenTrack:
    """17TRACK API v2.2 (https://api.17track.net/en/doc)."""

    name = "17track"

    def __init__(self, api_key, base_url):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    # ---- the two operations ------------------------------------------------

    def register(self, items):
        """Start following numbers. `items`: list of (number, carrier_code or None).

        Returns ProviderResult with accepted = [(number, detected_carrier_code)].
        """
        body = [self._item(number, carrier) for number, carrier in items]
        data, http_status = self._post("register", body)

        result = ProviderResult(http_status=http_status)
        for row in data.get("accepted") or []:
            result.accepted.append((row.get("number"), row.get("carrier") or None))
        for row in data.get("rejected") or []:
            error = row.get("error") or {}
            if error.get("code") == ALREADY_REGISTERED:
                # Registered before (perhaps by an earlier try): that is fine.
                result.accepted.append((row.get("number"), row.get("carrier") or None))
            else:
                result.rejected.append((row.get("number"), error.get("message") or "Rejected"))
        return result

    def fetch(self, items):
        """Latest data for registered numbers. Returns ProviderResult of TrackResult."""
        body = [self._item(number, carrier) for number, carrier in items]
        data, http_status = self._post("gettrackinfo", body)

        result = ProviderResult(http_status=http_status)
        for row in data.get("accepted") or []:
            result.accepted.append(self.parse(row))
        for row in data.get("rejected") or []:
            error = row.get("error") or {}
            result.rejected.append((row.get("number"), error.get("message") or "Rejected"))
        return result

    # ---- reading 17TRACK's answer ------------------------------------------

    @staticmethod
    def parse(row):
        """Turn one 17TRACK tracking object into a TrackResult.

        Used for fetch() answers and for webhook pushes, which carry the same
        object. Missing parts are fine: a brand-new number has no events yet.
        """
        info = row.get("track_info") or {}
        latest = info.get("latest_status") or {}
        latest_event = info.get("latest_event") or {}
        metrics = info.get("time_metrics") or {}
        eta = (metrics.get("estimated_delivery_date") or {})

        events = []
        for provider in (info.get("tracking") or {}).get("providers") or []:
            for event in provider.get("events") or []:
                events.append(
                    TrackEvent(
                        status=from_seventeen_track(event.get("stage"), event.get("sub_status")),
                        description=(event.get("description") or "")[:500],
                        location=_location(event)[:200],
                        occurred_at=_when(event),
                        raw_time=event.get("time_iso") or event.get("time_raw") or "",
                    )
                )

        return TrackResult(
            number=row.get("number") or "",
            carrier_code=row.get("carrier") or None,
            status=from_seventeen_track(latest.get("status"), latest.get("sub_status")),
            location=_location(latest_event)[:200],
            # A range is given; the later end is the honest promise.
            estimated_delivery=_day(eta.get("to") or eta.get("from")),
            events=events,
        )

    # ---- HTTP ---------------------------------------------------------------

    @staticmethod
    def _item(number, carrier):
        item = {"number": number}
        if carrier:
            item["carrier"] = carrier
        return item

    def _post(self, endpoint, body):
        """POST JSON to 17TRACK. Returns (data, http_status) or raises ProviderError."""
        request = urllib.request.Request(
            f"{self.base_url}/{endpoint}",
            data=json.dumps(body).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "17token": self.api_key},
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                status = response.status
                payload = json.loads(response.read().decode() or "{}")
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise CredentialsError("17TRACK refused the API key.", error.code) from None
            if error.code == 429 or error.code >= 500:
                raise TemporaryProviderError(f"17TRACK answered HTTP {error.code}.", error.code) from None
            raise ProviderError(f"17TRACK answered HTTP {error.code}.", error.code) from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise TemporaryProviderError(f"Could not reach 17TRACK: {error}") from None
        except ValueError:
            raise TemporaryProviderError("17TRACK sent an answer that is not JSON.") from None

        # 17TRACK answers 200 with its own "code": 0 means fine.
        if payload.get("code") != 0:
            message = str((payload.get("data") or {}).get("errors") or payload)[:300]
            # Their documented key errors start with -1801000x.
            if str(payload.get("code", "")).startswith("-1801000"):
                raise CredentialsError(f"17TRACK refused the request: {message}", status)
            raise ProviderError(f"17TRACK refused the request: {message}", status)
        return payload.get("data") or {}, status


def _location(event):
    """A short place name from an event: "Utrecht, NL"."""
    if event.get("location"):
        return str(event["location"])
    address = event.get("address") or {}
    parts = [address.get("city"), address.get("state"), address.get("country")]
    return ", ".join(str(part) for part in parts if part)


def _when(event):
    """The event time as an aware datetime, or None if the courier gave none."""
    for key in ("time_utc", "time_iso"):
        value = event.get(key)
        if value:
            parsed = parse_datetime(value)
            if parsed is not None and parsed.tzinfo is not None:
                return parsed
    return None


def _day(value):
    if not value:
        return None
    return parse_date(str(value)[:10])


def get_provider():
    """The configured provider, or None when automatic tracking is off."""
    key = getattr(settings, "SEVENTEEN_TRACK_API_KEY", "")
    if not key:
        return None
    return SeventeenTrack(key, getattr(settings, "SEVENTEEN_TRACK_API_URL", "https://api.17track.net/track/v2.2"))
