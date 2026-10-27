"""Each courier's own tracking page, so customers and staff get a clickable link.

{number} is replaced by the (URL-encoded) tracking number. A courier left
empty here gets 17TRACK's page instead, which works for every courier - that
includes PostNL, whose own page also asks for the delivery postcode, and
Amazon. The links can be changed in Django's admin (Courier tracking ->
Carriers) if a courier moves its page.
"""

from django.db import migrations, models

TEMPLATES = {
    "dhl-parcel-nl": "https://www.dhl.com/nl-en/home/tracking.html?tracking-id={number}&submit=1",
    "dhl-express": "https://www.dhl.com/nl-en/home/tracking.html?tracking-id={number}&submit=1",
    "dpd-nl": "https://tracking.dpd.de/status/nl_NL/parcel/{number}",
    "gls-nl": "https://gls-group.com/NL/en/parcel-tracking?match={number}",
    "ups": "https://www.ups.com/track?tracknum={number}",
    "fedex": "https://www.fedex.com/fedextrack/?trknbr={number}",
    "usps": "https://tools.usps.com/go/TrackConfirmAction?tLabels={number}",
}


def add_templates(apps, schema_editor):
    Carrier = apps.get_model("tracking", "Carrier")
    for code, template in TEMPLATES.items():
        Carrier.objects.filter(code=code, tracking_url_template="").update(tracking_url_template=template)


class Migration(migrations.Migration):

    dependencies = [
        ("tracking", "0002_seed_carriers"),
    ]

    operations = [
        migrations.AddField(
            model_name="carrier",
            name="tracking_url_template",
            field=models.URLField(blank=True, max_length=300),
        ),
        migrations.RunPython(add_templates, migrations.RunPython.noop),
    ]
