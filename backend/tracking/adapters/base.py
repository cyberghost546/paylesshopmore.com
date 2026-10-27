"""The interface every tracking adapter follows.

WHAT AN ADAPTER IS
One class per tracking source: a carrier's own API (PostNL, DHL, DPD, Amazon
Shipping, FedEx), the 17TRACK aggregator, or the mock provider for testing.
The rest of the site never talks to an API directly - sync.py asks an adapter,
and every adapter answers in the same shapes (providers.TrackResult /
ProviderResult), with statuses already turned into our own TrackingStatus
values. That is why a new carrier is one new file here, and nothing on the
customer's page or in the database changes.

THE OPERATIONS (what each adapter provides)
    is_configured()      are its environment variables set?
    missing_settings()   which ones are not
    validate_number(n)   could n be one of this carrier's numbers? (format only)
    register(items)      start following numbers, for services that need it
    fetch(items)         the latest data for numbers -> ProviderResult
    test_connection()    one real, harmless request: does the key work?
    normalize_status(c)  a carrier status code -> our TrackingStatus

WHEN AN ADAPTER MAY MAKE REAL REQUESTS
Only when it is "active" (is_active below):
  1. implemented     - its API calls are written (not just prepared);
  2. configured      - its environment variables are set on the server;
  3. enabled         - an admin switched it on (Dashboard -> Tracking integrations);
  4. verified        - a "Test connection" with those credentials succeeded.
Anything less and the site uses 17TRACK (if set up) or manual updates, and the
settings page says exactly which step is missing. Nothing is ever pretended.

CREDENTIALS
Environment variables only, read with os.environ at the moment of use. Never in
the database, never sent to the browser, never written to a log or an error
message (messages here say WHICH setting is missing, never its value).
"""

import json
import os
import urllib.error
import urllib.request

from django.utils import timezone

from ..providers import (
    CredentialsError,
    ProviderError,
    ProviderResult,
    TemporaryProviderError,
)

TIMEOUT_SECONDS = 15


class NotBuiltError(ProviderError):
    """The adapter is prepared, but its API calls have not been written yet."""


class CarrierAdapter:
    """Base class. Subclasses fill in the class attributes and the methods
    marked "override"."""

    # Short name, stored on CarrierShipment.provider and CarrierIntegration.code.
    code = ""
    name = ""
    # Our Carrier.code values this adapter can track ("postnl", "dhl-parcel-nl" ...).
    carrier_codes = ()
    # Environment variable names it needs, in the order an admin sets them.
    required_settings = ()
    # Official documentation, and what an account must have to use it.
    docs_url = ""
    account_requirements = ""
    # Shown on the settings page: what this API can and cannot do for us.
    capabilities = ""
    # True once the API calls below are written and checked against the docs.
    implemented = False
    # Numbers asked about in one request (1 for APIs that take one at a time).
    batch_size = 1
    # 17TRACK must be told about a number before it answers for it.
    needs_registration = False
    # Where the events it stores come from: real courier data, or test data.
    event_source = "carrier_api"

    # ---- configuration ----------------------------------------------------

    def setting(self, name):
        """One environment variable, stripped; "" when unset."""
        return os.environ.get(name, "").strip()

    def missing_settings(self):
        return [name for name in self.required_settings if not self.setting(name)]

    def is_configured(self):
        return not self.missing_settings()

    def integration(self):
        """This adapter's CarrierIntegration row (made the first time it is read)."""
        from ..models import CarrierIntegration

        row, _ = CarrierIntegration.objects.get_or_create(code=self.code)
        return row

    def is_active(self):
        """May it make real requests now? See the module docstring."""
        if not (self.implemented and self.is_configured()):
            return False
        row = self.integration()
        return row.enabled and row.verified_at is not None

    def status(self):
        """The one-word status the settings page shows (see STATUS_LABELS)."""
        # In order: is it built, are the keys there, has a real test worked,
        # and is it switched on.
        if not self.implemented:
            return "not_built"
        if not any(self.setting(name) for name in self.required_settings):
            return "not_configured"
        if self.missing_settings():
            return "awaiting_credentials"
        row = self.integration()
        if row.last_test_ok is False:
            return "connection_failed"
        if row.verified_at is None:
            return "configured_untested"
        if not row.enabled:
            return "disabled"
        return "connected"

    # ---- operations (override) ---------------------------------------------

    def validate_number(self, number):
        """True / False when the format is known, None when it cannot be told."""
        return None

    def register(self, items):
        """Most APIs need no registration: every number is "accepted"."""
        return ProviderResult(accepted=[(number, carrier) for number, carrier in items])

    def fetch(self, items):
        """Override: return a ProviderResult of TrackResult for the numbers."""
        raise NotBuiltError(f"The {self.name} adapter is prepared but its API calls are not built yet.")

    def test_connection(self):
        """Override: one harmless real request. Returns (ok, message)."""
        return False, f"The {self.name} adapter is prepared but its API calls are not built yet."

    def normalize_status(self, code):
        return ""

    # ---- helpers for subclasses ----------------------------------------------

    def get_json(self, url, headers):
        """GET a JSON document. Raises the ProviderError kinds sync.py understands.

        Returns (data, http_status). A 404 is returned, not raised: for a
        tracking API it means "no such number", which is an answer.
        """
        request = urllib.request.Request(url, method="GET", headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode() or "{}"), response.status
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return {}, 404
            if error.code in (401, 403):
                message = f"{self.name} refused the credentials (HTTP {error.code})."
                raise CredentialsError(message, error.code) from None
            if error.code == 429 or error.code >= 500:
                raise TemporaryProviderError(f"{self.name} answered HTTP {error.code}.", error.code) from None
            raise ProviderError(f"{self.name} answered HTTP {error.code}.", error.code) from None
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise TemporaryProviderError(f"Could not reach {self.name}: {error}") from None
        except ValueError:
            raise TemporaryProviderError(f"{self.name} sent an answer that is not JSON.") from None


STATUS_LABELS = {
    "not_built": "Prepared - API calls not built yet",
    "not_configured": "Not configured",
    "awaiting_credentials": "Awaiting credentials",
    "configured_untested": "Configured but untested",
    "connected": "Connected and verified",
    "connection_failed": "Connection failed",
    "disabled": "Disabled",
}


def record_test(adapter, ok, message, user=None):
    """Store the outcome of a "Test connection" on the adapter's row."""
    row = adapter.integration()
    now = timezone.now()
    row.last_test_at = now
    row.last_test_ok = ok
    row.last_test_message = (message or "")[:300]
    row.verified_at = now if ok else None
    row.updated_by = user
    row.save()
    return row
