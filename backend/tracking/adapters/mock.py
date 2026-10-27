"""The mock provider: made-up tracking, for developing and testing only.

WHEN IT IS USED
Only when BOTH are true:
  - the server setting TRACKING_MOCK_PROVIDER=1 is on (off by default, and
    never meant for the live site), and
  - the tracking number starts with "MOCK".
A real tracking number can therefore never get made-up data, whatever is
switched on. Every line it adds is stored with source "mock" and its text
starts with "TEST DATA", and the customer's page labels it "Test data".

THE SCENARIOS (a word anywhere in the number picks one)
    MOCK-REG-1        registered with the carrier, nothing more yet
    MOCK-TRANSIT-1    in transit to the warehouse
    MOCK-WAREHOUSE-1  delivered at the warehouse address
    MOCK-DISPATCH-1   an outgoing shipment dispatched to the island
    MOCK-DELIVERED-1  delivered at the destination
    MOCK-DELAYED-1    delayed
    MOCK-UNKNOWN-1    "the carrier does not know this number"
    MOCK-DOWN-1       "the carrier's API is unavailable" (a temporary error)
"""

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from ..providers import ProviderResult, TemporaryProviderError, TrackEvent, TrackResult
from ..statuses import TrackingStatus
from .base import CarrierAdapter

S = TrackingStatus

# Each scenario: the lines it adds, oldest first: (status, text, place, hours ago).
SCENARIOS = {
    "REG": [(S.ORDER_REGISTERED, "Shipment registered with the carrier", "", 30)],
    "TRANSIT": [
        (S.ORDER_REGISTERED, "Shipment registered with the carrier", "", 30),
        (S.DISPATCHED, "Picked up from the shop", "Tilburg, NL", 26),
        (S.IN_TRANSIT, "Sorted at the distribution centre", "Nieuwegein, NL", 20),
    ],
    "WAREHOUSE": [
        (S.ORDER_REGISTERED, "Shipment registered with the carrier", "", 30),
        (S.IN_TRANSIT, "Sorted at the distribution centre", "Nieuwegein, NL", 20),
        (S.OUT_FOR_DELIVERY, "Out for delivery", "Rotterdam, NL", 6),
        (S.DELIVERED, "Delivered at the warehouse address", "Berkel en Rodenrijs, NL", 2),
    ],
    "DISPATCH": [
        (S.ORDER_REGISTERED, "International shipment registered", "", 30),
        (S.DISPATCHED, "Dispatched from the Netherlands", "Rotterdam, NL", 24),
        (S.IN_TRANSIT, "In transit to the destination", "", 12),
    ],
    "DELIVERED": [
        (S.DISPATCHED, "Dispatched from the Netherlands", "Rotterdam, NL", 240),
        (S.ARRIVED_AT_DESTINATION, "Arrived in the destination country", "Willemstad, CW", 48),
        (S.CUSTOMS, "Customs clearance", "Willemstad, CW", 30),
        (S.OUT_FOR_DELIVERY, "Out for delivery", "Willemstad, CW", 8),
        (S.DELIVERED, "Delivered", "Willemstad, CW", 3),
    ],
    "DELAYED": [
        (S.ORDER_REGISTERED, "Shipment registered with the carrier", "", 72),
        (S.IN_TRANSIT, "Sorted at the distribution centre", "Nieuwegein, NL", 60),
        (S.DELAYED, "Delayed: delivery postponed", "Nieuwegein, NL", 12),
    ],
}

# Checked in this order, so "MOCK-DELIVERED" is not read as "MOCK-DELAYED".
WORDS = ("UNKNOWN", "DOWN", "WAREHOUSE", "DISPATCH", "DELIVERED", "DELAYED", "TRANSIT", "REG")


def scenario_for(number):
    """The scenario word in a MOCK number, or None for any other number."""
    text = (number or "").upper()
    if not text.startswith("MOCK"):
        return None
    for word in WORDS:
        if word in text:
            return word
    return "REG"


class MockAdapter(CarrierAdapter):
    code = "mock"
    name = "Mock provider (test data)"
    capabilities = "Made-up tracking for numbers starting with MOCK. Development and testing only."
    implemented = True
    batch_size = 40
    event_source = "mock"

    def is_configured(self):
        return bool(getattr(settings, "TRACKING_MOCK_PROVIDER", False))

    def is_active(self):
        # No keys and no test needed: it never leaves the server.
        return self.is_configured()

    def handles(self, number):
        return scenario_for(number) is not None

    def fetch(self, items):
        result = ProviderResult(http_status=200)
        now = timezone.now()
        for number, _carrier in items:
            scenario = scenario_for(number)
            if scenario == "DOWN":
                raise TemporaryProviderError("Mock provider: the carrier API is unavailable (test).")
            if scenario in (None, "UNKNOWN"):
                result.rejected.append((number, "Mock provider: unknown tracking number (test)."))
                continue
            lines = SCENARIOS[scenario]
            events = [
                TrackEvent(
                    status=status,
                    description=f"TEST DATA - {text}",
                    location=place,
                    occurred_at=now - timedelta(hours=hours),
                    # Fixed per line, so fetching again adds nothing twice.
                    raw_time=f"mock-{scenario}-{index}",
                )
                for index, (status, text, place, hours) in enumerate(lines)
            ]
            result.accepted.append(
                TrackResult(
                    number=number,
                    carrier_code=None,
                    status=lines[-1][0],
                    location=lines[-1][2],
                    estimated_delivery=None,
                    events=list(reversed(events)),
                )
            )
        return result

    def test_connection(self):
        if not self.is_configured():
            return False, "TRACKING_MOCK_PROVIDER is off."
        return True, "Mock provider on (test data only)."
