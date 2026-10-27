"""Four-digit sign-in codes for warehouse workers.

An admin types a worker's e-mail address in the dashboard, the worker is
e-mailed a code, and the code plus their address signs them in. The point is
speed on a busy floor: no password to remember, no reset link to find, a
number a person can read off one screen and tap into another.

A four-digit secret is weak, so this module is mostly about limiting what a
guess can achieve. In order of how much each one matters:

  * A code is only ever issued to a warehouse-only account. Not an office
    worker, an admin, a driver or a customer, and never a superuser - the
    worst thing a guessed code can open is the scanner and the intake sheets,
    which is what a floor account is already limited to.
  * A code is accepted at most MAX_ATTEMPTS times, right or wrong, and is then
    dead. Five tries at ten thousand possibilities is a 0.05% chance per code
    issued. That is the real defence; everything else is secondary.
  * It lasts WAREHOUSE_CODE_MINUTES (15 by default), works once, and issuing a
    new one replaces the old.
  * It is never returned by the API. The admin who asks for it to be sent does
    not learn it - otherwise sending a code would be a way of signing in as the
    worker, and "who signed in" would stop meaning anything.

The cost of the attempt limit is that somebody who knows a worker's address
can burn a live code by guessing wrongly five times. The worker is then told
the code does not work and the admin sends another. That is a nuisance, not a
break-in, and it is the right way round to fail.
"""

import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from .models import User, WarehouseSignInCode

logger = logging.getLogger(__name__)

CODE_LENGTH = 4

# How many guesses a code survives. See the module docstring for the sum.
MAX_ATTEMPTS = 5

# Where a session that began with a code keeps its idle limit, in seconds. The
# profile hands it to the browser, so a floor device can go back to the code
# form the moment the server lets go, rather than showing the last worker's
# name until somebody taps something and is refused.
IDLE_SESSION_KEY = "warehouse_idle_seconds"

# When a person last did something in that session, as time.time(). Requests
# the browser makes on a timer do not move it: see accounts/middleware.py.
LAST_ACTIVE_KEY = "warehouse_last_active"


def idle_seconds():
    """How long a code session may sit idle: WAREHOUSE_SESSION_IDLE_MINUTES, and
    never under a minute - to Django an expiry of 0 means "until the browser
    closes", which is the opposite of what a setting of 0 would intend."""
    return max(60, settings.WAREHOUSE_SESSION_IDLE_MINUTES * 60)


class CodeNotAllowed(Exception):
    """A code cannot be issued to this account. The message says why, in words
    an admin can act on."""


def refusal_reason(user):
    """Why `user` may not be given a sign-in code, or None if they may.

    Checked when a code is issued and again when one is spent, so an account
    whose role is changed in between cannot use a code it was given as
    something else.
    """
    if user.anonymised_at is not None or not user.is_active:
        return "That account is switched off or has been erased, so it cannot sign in."

    # A superuser is always is_staff, which here means Django's own /admin/ -
    # far more than a four-digit code should ever open - so they are refused
    # whatever role label they carry.
    if user.is_superuser:
        return "Superusers sign in with a password, not a code."

    # is_warehouse_worker_only is "is_warehouse and not is_staff", and the role
    # check is on top of it: the role is what the Workers page shows and what
    # an admin means by "a warehouse worker". Both, so neither can drift.
    if user.role != User.Role.WAREHOUSE or not user.is_warehouse_worker_only:
        return (
            f"That account's role is {user.get_role_display()}. Sign-in codes are "
            "only for warehouse workers; everyone else signs in with a password."
        )

    return None


# Mail backends that never reach a real inbox: they print the message, drop
# it, or write it to a file on the server.
_NO_MAILBOX_BACKENDS = ("console", "dummy", "filebased")


def code_goes_on_screen():
    """Whether a new code is shown to the admin who asked for it, instead of
    being e-mailed.

    WAREHOUSE_CODE_ON_SCREEN decides: "1" always, "0" never, and "auto" (the
    default) only while the site has no way to send real mail - a console or
    dummy mail backend, or SMTP with no EMAIL_HOST. Then an e-mail would go
    nowhere, and the floor could not get in at all.

    It weakens the one promise above: an admin who sees a code can sign in as
    that worker. The row records it (shown_on_screen), so the audit trail can
    tell those sign-ins apart. As soon as EMAIL_HOST is set, "auto" goes back
    to e-mail by itself.
    """
    choice = str(settings.WAREHOUSE_CODE_ON_SCREEN).strip().lower()
    if choice in ("1", "true", "yes", "on"):
        return True
    if choice in ("0", "false", "no", "off"):
        return False

    backend = settings.EMAIL_BACKEND.lower()
    if any(name in backend for name in _NO_MAILBOX_BACKENDS):
        return True
    if "smtp" in backend:
        return not settings.EMAIL_HOST
    # Anything else (an API mail service, the test runner's outbox) sends.
    return False


def _digest(user, code):
    """The stored form of a code: HMAC-SHA256 under the site's secret key,
    over the user's id and the code.

    The id is in there so two workers holding the same four digits do not
    share a digest. Rotating SECRET_KEY invalidates every outstanding code,
    which is fine for something that lives fifteen minutes.
    """
    return salted_hmac(
        "accounts.WarehouseSignInCode", f"{user.pk}:{code}", algorithm="sha256"
    ).hexdigest()


def issue_code(user, issued_by, shown_on_screen=False):
    """Make a fresh code for `user`. Returns (row, code).

    `code` is the only copy there will ever be in readable form: it goes into
    the e-mail and nowhere else, so callers must not log it or put it in a
    response.

    Any earlier unused code is deleted in the same transaction, so a worker
    never has two live codes and the one in their inbox is the one that works.
    """
    reason = refusal_reason(user)
    if reason:
        raise CodeNotAllowed(reason)

    # secrets, not random: this is a credential. randbelow is uniform, and the
    # zero-padding means 0042 is as likely as 4821.
    code = f"{secrets.randbelow(10**CODE_LENGTH):0{CODE_LENGTH}d}"
    minutes = settings.WAREHOUSE_CODE_MINUTES

    with transaction.atomic():
        WarehouseSignInCode.objects.filter(user=user, used_at__isnull=True).delete()
        row = WarehouseSignInCode.objects.create(
            user=user,
            issued_by=issued_by,
            code_hash=_digest(user, code),
            shown_on_screen=shown_on_screen,
            expires_at=timezone.now() + timedelta(minutes=minutes),
        )

    return row, code


def redeem_code(email, code):
    """The warehouse worker `code` signs in, or None.

    None for every kind of failure - no such address, not a warehouse account,
    no live code, wrong code, too many guesses - so the caller cannot tell the
    reasons apart and this cannot be used to find out who has an account.

    The attempt is counted *before* the code is compared, in a single UPDATE
    that only succeeds while the code still has attempts left. Counting after
    would let somebody send fifty guesses at once: each request would read "0
    attempts so far", all would be allowed to compare, and the limit would be
    worth nothing. Here the database hands out at most MAX_ATTEMPTS tickets in
    total, however many requests arrive together, and a request without a
    ticket never reaches the comparison.

    A correct code is spent the same way: the UPDATE that sets used_at is
    conditional on it still being unset, so two requests with the right code
    at the same moment cannot both win.
    """
    email = (email or "").strip()
    code = (code or "").strip()
    if not email or len(code) != CODE_LENGTH or not code.isdigit():
        return None

    user = User.objects.filter(email__iexact=email).first()
    if user is None or refusal_reason(user):
        return None

    now = timezone.now()
    live = WarehouseSignInCode.objects.filter(
        user=user, used_at__isnull=True, expires_at__gt=now
    )
    row = live.order_by("-created_at").first()
    if row is None:
        return None

    ticket = live.filter(pk=row.pk, attempts__lt=MAX_ATTEMPTS).update(
        attempts=F("attempts") + 1
    )
    if not ticket:
        return None

    if not constant_time_compare(row.code_hash, _digest(user, code)):
        if row.attempts + 1 >= MAX_ATTEMPTS:
            # Somebody has used up a code's guesses without getting it right.
            # Worth a line in the log: it is either a worker fumbling five
            # times or somebody guessing, and the admin will be asked for
            # another code either way.
            logger.warning(
                "Sign-in code for user %s used up its %s attempts without a match.",
                user.pk,
                MAX_ATTEMPTS,
            )
        return None

    spent = live.filter(pk=row.pk).update(used_at=now)
    return user if spent else None
