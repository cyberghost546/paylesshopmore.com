"""DPD - prepared, not built.

Official documentation: https://integrations.dpd.nl (DPD Netherlands
integrations: myDPD, DPD Insights, and the Shipper web service)

WHAT IT CAN DO FOR US - AND WHAT IT CANNOT
DPD Netherlands only allows tracking of parcels you sent or receive as a DPD
customer, through its shipper web services (ParcelLifeCycle). Access comes with
a DPD business account and is set up together with DPD. Until then, incoming
DPD parcels are followed through 17TRACK or updated by hand.

WHAT YOU NEED
- A DPD Netherlands business account with web-service access (ask your DPD
  account manager), and its delis ID, password and the service address DPD gives.
- Server settings: DPD_DELIS_ID, DPD_PASSWORD, DPD_API_URL.

TO BUILD IT
Write fetch() and test_connection() from the documentation DPD provides with
the account (log in for a token, then ask ParcelLifeCycle per parcel number),
map DPD's status codes in normalize_status, set implemented = True, add tests.
"""

from .base import CarrierAdapter


class DpdAdapter(CarrierAdapter):
    code = "dpd"
    name = "DPD"
    carrier_codes = ("dpd-nl",)
    required_settings = ("DPD_DELIS_ID", "DPD_PASSWORD", "DPD_API_URL")
    docs_url = "https://integrations.dpd.nl"
    account_requirements = "A DPD Netherlands business account with web-service access, arranged with DPD."
    capabilities = "Only parcels you send or receive as a DPD business customer."
    implemented = False
