"""Fill in `owner` on the courier shipments that existed before pre-alerts.

Every one of them hangs off a booking order, so its owner is that booking's
customer (None for a booking sent without signing in).

A migration of its own, after the schema change in 0004, on purpose: on
PostgreSQL, changing rows and then altering the same table inside one
migration fails with "cannot ALTER TABLE because it has pending trigger
events". Running it twice does no harm - it only sets the same value again.
"""

from django.db import migrations


def fill_owner(apps, schema_editor):
    CarrierShipment = apps.get_model("tracking", "CarrierShipment")
    for shipment in CarrierShipment.objects.filter(order__isnull=False, owner__isnull=True).select_related(
        "order__booking"
    ):
        shipment.owner_id = shipment.order.booking.user_id
        shipment.save(update_fields=["owner"])


class Migration(migrations.Migration):
    dependencies = [
        ("tracking", "0004_prealerts_and_owner"),
    ]

    operations = [
        migrations.RunPython(fill_owner, migrations.RunPython.noop),
    ]
