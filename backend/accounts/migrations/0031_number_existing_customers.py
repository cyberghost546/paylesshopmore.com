"""Give every existing account its customer number (PLSM-C00001, PLSM-C002 ...).

In the order the accounts were made, oldest first, so the first customer is
PLSM-C00001. The counter is then set to the last one, so the next new account
carries on from there. A migration of its own, after the column exists
(0030): on PostgreSQL, changing rows and altering the table in the same
migration can fail. Running it again does nothing: numbered accounts are
skipped.
"""

from django.db import migrations
from django.db.models import Max


def number_accounts(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    Sequence = apps.get_model("accounts", "CustomerNumberSequence")

    number = User.objects.aggregate(top=Max("customer_number"))["top"] or 0
    for user in User.objects.filter(customer_number__isnull=True).order_by("date_joined", "pk"):
        number += 1
        User.objects.filter(pk=user.pk).update(customer_number=number)

    row, _ = Sequence.objects.get_or_create(pk=1)
    row.last_number = max(row.last_number, number)
    row.save()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0030_customer_number"),
    ]

    operations = [
        migrations.RunPython(number_accounts, migrations.RunPython.noop),
    ]
