"""The courier list the site starts with.

The couriers Dutch webshops (bol.com, Amazon.nl, Coolblue, IKEA, ...) hand
parcels to. The numbers are 17TRACK's own codes for each courier, from
https://res.17track.net/asset/carrier/info/apicarrier.all.json - giving the
code saves 17TRACK guessing. Amazon and "Other" have no code: 17TRACK then
works the courier out from the tracking number itself.

After this migration the list is edited in Django's admin (Courier tracking ->
Carriers), not here.
"""

from django.db import migrations

CARRIERS = [
    # (code, name, 17TRACK code, trackable, position)
    ("postnl", "PostNL", 14041, True, 10),
    ("dhl-parcel-nl", "DHL Parcel (NL)", 100047, True, 20),
    ("dhl-express", "DHL Express", 100001, True, 30),
    ("dpd-nl", "DPD", 100811, True, 40),
    ("gls-nl", "GLS", 100384, True, 50),
    ("ups", "UPS", 100002, True, 60),
    ("fedex", "FedEx", 100003, True, 70),
    ("amazon", "Amazon", None, True, 80),
    ("usps", "USPS / Post office (US)", 21051, True, 90),
    # Brought to the warehouse by hand: nothing to track.
    ("walk-in", "Walk-in (brought by hand)", None, False, 100),
    ("other", "Other", None, True, 110),
]


def add_carriers(apps, schema_editor):
    Carrier = apps.get_model("tracking", "Carrier")
    for code, name, seventeen_track_code, trackable, position in CARRIERS:
        Carrier.objects.update_or_create(
            code=code,
            defaults={
                "name": name,
                "seventeen_track_code": seventeen_track_code,
                "trackable": trackable,
                "position": position,
            },
        )


def remove_carriers(apps, schema_editor):
    Carrier = apps.get_model("tracking", "Carrier")
    Carrier.objects.filter(code__in=[row[0] for row in CARRIERS], shipments__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("tracking", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(add_carriers, remove_carriers),
    ]
