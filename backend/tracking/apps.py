from django.apps import AppConfig


class TrackingConfig(AppConfig):
    """Courier tracking: following a webshop's parcel on its way to our warehouse.

    Our own shipping (warehouse -> island) is tracked by accounts.Package and
    its history (accounts.PackageEvent). This app covers the leg before that:
    the customer buys at bol.com or Amazon, the shop hands the parcel to a
    courier (PostNL, DHL, ...), and the courier brings it to our warehouse.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "tracking"
    verbose_name = "Courier tracking"
