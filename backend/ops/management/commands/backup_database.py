"""Back up the database now.

    python manage.py backup_database

Meant to run every night from its own scheduled Railway service
(railway.backup.json). All the work is in ops/backup.py; this only runs it,
tells Sentry (when set up) that it ran, and exits with an error when the backup
failed - so Railway marks the run red as well.
"""

from django.core.management.base import BaseCommand, CommandError

from ops.backup import run_backup
from ops.models import BackupRun
from ops.monitoring import check_in

# Must match "cronSchedule" in railway.backup.json, so Sentry knows when to
# expect the next run.
SCHEDULE = "0 3 * * *"


class Command(BaseCommand):
    help = "Dump the database and store the copy in the backup bucket (see docs/BACKUPS.md)."

    def handle(self, *args, **options):
        check_id = check_in("database-backup", "in_progress", schedule=SCHEDULE)
        run = run_backup()

        if run.status != BackupRun.Status.OK:
            check_in("database-backup", "error", check_id)
            raise CommandError(f"Backup failed: {run.error}")

        check_in("database-backup", "ok", check_id)
        size_mb = (run.size_bytes or 0) / 1024 / 1024
        self.stdout.write(
            f"Backup stored at {run.location} ({size_mb:.1f} MB). "
            f"{run.pruned} old backup(s) removed."
        )
