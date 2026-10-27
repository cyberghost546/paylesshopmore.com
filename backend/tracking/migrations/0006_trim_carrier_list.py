"""The courier list, trimmed to the couriers customers actually use.

Kept:     PostNL, DHL, DPD, Amazon, FedEx.
Hidden:   GLS, UPS, USPS / Post office, Other, Walk-in, and DHL Express (now
          part of the one "DHL").

Hidden, not deleted: a courier is switched off (is_active=False), so it
leaves the drop-down lists while every shipment already saved with it keeps
its courier, its history and its link. Switch one back on in Django's admin
(Courier tracking -> Carriers) if it is needed again.

DHL: "DHL Parcel (NL)" becomes plain "DHL" and covers DHL Express too. Its
17TRACK code is cleared, so 17TRACK works out from each number which DHL it
is, and its link goes to DHL's own page, which takes both.
"""

from django.db import migrations

KEEP = ["postnl", "dhl-parcel-nl", "dpd-nl", "amazon", "fedex"]
# The order they are listed in.
POSITIONS = {"postnl": 10, "dhl-parcel-nl": 20, "dpd-nl": 30, "amazon": 40, "fedex": 50}


def trim(apps, schema_editor):
    Carrier = apps.get_model("tracking", "Carrier")
    Carrier.objects.exclude(code__in=KEEP).update(is_active=False)
    for code, position in POSITIONS.items():
        Carrier.objects.filter(code=code).update(is_active=True, position=position)
    Carrier.objects.filter(code="dhl-parcel-nl").update(
        name="DHL",
        seventeen_track_code=None,
        tracking_url_template="https://www.dhl.com/nl-en/home/tracking.html?tracking-id={number}&submit=1",
    )


def restore(apps, schema_editor):
    Carrier = apps.get_model("tracking", "Carrier")
    Carrier.objects.update(is_active=True)
    Carrier.objects.filter(code="dhl-parcel-nl").update(name="DHL Parcel (NL)", seventeen_track_code=100047)


class Migration(migrations.Migration):
    dependencies = [
        ("tracking", "0005_fill_owner"),
    ]

    operations = [
        migrations.RunPython(trim, restore),
    ]
