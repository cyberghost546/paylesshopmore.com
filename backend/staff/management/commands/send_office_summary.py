"""E-mail the office's daily summary (staff/daily_summary.py).

    python manage.py send_office_summary                  # about yesterday (the default)
    python manage.py send_office_summary --date 2026-09-14

Meant for the morning: it runs right after the warehouse report in the same
Railway cron job (railway.cron.json). "Waiting now" is counted at the moment
it runs; the activity is the given day's. Goes to the same office staff as
the warehouse report. The AI's "Start with" lines are added when
OPENAI_API_KEY is set; without it the e-mail has only the numbers.
"""

from datetime import date, timedelta

from django.core.mail import EmailMessage
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from staff import daily_summary
from warehouse.recipients import office_recipients


class Command(BaseCommand):
    help = "E-mail the office's daily summary: yesterday's activity and what is waiting now."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="The day to report on, YYYY-MM-DD. Default: yesterday.")

    def handle(self, *args, **options):
        if options.get("date"):
            try:
                day = date.fromisoformat(options["date"])
            except ValueError:
                raise CommandError("--date must be YYYY-MM-DD.") from None
        else:
            day = timezone.localdate() - timedelta(days=1)

        addresses = office_recipients()
        if not addresses:
            self.stderr.write("Nobody in the office to send the summary to; nothing sent.")
            return

        data = daily_summary.build(day)
        body = daily_summary.to_text(data, daily_summary.write_highlights(data))
        EmailMessage(subject=f"Daily summary {data['date']}", body=body, to=addresses).send(fail_silently=False)

        self.stdout.write(f"Daily summary for {data['date']} sent to {len(addresses)} address(es).")
