"""python manage.py create_api_key "Moneybird accounting" invoices:read

Makes an API key from the command line (the admin page does the same) and
prints it once. Scopes: see integrations.models.Scope.
"""

from django.core.management.base import BaseCommand, CommandError

from integrations.models import Scope
from integrations.services import create_api_key


class Command(BaseCommand):
    help = "Create an API key for an outside program and print it once."

    def add_arguments(self, parser):
        parser.add_argument("name", help='Who uses the key, e.g. "Moneybird accounting".')
        parser.add_argument("scopes", nargs="+", help=f"One or more of: {', '.join(Scope.values)}")

    def handle(self, *args, name, scopes, **options):
        unknown = [s for s in scopes if s not in Scope.values]
        if unknown:
            raise CommandError(f"Unknown scope(s): {', '.join(unknown)}. Use: {', '.join(Scope.values)}")

        _, raw_key = create_api_key(name=name, scopes=scopes)
        self.stdout.write(self.style.SUCCESS(f"API key for {name} (copy it now, it is not stored):"))
        self.stdout.write(raw_key)
