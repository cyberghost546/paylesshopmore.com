"""What happens to a session when somebody signs in.

Connected in accounts/apps.py to Django's user_logged_in signal, so it runs for
EVERY way of signing in - the website's login, Django's /admin/ login form, a
warehouse code - without each of them having to remember it.

Two things:

1. Two-factor starts over. A new sign-in is never "already verified", even in
   a browser that was verified before (accounts/twofactor.py).

2. Admins and office staff get an idle timeout. Their session ends after
   STAFF_SESSION_IDLE_MINUTES (60 by default) with nobody doing anything,
   instead of lasting two weeks. It reuses the warehouse's idle machinery
   (accounts/middleware.py WarehouseIdleMiddleware, and the browser's
   countdown in AuthContext.jsx), which only looks at IDLE_SESSION_KEY and
   so works for any session that has it.
"""

import time

from django.conf import settings

from . import reauth
from .signin_codes import IDLE_SESSION_KEY, LAST_ACTIVE_KEY
from .twofactor import VERIFIED_KEY


def staff_idle_seconds():
    """STAFF_SESSION_IDLE_MINUTES in seconds, never under five minutes."""
    return max(5 * 60, settings.STAFF_SESSION_IDLE_MINUTES * 60)


def start_staff_session(request):
    """Give this (staff) session the short, sliding idle timeout."""
    seconds = staff_idle_seconds()
    request.session.set_expiry(seconds)
    request.session[IDLE_SESSION_KEY] = seconds
    request.session[LAST_ACTIVE_KEY] = time.time()


def on_login(sender, request, user, **kwargs):
    """The user_logged_in receiver. `request` is None for logins made outside
    a request (some tests), and then there is no session to change."""
    if request is None or not hasattr(request, "session"):
        return
    request.session.pop(VERIFIED_KEY, None)
    # A password typed just now counts as confirming it is them, for the
    # sensitive actions that ask again (accounts/reauth.py).
    reauth.mark(request)
    if user.is_staff or user.is_superuser:
        start_staff_session(request)
