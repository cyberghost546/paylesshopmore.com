"""Fill empty intake forms from measurements already taken on the package page.

Since operations._fill_intake_sheet, measuring on the package page also fills
the package's intake form. Packages measured before that have an intake form
with no lines, so the measurement looked lost when the form was opened. This
copies them over once, with the same rules: only the newest sheet of the
package, only a draft, and only when it has no lines yet.
"""

from django.db import migrations


def fill(apps, schema_editor):
    IntakeSheet = apps.get_model("warehouse", "IntakeSheet")
    Measurement = apps.get_model("warehouse", "Measurement")
    PackageMeasurement = apps.get_model("warehouse", "PackageMeasurement")

    done = set()
    for sheet in IntakeSheet.objects.filter(package__isnull=False).order_by("-created_at"):
        # Only the newest sheet of each package.
        if sheet.package_id in done:
            continue
        done.add(sheet.package_id)
        if sheet.status != "draft" or Measurement.objects.filter(sheet=sheet).exists():
            continue
        current = (
            PackageMeasurement.objects.filter(package_id=sheet.package_id)
            .order_by("-measured_at", "-id")
            .first()
        )
        if current is None:
            continue
        Measurement.objects.create(
            sheet=sheet,
            quantity=1,
            length_cm=current.length_cm,
            width_cm=current.width_cm,
            height_cm=current.height_cm,
            weight_kg=current.weight_kg,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("warehouse", "0008_intake_sheet_photos"),
    ]

    operations = [migrations.RunPython(fill, migrations.RunPython.noop)]
