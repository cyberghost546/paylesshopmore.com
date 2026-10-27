"""Only answer requests that came through the website (Vercel).

WHY THIS EXISTS
Vercel passes /api/ and /admin/ on to this backend on Railway. The Railway
address can be called directly too, and a direct caller can send any
X-Vercel-Forwarded-For it likes - the header config/client_ip.py reads as the
visitor's address for every rate limit and the admin allow-list. So a direct
caller could pretend to be a new visitor on every request, or pretend to be the
office.

HOW
middleware.js (at the repository root, run by Vercel) adds X-Origin-Auth with
a shared secret to every request it forwards. This middleware refuses a request
without the right value, so only Vercel can reach Django and only Vercel's
X-Vercel-Forwarded-For is ever read.

TURNING IT ON, SAFELY (the order matters - the wrong order takes the site down)
    1. Vercel: set ORIGIN_SHARED_SECRET (a long random value) and redeploy.
    2. Railway: set DJANGO_ORIGIN_SECRET to the same value, and leave
       DJANGO_ORIGIN_SECRET_ENFORCE unset. Requests without the header are
       still answered, but logged as a warning ("arrived without...").
    3. Use the site for a while. If the log shows no such warning for requests
       through the site, set DJANGO_ORIGIN_SECRET_ENFORCE=1. From then on a
       direct request gets 403.

Unset DJANGO_ORIGIN_SECRET (the default, and in local development): does
nothing at all.

The health checks are exempt, because Railway calls them directly.
"""

import hmac
import logging

from django.conf import settings
from django.http import HttpResponseForbidden

logger = logging.getLogger(__name__)

HEADER = "HTTP_X_ORIGIN_AUTH"

# Railway's own health checks, and the admin's CSS and JavaScript (public
# files anyway, and Vercel passes /static/ on without the middleware).
EXEMPT_PREFIXES = ("/api/health/", "/api/ready/", "/static/")


class OriginSecretMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        secret = getattr(settings, "ORIGIN_SECRET", "")
        if secret and not request.path.startswith(EXEMPT_PREFIXES):
            sent = request.META.get(HEADER, "")
            # compare_digest: the time taken does not say how much matched.
            if not hmac.compare_digest(sent.encode(), secret.encode()):
                if getattr(settings, "ORIGIN_SECRET_ENFORCE", False):
                    return HttpResponseForbidden("Forbidden")
                # Not enforcing yet: say so, so the rollout can be checked.
                # The path only - never the header's value.
                logger.warning(
                    "Request to %s arrived without the right X-Origin-Auth header "
                    "(not refused: DJANGO_ORIGIN_SECRET_ENFORCE is off).",
                    request.path,
                )
        return self.get_response(request)
