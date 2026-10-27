"""FedEx - prepared, not built.

Official documentation: https://developer.fedex.com (Track API)

WHAT IT CAN DO FOR US
The FedEx Track API looks up a FedEx tracking number and returns its scan
events, so it can follow FedEx parcels coming to the warehouse.

WHAT YOU NEED
- A FedEx Developer Portal account and a project with the Track API, which
  gives an API key and secret key (first for the sandbox, then production).
- Server settings: FEDEX_API_KEY, FEDEX_SECRET_KEY. The environment (sandbox
  or production) is chosen on the Tracking integrations page.

TO BUILD IT
Write fetch() and test_connection() from the official Track API documentation
(an OAuth token with the key and secret, then the tracking-number request with
detailed scans), map FedEx's status codes in normalize_status, set
implemented = True, and add tests with recorded answers.
"""

from .base import CarrierAdapter


class FedExAdapter(CarrierAdapter):
    code = "fedex"
    name = "FedEx"
    carrier_codes = ("fedex",)
    required_settings = ("FEDEX_API_KEY", "FEDEX_SECRET_KEY")
    docs_url = "https://developer.fedex.com"
    account_requirements = "A FedEx Developer Portal project with the Track API (API key and secret key)."
    capabilities = "Tracks FedEx numbers, including parcels sent to us."
    implemented = False
