"""python manage.py sync_carrier_tracking

Asks the tracking services (17TRACK, a carrier's own API once it is set up,
or the mock provider in development) about every courier shipment whose next
check is due, and stores what comes back. Meant to run on a schedule - see
the carrier-tracking job in .do/app.yaml - as a backup for the webhook, which
delivers most updates the moment they happen.

Exits with an error (so the scheduler shows a failed run) when an API key is
refused; does nothing at all while no tracking service is set up.
"""

from django.core.management.base import BaseCommand, CommandError

from tracking.adapters import any_active
from tracking.providers import CredentialsError
from tracking.sync import sync_due


class Command(BaseCommand):
    help = "Fetch courier tracking updates for every shipment that is due."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=400,
            help="Most shipments to check in one run (default 400).",
        )

    def handle(self, *args, limit, **options):
        if not any_active():
            self.stdout.write("No tracking service is set up (e.g. SEVENTEEN_TRACK_API_KEY): nothing to do.")
            return
        try:
            summary = sync_due(limit=limit)
        except CredentialsError as error:
            raise CommandError(f"A tracking service refused its credentials: {error}") from error
        self.stdout.write(
            f"Registered {summary['registered']}, updated {summary['updated']}, "
            f"failed {summary['failed']}."
        )
