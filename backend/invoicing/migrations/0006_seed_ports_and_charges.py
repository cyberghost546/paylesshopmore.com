"""Fill in the ports and charge types the office already uses.

Taken from the paper invoices (factuur idea.pdf), so the editor is usable the
day this is deployed. They are ordinary rows: an admin can rename, reorder,
switch off or add to them on the invoice settings page afterwards.

Reversible: going back deletes only rows with exactly these names.
"""

from django.db import migrations

# (name, freight, for_loading, for_discharge, destination_code, is_default)
PORTS = [
    ("Rotterdam, NL", "sea", True, False, "", True),
    ("Amsterdam Schiphol, NL", "air", True, False, "", True),
    ("Willemstad, CUR", "sea", False, True, "CW", True),
    ("Oranjestad, ABW", "sea", False, True, "AW", False),
    ("Kralendijk, BES", "sea", False, True, "BQ", False),
    ("Philipsburg, SXM", "sea", False, True, "SX", False),
    ("Paramaribo, SUR", "sea", False, True, "SR", False),
    ("Curaçao Airport (CUR)", "air", False, True, "CW", True),
    ("Aruba Airport (AUA)", "air", False, True, "AW", False),
    ("Bonaire Airport (BON)", "air", False, True, "BQ", False),
    ("Sint Maarten Airport (SXM)", "air", False, True, "SX", False),
    ("Paramaribo Airport (PBM)", "air", False, True, "SR", False),
]

# (name, freight). In the order they are printed on the paper invoice.
# No default amounts: the prices were not on the PDF, and an invented price
# on an invoice is worse than an empty box.
CHARGES = [
    ("Aankoop 40' HC container", "sea"),
    ("Zeevracht", "sea"),
    ("Luchtvracht", "air"),
    ("Bunkertoeslag", "sea"),
    ("Emergency BAF", "sea"),
    ("Terminal Handling Rotterdam", "sea"),
    ("Maastricht - haven Rotterdam", "sea"),
    ("Voorrijkosten en extra mankracht", "both"),
    ("Laadkosten", "both"),
    ("Weegkosten", "both"),
    ("Administratie", "both"),
    ("Documentatie", "both"),
    ("Handling Fee", "both"),
]


def seed(apps, schema_editor):
    Port = apps.get_model("invoicing", "Port")
    ChargeType = apps.get_model("invoicing", "ChargeType")

    for position, (name, freight, loading, discharge, code, default) in enumerate(PORTS):
        Port.objects.get_or_create(
            name=name,
            defaults={
                "freight": freight,
                "for_loading": loading,
                "for_discharge": discharge,
                "destination_code": code,
                "is_default": default,
                "position": position,
            },
        )

    for position, (name, freight) in enumerate(CHARGES):
        ChargeType.objects.get_or_create(
            name=name, defaults={"freight": freight, "position": position}
        )


def unseed(apps, schema_editor):
    apps.get_model("invoicing", "Port").objects.filter(
        name__in=[row[0] for row in PORTS]
    ).delete()
    apps.get_model("invoicing", "ChargeType").objects.filter(
        name__in=[row[0] for row in CHARGES]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("invoicing", "0005_invoice_editor")]

    operations = [migrations.RunPython(seed, unseed)]
