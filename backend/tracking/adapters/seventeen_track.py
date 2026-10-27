"""17TRACK as an adapter: one key, every courier.

The actual API code is tracking/providers.py (SeventeenTrack), unchanged. This
wraps it in the adapter interface so sync.py treats it like any other source.
It is the fall-back for every courier whose own API is not active, and the
quickest way to automatic tracking: one SEVENTEEN_TRACK_API_KEY covers PostNL,
DHL, DPD, Amazon and FedEx alike, also for parcels someone else sent.
"""

from django.conf import settings

from ..providers import BATCH_SIZE, get_provider
from .base import CarrierAdapter


class SeventeenTrackAdapter(CarrierAdapter):
    code = "17track"
    name = "17TRACK"
    required_settings = ("SEVENTEEN_TRACK_API_KEY",)
    docs_url = "https://api.17track.net/en/doc"
    account_requirements = "A 17TRACK API account (quota per registered number)."
    capabilities = "Every courier, any number. Webhook push plus scheduled checks."
    implemented = True
    batch_size = BATCH_SIZE
    needs_registration = True

    def setting(self, name):
        # From Django's settings (which tests can change), not straight from
        # the environment.
        return str(getattr(settings, name, "") or "").strip()

    def is_active(self):
        # Switched on by its key alone, as it always was (docs/TRACKING.md).
        return self.is_configured()

    def register(self, items):
        return get_provider().register(items)

    def fetch(self, items):
        return get_provider().fetch(items)

    def test_connection(self):
        """Ask about a made-up number: a refused key raises, anything else answers."""
        try:
            get_provider().fetch([("0000000000", None)])
        except Exception as error:  # noqa: BLE001 - reported to the admin as text
            return False, str(error)[:300]
        return True, "17TRACK accepted the key."
