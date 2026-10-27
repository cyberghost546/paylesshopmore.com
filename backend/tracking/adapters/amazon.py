"""Amazon Shipping - prepared, not built.

Official documentation: https://developer-docs.amazon.com/amazon-shipping/

WHAT IT CAN DO FOR US - AND WHAT IT CANNOT
The Amazon Shipping API tracks shipments sent by Amazon Shipping customers -
businesses that use Amazon as their carrier. Orders a customer buys on
amazon.nl are usually delivered by Amazon Logistics or another carrier, and
are not tracked through this API by the recipient. So it only helps if you
send parcels with your own Amazon Shipping account. For Amazon orders coming
to the warehouse use 17TRACK (it detects the carrier), or manual updates.

WHAT YOU NEED
- An Amazon Shipping account and a registered developer application (Login
  with Amazon client id and secret, and a refresh token for the account).
- Server settings: AMAZON_SHIPPING_CLIENT_ID, AMAZON_SHIPPING_CLIENT_SECRET,
  AMAZON_SHIPPING_REFRESH_TOKEN.

TO BUILD IT
Write fetch() and test_connection() from the official documentation (get an
access token, then the tracking operation per tracking id), map Amazon's
status values in normalize_status, set implemented = True, add tests.
"""

from .base import CarrierAdapter


class AmazonShippingAdapter(CarrierAdapter):
    code = "amazon"
    name = "Amazon Shipping"
    carrier_codes = ("amazon",)
    required_settings = (
        "AMAZON_SHIPPING_CLIENT_ID",
        "AMAZON_SHIPPING_CLIENT_SECRET",
        "AMAZON_SHIPPING_REFRESH_TOKEN",
    )
    docs_url = "https://developer-docs.amazon.com/amazon-shipping/"
    account_requirements = "An Amazon Shipping (business) account and a registered developer application."
    capabilities = "Only shipments sent with your own Amazon Shipping account - not amazon.nl orders."
    implemented = False
