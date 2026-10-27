"""Telling Sentry that a scheduled job ran ("cron monitoring").

READ THIS FIRST: an error report only arrives when something *runs* and
fails. If the nightly backup service is switched off by accident, nothing
runs, nothing fails, and nobody hears anything. Sentry's cron monitors catch
exactly that: the job checks in when it starts and when it ends, and Sentry
e-mails you when an expected check-in does not come.

    check_in("database-backup", "in_progress")   # at the start
    check_in("database-backup", "ok", check_id)  # at the end (or "error")

Does nothing at all when Sentry is not set up (no SENTRY_DSN) - the job must
work the same with or without it.
"""

import logging

from django.conf import settings

logger = logging.getLogger(__name__)


def check_in(slug, status, check_in_id=None, schedule=None):
    """Send one check-in. Returns its id (pass it to the closing check-in), or None."""
    if not getattr(settings, "SENTRY_DSN", ""):
        return None
    try:
        from sentry_sdk.crons import capture_checkin
    except ImportError:
        return None

    config = None
    if schedule:
        # Creates (or updates) the monitor in Sentry, so nothing has to be
        # clicked together there by hand.
        config = {
            "schedule": {"type": "crontab", "value": schedule},
            "timezone": "UTC",
            # Minutes late before Sentry calls the run "missed".
            "checkin_margin": 60,
            # Minutes a run may take before Sentry calls it "timed out".
            "max_runtime": 60,
        }
    try:
        return capture_checkin(
            monitor_slug=slug, check_in_id=check_in_id, status=status, monitor_config=config
        )
    except Exception:  # noqa: BLE001 - monitoring must never break the job itself
        logger.warning("Could not send a check-in to Sentry.", exc_info=True)
        return None
