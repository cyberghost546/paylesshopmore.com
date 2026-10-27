"""Confirm-your-password before a sensitive admin action ("re-authentication").

READ THIS FIRST
---------------
Some actions hand out power or take it away: changing somebody's role,
deleting an account, resetting a colleague's two-factor, making an API key,
pointing our data at a new webhook address. If a signed-in admin leaves their
computer unlocked, whoever sits down should NOT be able to do those.

So those actions need a RECENT proof that the person at the keyboard is the
account's owner:

    1. The action's view calls require_recent_reauth(request).
    2. Signed in or confirmed in the last REAUTH_WINDOW_MINUTES (10)?
       -> go ahead.
    3. Otherwise -> 403 {"code": "reauth_required", ...}.
       The browser (frontend/src/api/client.js) sees that code, shows the
       "Confirm it's you" box, sends the password (and the authenticator code,
       when the person uses two-factor) to POST /api/auth/reauthenticate/,
       and then repeats the original request by itself.

Signing in counts as confirming (staff_sessions.on_login marks it), so an admin
who has just signed in is not asked twice.

Wrong passwords here count towards the same per-account lockout as the login
form (accounts/lockout.py), so this box cannot be used to guess passwords.
"""

import time

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import APIException

REAUTH_AT_KEY = "reauthenticated_at"


def window_seconds():
    return max(60, settings.REAUTH_WINDOW_MINUTES * 60)


def mark(request):
    """Remember that the owner proved themselves just now (in this session only)."""
    request.session[REAUTH_AT_KEY] = time.time()


def is_recent(request):
    return time.time() - request.session.get(REAUTH_AT_KEY, 0) < window_seconds()


class ReauthenticationRequired(APIException):
    """403 with a code the browser recognises (see the top of this file)."""

    status_code = status.HTTP_403_FORBIDDEN
    default_code = "reauth_required"

    def __init__(self, needs_code):
        super().__init__(
            detail={
                "detail": "Please confirm your password to continue.",
                "code": "reauth_required",
                # True when the authenticator code is asked for as well.
                "needs_code": needs_code,
            }
        )


def require_recent_reauth(request):
    """Call at the top of a sensitive action, AFTER the permission checks
    (so somebody who may not do it at all gets a plain 403, not a password box)."""
    if is_recent(request):
        return
    from . import twofactor

    needs_code = twofactor.available() and twofactor.confirmed_device(request.user) is not None
    raise ReauthenticationRequired(needs_code)
