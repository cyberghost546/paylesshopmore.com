"""Which adapter tracks which shipment.

Every tracking source is an adapter (base.py explains the interface):
    17track    the aggregator - any courier, one key
    dhl        DHL's own API (built; needs a key and a successful test)
    postnl, dpd, amazon, fedex   prepared; their API calls are still to be written
    mock       made-up test data, development only

choose_adapter(shipment) picks, in this order:
  1. the mock provider, for a MOCK... number while it is switched on;
  2. the courier's own API, when that adapter is active (built, configured,
     switched on and tested - see base.CarrierAdapter.is_active);
  3. 17TRACK, when its key is set;
  4. none: the shipment is updated by hand.
"""

from .amazon import AmazonShippingAdapter
from .dhl import DhlAdapter
from .dpd import DpdAdapter
from .fedex import FedExAdapter
from .mock import MockAdapter
from .postnl import PostNLAdapter
from .seventeen_track import SeventeenTrackAdapter

MOCK = MockAdapter()
SEVENTEEN_TRACK = SeventeenTrackAdapter()

# The carriers' own APIs, in the order the settings page lists them.
CARRIER_ADAPTERS = [PostNLAdapter(), DhlAdapter(), DpdAdapter(), AmazonShippingAdapter(), FedExAdapter()]

ADAPTERS = {adapter.code: adapter for adapter in [SEVENTEEN_TRACK, MOCK, *CARRIER_ADAPTERS]}


def get_adapter(code):
    return ADAPTERS.get(code)


def carrier_adapter_for(carrier):
    """The direct adapter for one of our Carrier rows, active or not, or None."""
    if carrier is None:
        return None
    for adapter in CARRIER_ADAPTERS:
        if carrier.code in adapter.carrier_codes:
            return adapter
    return None


def choose_adapter(shipment):
    """The adapter that should track `shipment` now, or None (manual only)."""
    carrier = shipment.carrier
    if carrier is not None and not carrier.trackable:
        return None
    if MOCK.handles(shipment.tracking_number):
        # A MOCK number is never sent to a real API: test data or nothing.
        return MOCK if MOCK.is_active() else None
    direct = carrier_adapter_for(carrier)
    if direct is not None and direct.is_active():
        return direct
    if SEVENTEEN_TRACK.is_active():
        return SEVENTEEN_TRACK
    return None


def any_active():
    """Is any tracking source able to make requests right now?"""
    return any(adapter.is_active() for adapter in ADAPTERS.values())
