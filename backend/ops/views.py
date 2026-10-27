"""Two small endpoints that help keep the site healthy.

1. GET /api/staff/system/  (admins only)
   What the dashboard's "System" page shows: did the backups work, is error
   monitoring on, can the site send e-mail. So an admin can check the safety
   nets without opening DigitalOcean, Sentry or the storage bucket.

2. POST /api/client-errors/  (anyone, rate-limited)
   Where the React app reports a JavaScript error that happened in a
   visitor's browser (frontend src/utils/errorReporting.js). Without this, a
   page that crashes for customers is invisible to us - the error only ever
   lived in their browser.

   We do not store these. They are written to the log at ERROR level under
   the logger name "frontend". The log goes to DigitalOcean's runtime logs, and - when Sentry is
   on (SENTRY_DSN) - Sentry turns every ERROR log line into an issue, so
   browser errors land in the same place as server errors.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from staff.permissions import IsAdmin

from .models import BackupRun

frontend_logger = logging.getLogger("frontend")

# A backup older than this counts as "too old" on the System page: the job
# runs every night, so more than a day and a half means a night was missed.
BACKUP_TOO_OLD = timedelta(hours=36)


def email_ready():
    """True when the site sends real e-mail, not just prints it to the console."""
    backend = settings.EMAIL_BACKEND
    if any(word in backend for word in ("console", "locmem", "dummy", "filebased")):
        return False
    # The SMTP backend also needs a server to talk to.
    if "smtp" in backend:
        return bool(settings.EMAIL_HOST)
    return True


def backup_destination():
    """'bucket' (the real thing), 'folder' (a developer's computer) or 'none'."""
    if settings.BACKUP_S3_BUCKET:
        return "bucket"
    if settings.BACKUP_DIR:
        return "folder"
    return "none"


class SystemStatusView(APIView):
    """GET /api/staff/system/ - see the module docstring."""

    permission_classes = [IsAdmin]

    def get(self, request):
        runs = list(BackupRun.objects.all()[:10])
        last_ok = BackupRun.objects.filter(status=BackupRun.Status.OK).first()
        too_old = (
            last_ok is None
            or last_ok.finished_at is None
            or timezone.now() - last_ok.finished_at > BACKUP_TOO_OLD
        )

        return Response(
            {
                "backups": {
                    "destination": backup_destination(),
                    "keep_days": settings.BACKUP_KEEP_DAYS,
                    "last_success_at": last_ok.finished_at if last_ok else None,
                    "last_success_too_old": too_old,
                    "recent": [
                        {
                            "id": run.id,
                            "started_at": run.started_at,
                            "finished_at": run.finished_at,
                            "status": run.status,
                            "size_bytes": run.size_bytes,
                            "pruned": run.pruned,
                            "error": run.error,
                        }
                        for run in runs
                    ],
                },
                # Sentry for the server, and - through the "frontend" log, see
                # ClientErrorView - for errors in visitors' browsers as well.
                "error_monitoring": {"sentry": bool(getattr(settings, "SENTRY_DSN", ""))},
                "email": {"ready": email_ready()},
            }
        )


class ClientErrorThrottle(ScopedRateThrottle):
    """Per visitor (IP address; reports are never signed in, see below). The
    rate is 'client_errors' in settings.REST_FRAMEWORK - a page crashing in a
    loop must not flood the log or use up the Sentry quota."""


class ClientErrorView(APIView):
    """POST /api/client-errors/ - see the module docstring.

    Body (every field optional, each cut to a sane length):
        {"message": "...", "stack": "...", "url": "...", "source": "boundary"}

    Answers 204 (nothing to say back). Never 4xx for bad input: the browser
    cannot do anything about it, so a malformed report is simply dropped.
    """

    permission_classes = [AllowAny]
    # No session authentication, so no CSRF check: this changes nothing on the
    # server, and a report from a page whose session just expired must still
    # arrive. It also means a report is never tied to who was signed in.
    authentication_classes = []
    throttle_classes = [ClientErrorThrottle]
    throttle_scope = "client_errors"

    LIMITS = {"message": 500, "stack": 4000, "url": 500, "source": 40}

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        fields = {name: str(data.get(name, ""))[:limit] for name, limit in self.LIMITS.items()}
        fields["user_agent"] = request.META.get("HTTP_USER_AGENT", "")[:300]

        if fields["message"]:
            # One line in the log; the details go in `extra`, which Sentry
            # shows next to the issue.
            frontend_logger.error(
                "Browser error: %s (%s)",
                fields["message"],
                fields["url"] or "unknown page",
                extra={"browser": fields},
            )

        return Response(status=status.HTTP_204_NO_CONTENT)
