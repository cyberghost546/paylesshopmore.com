"""Making a copy of the whole database, and keeping the last few weeks of them.

READ THIS FIRST
---------------
Run by `python manage.py backup_database`, every night, by its own scheduled
Railway service (railway.backup.json). One run, step by step:

    1. Write a BackupRun row with status "running" (ops/models.py).
    2. Dump the database to a file in a temporary folder:
         - Postgres (production): `pg_dump --format=custom`, which is already
           compressed and is what `pg_restore` reads back.
         - SQLite (a developer's computer): a safe copy via SQLite's own
           backup function, then gzipped.
    3. Store the file:
         - in the private S3 bucket (BACKUP_S3_BUCKET), or
         - in BACKUP_DIR on this computer, when no bucket is set (dev only).
    4. Delete old copies: older than BACKUP_KEEP_DAYS, but always keep at
       least the newest BACKUP_KEEP_MIN.
    5. Mark the row "ok" with the size and where it went.

If anything goes wrong, the row is marked "failed" with the reason, the error
is logged (and so reaches Sentry when that is on), the admins get an e-mail,
and the command exits with an error so Railway shows the run as failed.

How to restore a backup is in docs/BACKUPS.md. A backup nobody has ever
restored is only a hope - try it once on a test database.
"""

import gzip
import logging
import os
import shutil
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import connection
from django.db.models import Q
from django.utils import timezone

from .models import BackupRun

logger = logging.getLogger(__name__)


class BackupError(Exception):
    """A problem with the set-up, worded for whoever has to fix it."""


# ------------------------------------------------------------- step 2: dump


def dump_database(folder):
    """Dump the database into `folder`. Returns the path of the file made.

    Example names: db-2026-10-23_030000.dump (Postgres)
                   db-2026-10-23_030000.sqlite3.gz (SQLite)
    """
    stamp = timezone.now().strftime("%Y-%m-%d_%H%M%S")
    database = settings.DATABASES["default"]
    engine = database["ENGINE"]

    if "postgresql" in engine:
        path = Path(folder) / f"db-{stamp}.dump"
        _pg_dump(database, path)
        return path

    if "sqlite3" in engine:
        path = Path(folder) / f"db-{stamp}.sqlite3.gz"
        _sqlite_copy(path)
        return path

    raise BackupError(f"Backing up a {engine} database is not supported.")


def _pg_dump(database, path):
    """Run pg_dump. The password goes in an environment variable, never on
    the command line, where any other process could read it."""
    command = [
        settings.PG_DUMP_PATH,
        "--format=custom",  # compressed; restored with pg_restore
        "--no-owner",  # restore works under a differently named user
        "--no-privileges",
        f"--file={path}",
        f"--host={database.get('HOST') or 'localhost'}",
        f"--port={database.get('PORT') or '5432'}",
        f"--username={database.get('USER', '')}",
        database["NAME"],
    ]
    env = {**os.environ, "PGPASSWORD": database.get("PASSWORD", "")}
    sslmode = database.get("OPTIONS", {}).get("sslmode")
    if sslmode:
        env["PGSSLMODE"] = sslmode

    try:
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=60 * 30)
    except FileNotFoundError:
        raise BackupError(
            f"pg_dump was not found ({settings.PG_DUMP_PATH}). The Dockerfile installs it; "
            "on your own computer install the PostgreSQL client tools, or set PG_DUMP_PATH."
        ) from None

    if result.returncode != 0:
        # pg_dump says what is wrong on stderr, e.g. "server version mismatch".
        raise BackupError(f"pg_dump failed: {result.stderr.strip()[:800]}")


def _sqlite_copy(path):
    """Copy the SQLite database safely (even while the site writes to it), gzipped."""
    connection.ensure_connection()
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as handle:
        plain = handle.name
    try:
        target = sqlite3.connect(plain)
        try:
            connection.connection.backup(target)
        finally:
            target.close()
        with open(plain, "rb") as source, gzip.open(path, "wb") as packed:
            shutil.copyfileobj(source, packed)
    finally:
        os.unlink(plain)


# ------------------------------------------------------- steps 3 and 4: store


class S3Destination:
    """The private backup bucket."""

    def __init__(self):
        if settings.BACKUP_S3_BUCKET == getattr(settings, "AWS_STORAGE_BUCKET_NAME", ""):
            raise BackupError(
                "BACKUP_S3_BUCKET is the same bucket as the public media files "
                "(AWS_STORAGE_BUCKET_NAME). Use a separate, private bucket for backups."
            )
        try:
            import boto3
        except ImportError:
            raise BackupError("boto3 is not installed (it is in requirements-prod.txt).") from None

        self.bucket = settings.BACKUP_S3_BUCKET
        self.prefix = settings.BACKUP_S3_PREFIX
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.BACKUP_S3_ENDPOINT_URL,
            region_name=settings.BACKUP_S3_REGION,
            aws_access_key_id=settings.BACKUP_S3_ACCESS_KEY_ID or None,
            aws_secret_access_key=settings.BACKUP_S3_SECRET_ACCESS_KEY or None,
        )

    def store(self, path):
        key = f"{self.prefix}{path.name}"
        self.client.upload_file(str(path), self.bucket, key)
        return f"s3://{self.bucket}/{key}"

    def existing(self):
        """[(name, modified_at), ...] for every backup in the bucket."""
        found = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self.prefix):
            for item in page.get("Contents", []):
                found.append((item["Key"], item["LastModified"]))
        return found

    def delete(self, name):
        self.client.delete_object(Bucket=self.bucket, Key=name)


class FolderDestination:
    """A folder on this computer. For development only (see BACKUP_DIR)."""

    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)

    def store(self, path):
        target = self.folder / path.name
        shutil.copy2(path, target)
        return str(target)

    def existing(self):
        found = []
        for item in self.folder.glob("db-*"):
            modified = datetime.fromtimestamp(item.stat().st_mtime, tz=timezone.get_current_timezone())
            found.append((str(item), modified))
        return found

    def delete(self, name):
        Path(name).unlink(missing_ok=True)


def destination():
    """Where backups go, from the settings. Raises BackupError when nowhere."""
    if settings.BACKUP_S3_BUCKET:
        return S3Destination()
    if settings.BACKUP_DIR:
        return FolderDestination(settings.BACKUP_DIR)
    raise BackupError(
        "No backup destination is set. Set BACKUP_S3_BUCKET (and its keys) - see docs/BACKUPS.md."
    )


def old_backups(existing, now, keep_days, keep_min):
    """Which backups to delete. Pure function, so it is easy to test.

    Rule: newest first, the first `keep_min` are always kept; of the rest,
    the ones older than `keep_days` days go.

    Example with keep_min=2, keep_days=30, today = 31 Oct:
        30 Oct, 29 Oct            -> kept (the newest two)
        15 Oct                    -> kept (younger than 30 days)
        20 Sep, 1 Sep             -> deleted
    """
    newest_first = sorted(existing, key=lambda item: item[1], reverse=True)
    cutoff = now - timedelta(days=keep_days)
    return [name for name, modified in newest_first[keep_min:] if modified < cutoff]


# ------------------------------------------------------------- the whole run


def admin_addresses():
    """The admins' e-mail addresses, for a failure warning."""
    User = get_user_model()
    return sorted(
        set(
            User.objects.filter(is_active=True)
            .filter(Q(is_superuser=True) | Q(role=User.Role.ADMIN))
            .exclude(email="")
            .values_list("email", flat=True)
        )
    )


def _warn_admins(run):
    addresses = admin_addresses()
    if not addresses:
        return
    try:
        send_mail(
            subject="Database backup FAILED",
            message=(
                "Tonight's database backup did not work.\n\n"
                f"Started: {timezone.localtime(run.started_at):%Y-%m-%d %H:%M}\n"
                f"Reason: {run.error}\n\n"
                "The dashboard's System page shows the recent backups. "
                "docs/BACKUPS.md explains the set-up."
            ),
            from_email=None,
            recipient_list=addresses,
        )
    except Exception:  # noqa: BLE001 - the failure itself is already logged
        logger.exception("Could not e-mail the admins about the failed backup.")


def run_backup():
    """Steps 1 to 5 from the top of this file. Returns the BackupRun row."""
    run = BackupRun.objects.create()  # step 1: status "running"

    try:
        target = destination()
        with tempfile.TemporaryDirectory() as folder:
            path = dump_database(folder)  # step 2
            run.size_bytes = path.stat().st_size
            run.location = target.store(path)  # step 3

        # Step 4. Only after a new copy is safely stored.
        for name in old_backups(
            target.existing(), timezone.now(), settings.BACKUP_KEEP_DAYS, settings.BACKUP_KEEP_MIN
        ):
            target.delete(name)
            run.pruned += 1

        run.status = BackupRun.Status.OK  # step 5
    except Exception as error:  # noqa: BLE001 - every failure must be recorded
        logger.exception("Database backup failed.")
        run.status = BackupRun.Status.FAILED
        run.error = str(error)[:2000] or error.__class__.__name__

    run.finished_at = timezone.now()
    run.save()

    if run.status == BackupRun.Status.FAILED:
        _warn_admins(run)
    return run
