"""A record of every database backup attempt.

READ THIS FIRST: one row per run of `python manage.py backup_database`
(ops/backup.py). The dashboard's "System" page reads these rows, so the office
can see with their own eyes that last night's backup worked - without logging
in to Railway or the storage bucket.

A row is written when the run STARTS (status "running") and updated when it
ends ("ok" or "failed"). So a row that stays "running" means the process was
killed half-way, which is worth knowing too.
"""

from django.db import models


class BackupRun(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        OK = "ok", "OK"
        FAILED = "failed", "Failed"

    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RUNNING)

    # Where the file went, e.g. "s3://plsm-backups/backups/db-2026-10-23_030000.dump"
    location = models.CharField(max_length=500, blank=True)
    size_bytes = models.BigIntegerField(null=True, blank=True)
    # How many old backups were removed by the clean-up afterwards.
    pruned = models.PositiveIntegerField(default=0)
    # What went wrong, in short, when status is "failed".
    error = models.TextField(blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"Backup {self.started_at:%Y-%m-%d %H:%M} ({self.status})"
