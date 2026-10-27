from django.apps import AppConfig


class PreAlertsConfig(AppConfig):
    """Pre-alerts: a customer telling us a parcel is on its way to our warehouse.

    The customer buys at a webshop, has it delivered to our warehouse, and
    registers it here: courier, tracking number, shop, what is inside, its
    value and the invoice. The courier number is then followed like any other
    (tracking app), the warehouse recognises the parcel when it scans the
    courier's barcode, and the office adds it to one of our shipments.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "prealerts"
    verbose_name = "Pre-alerts"
