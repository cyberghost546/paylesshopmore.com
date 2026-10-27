"""Every package is now in one fixed warehouse, PAYLESSHOPMORE.

CARIBINTERTRANS was removed as a warehouse. Packages that still say they are
there are moved to PAYLESSHOPMORE, so the package page does not show a
warehouse that no longer exists. Any other location (a shelf such as B-04)
is left alone.
"""

from django.db import migrations


def move(apps, schema_editor):
    Package = apps.get_model("accounts", "Package")
    # Also when somebody typed it with spaces ("CARIB INTER TRANS").
    for package in Package.objects.exclude(warehouse_location=""):
        if package.warehouse_location.replace(" ", "").upper() == "CARIBINTERTRANS":
            package.warehouse_location = "PAYLESSHOPMORE"
            package.save(update_fields=["warehouse_location"])


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0032_package_handover_chosen_at"),
    ]

    operations = [migrations.RunPython(move, migrations.RunPython.noop)]
