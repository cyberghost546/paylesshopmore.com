"""Django's /admin/ login, with the same per-account ceiling as the API's.

The admin login is a plain Django view, so none of the DRF throttles reach
it, and it signs in exactly the accounts most worth guessing at. Failures are
counted with accounts/lockout.py, against the same budget as /api/auth/login/.
"""

from functools import wraps

from django.http import HttpResponse

from accounts import lockout


def throttled_admin_login(login_view):
    @wraps(login_view)
    def view(request, *args, **kwargs):
        if request.method != "POST":
            return login_view(request, *args, **kwargs)

        failures = lockout.account_key(request.POST.get("username", ""))
        if lockout.is_locked(failures, request):
            return HttpResponse(
                "Too many failed sign-ins for this account. Try again later.",
                status=429,
                content_type="text/plain; charset=utf-8",
            )

        response = login_view(request, *args, **kwargs)
        # A successful sign-in redirects; a failed one renders the form again.
        if not 300 <= response.status_code < 400:
            lockout.record_failure(failures, request)
        return response

    return view
