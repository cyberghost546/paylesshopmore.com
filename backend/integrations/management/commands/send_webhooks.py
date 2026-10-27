"""python manage.py send_webhooks

Sends every webhook delivery that is due (new, or waiting for a retry).

When you need it:
- Local development, where there is no Celery worker: retries are not
  scheduled automatically (see integrations/tasks.py), so run this.
- In production, optionally as a safety net on a schedule, in case a worker
  was down when a retry was due.
"""

from django.core.management.base import BaseCommand

from integrations.tasks import send_due_deliveries


class Command(BaseCommand):
    help = "Send webhook deliveries that are due."

    def handle(self, *args, **options):
        count = send_due_deliveries()
        self.stdout.write(f"Tried {count} delivery(ies).")
