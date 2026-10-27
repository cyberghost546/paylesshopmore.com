"""Backups, the System page and browser error reports (the ops app).

What matters:
  * a backup really writes a file, records an "ok" row, and cleans up old
    copies without ever going below the minimum;
  * a backup with nowhere to go fails loudly: "failed" row, admins e-mailed,
    the command exits with an error;
  * the backup bucket may never be the public media bucket;
  * only admins see the System page;
  * a browser error report is logged, and answers 204.
"""

import gzip
import io
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from config.testing import ReauthenticatedAPIClient

from .backup import BackupError, S3Destination, old_backups, run_backup
from .models import BackupRun

User = get_user_model()

EMAIL = "django.core.mail.backends.locmem.EmailBackend"


def day(number):
    return datetime(2026, 10, number, 3, 0, tzinfo=UTC)


class OldBackupsTests(TestCase):
    """The clean-up rule, as a pure function."""

    def test_keeps_the_newest_and_the_young_ones(self):
        existing = [("a", day(30)), ("b", day(29)), ("c", day(15)), ("d", day(2)), ("e", day(1))]
        now = day(31)

        # keep_days=20: anything before 11 Oct goes, but the newest 2 always stay.
        self.assertEqual(old_backups(existing, now, keep_days=20, keep_min=2), ["d", "e"])

    def test_never_goes_below_the_minimum(self):
        existing = [("a", day(1)), ("b", day(2))]
        # Both are ancient, but they are the only two: both stay.
        self.assertEqual(old_backups(existing, day(31), keep_days=1, keep_min=2), [])


@override_settings(EMAIL_BACKEND=EMAIL, BACKUP_S3_BUCKET="")
class RunBackupTests(TransactionTestCase):
    """TransactionTestCase, not TestCase: TestCase keeps every test inside an
    open transaction, and SQLite's backup function waits for that to finish -
    which, inside the test, it never does."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        User.objects.create_user(
            username="admin@example.com", email="admin@example.com", password="x" * 20, role=User.Role.ADMIN
        )

    def test_writes_a_readable_copy_and_records_it(self):
        with override_settings(BACKUP_DIR=self.folder.name):
            run = run_backup()

        self.assertEqual(run.status, BackupRun.Status.OK, run.error)
        stored = Path(run.location)
        self.assertTrue(stored.exists())
        self.assertGreater(run.size_bytes, 0)
        # It is a gzipped SQLite database: the first bytes say so.
        with gzip.open(stored, "rb") as handle:
            self.assertEqual(handle.read(15), b"SQLite format 3")
        self.assertEqual(len(mail.outbox), 0)

    def test_with_nowhere_to_go_it_fails_and_warns_the_admins(self):
        with override_settings(BACKUP_DIR=""):
            run = run_backup()

        self.assertEqual(run.status, BackupRun.Status.FAILED)
        self.assertIn("BACKUP_S3_BUCKET", run.error)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["admin@example.com"])
        self.assertIn("FAILED", mail.outbox[0].subject)

    def test_the_command_exits_with_an_error_when_it_fails(self):
        with override_settings(BACKUP_DIR=""), self.assertRaises(CommandError):
            call_command("backup_database")

    def test_the_command_reports_where_the_copy_went(self):
        out = io.StringIO()
        with override_settings(BACKUP_DIR=self.folder.name):
            call_command("backup_database", stdout=out)
        self.assertIn("Backup stored at", out.getvalue())


class S3DestinationTests(TestCase):
    @override_settings(BACKUP_S3_BUCKET="plsm-media", AWS_STORAGE_BUCKET_NAME="plsm-media")
    def test_refuses_the_public_media_bucket(self):
        with self.assertRaises(BackupError):
            S3Destination()


class SystemStatusTests(APITestCase):
    client_class = ReauthenticatedAPIClient
    url = "/api/staff/system/"

    def test_admins_see_the_backups(self):
        admin = User.objects.create_user(
            username="admin@example.com", email="admin@example.com", password="x" * 20,
            role=User.Role.ADMIN, is_staff=True,
        )
        BackupRun.objects.create(status=BackupRun.Status.FAILED, error="disk full")
        self.client.force_authenticate(admin)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["backups"]["recent"][0]["error"], "disk full")
        # No successful backup at all counts as "too old".
        self.assertTrue(response.data["backups"]["last_success_too_old"])

    def test_office_workers_are_refused(self):
        office = User.objects.create_user(
            username="office@example.com", email="office@example.com", password="x" * 20,
            role=User.Role.OFFICE, is_staff=True,
        )
        self.client.force_authenticate(office)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)


class ClientErrorTests(APITestCase):
    url = "/api/client-errors/"

    def test_a_report_is_logged_as_an_error(self):
        with self.assertLogs("frontend", level="ERROR") as logs:
            response = self.client.post(
                self.url,
                {"message": "x is not a function", "url": "/booking", "stack": "at Booking.jsx:12"},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIn("x is not a function", logs.output[0])

    def test_an_empty_report_is_dropped_quietly(self):
        response = self.client.post(self.url, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_an_enormous_message_is_cut_short(self):
        with self.assertLogs("frontend", level="ERROR") as logs:
            self.client.post(self.url, {"message": "a" * 10_000}, format="json")
        self.assertLess(len(logs.output[0]), 1000)
