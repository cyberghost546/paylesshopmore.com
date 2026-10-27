"""The idle timeout for warehouse code sessions, counted from what a person did.

A code sign-in is on a shared floor device, and ends after
WAREHOUSE_SESSION_IDLE_MINUTES with nobody using it (see signin_codes). The
session's own expiry slides on every request, which is not the same thing:
the warehouse home page refreshes its board every minute by itself, so a phone
left on it was never idle as far as the session could tell, and stayed signed
in as whoever had it last for as long as the screen stayed on.

So the time of the last request a person caused is kept in the session, and
this ends the session once that is too long ago. The browser marks the
requests it makes on a timer with BACKGROUND_HEADER; they are answered as
normal but do not count as somebody working.

The header is the browser's word for it, and a client could leave it off to
keep a session alive. That is no different from tapping the screen: this is
about a forgotten log-out, not about somebody trying to stay signed in.
"""

import time

from django.contrib.auth import logout
from django.http import HttpResponseForbidden, JsonResponse

from .signin_codes import IDLE_SESSION_KEY, LAST_ACTIVE_KEY

# X-Background-Refresh: 1, as Django spells it in request.META.
BACKGROUND_HEADER = "HTTP_X_BACKGROUND_REFRESH"


class WarehouseIdleMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        session = request.session
        limit = session.get(IDLE_SESSION_KEY)

        if limit:
            now = time.time()
            if now - session.get(LAST_ACTIVE_KEY, now) >= limit:
                # Flushes the session and makes this request anonymous, so the
                # view refuses it like any other signed-out request.
                logout(request)
            elif request.META.get(BACKGROUND_HEADER) != "1":
                session[LAST_ACTIVE_KEY] = now

        return self.get_response(request)



# ---- two-factor ------------------------------------------------------------------

# What a session that still owes its authenticator code may do: (method, path
# prefix). None = any method. Everything else answers 403 until the code is in.
# See accounts/twofactor.py for the whole flow.
TWO_FACTOR_ALLOWED = (
    (None, "/api/auth/2fa/"),         # setting up and typing the code
    (None, "/api/auth/logout/"),
    (None, "/api/auth/csrf/"),
    ("POST", "/api/auth/login/"),    # signing in again, perhaps as somebody else
    ("GET", "/api/profile/"),        # so the browser can learn what to ask for
    (None, "/api/health/"),
    (None, "/api/ready/"),
    (None, "/admin/login/"),          # Django admin's own sign-in and sign-out
    (None, "/admin/logout/"),
    (None, "/static/"),
)


def _two_factor_allows(request):
    return any(
        request.path.startswith(prefix) and (method is None or request.method == method)
        for method, prefix in TWO_FACTOR_ALLOWED
    )


class TwoFactorMiddleware:
    """Refuse a session that signed in with a password but still owes its
    authenticator code (or still has to set the app up, when it is required).

    The ONE place two-factor is enforced, for the dashboard API and Django's
    /admin/ alike. While the admin's policy is "disabled" it does nothing at
    all, so signing in works exactly as it always did.

    Only Django sessions are checked. An integration's API key is never a
    person (integrations/authentication.py), and DRF's test-only
    force_authenticate does not pass through here.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from .twofactor import must_finish, state

        user = getattr(request, "user", None)
        if (
            user is not None
            and user.is_authenticated
            and not _two_factor_allows(request)
            and must_finish(request)
        ):
            if request.path.startswith("/admin/"):
                return HttpResponseForbidden(
                    "<h1>Two-factor sign-in needed</h1>"
                    "<p>Open the website, sign in and enter the code from your "
                    "authenticator app. Then come back to this page.</p>"
                )
            return JsonResponse(
                {
                    "detail": "Enter the code from your authenticator app first.",
                    "code": "two_factor_required",
                    "two_factor": state(request),
                },
                status=403,
            )
        return self.get_response(request)
