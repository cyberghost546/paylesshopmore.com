"""PostNL - prepared, not built.

Official documentation: https://developer.postnl.nl (Send & Track -> Shipping
status API)

WHAT IT CAN DO FOR US - AND WHAT IT CANNOT
PostNL's Shipping status API only answers for parcels sent under YOUR OWN
PostNL customer number: the request carries your customer number and code,
and data only comes back when they match the parcel. A parcel a webshop sends
to our warehouse is the webshop's, not ours - so this API will NOT track the
incoming parcels. It could track parcels WE send with our own PostNL contract
(outgoing). For incoming PostNL parcels use 17TRACK, or manual updates.

WHAT YOU NEED
- A PostNL business contract, and in the PostNL business portal (Company
  details -> Manage API) the API key, customer number and customer code.
- Server settings: POSTNL_API_KEY, POSTNL_CUSTOMER_NUMBER, POSTNL_CUSTOMER_CODE.

TO BUILD IT
Write fetch() and test_connection() from the official Shipping status API
documentation (look up by barcode with the detail flag on, map PostNL's
status codes in normalize_status), set implemented = True, and add tests with
recorded answers. Nothing else in the site has to change.
"""

from .base import CarrierAdapter


class PostNLAdapter(CarrierAdapter):
    code = "postnl"
    name = "PostNL"
    carrier_codes = ("postnl",)
    required_settings = ("POSTNL_API_KEY", "POSTNL_CUSTOMER_NUMBER", "POSTNL_CUSTOMER_CODE")
    docs_url = "https://developer.postnl.nl"
    account_requirements = "A PostNL business contract: API key, customer number and customer code."
    capabilities = "Only parcels sent with your own PostNL customer number - not webshop parcels to the warehouse."
    implemented = False
