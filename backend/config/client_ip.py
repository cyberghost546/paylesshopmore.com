"""Use the visitor's real address, as Vercel reports it, for the rate limits.

WHY THIS EXISTS
The site runs behind two proxies: the visitor talks to Vercel, Vercel passes
/api/ on to Railway, and Railway passes it to Django. What reaches Django looks
like this (measured on the live site, 2026-10-19):

    X-Forwarded-For:        3.75.83.123, 152.233.29.5   <- Vercel's server, Railway's edge
    X-Vercel-Forwarded-For: 81.172.243.77               <- the actual visitor

The visitor's address is not in X-Forwarded-For at all. So no value of
DJANGO_NUM_PROXIES picks it out: every number gives either Vercel's or
Railway's address, which is the SAME for many visitors at once. Every visitor
would then share one login / password-reset / form limit, and one busy
visitor would lock out the rest.

WHAT IT DOES
When DJANGO_CLIENT_IP_HEADER names a header (on Railway:
X-Vercel-Forwarded-For), this middleware reads the visitor's address from it
and puts that single address into X-Forwarded-For before anything else looks.
With DJANGO_NUM_PROXIES=1, Django REST framework's throttles and the admin
allow-list (config/admin_access.py) then all see the real visitor.

WHAT IT DOES NOT PROTECT AGAINST
Vercel sets this header itself, so a visitor going through the site cannot
fake it. Someone calling the Railway address directly can send any value they
like, though - exactly like X-Forwarded-For today. For that case the
site-wide ceilings in config/abuse.py and the per-account lockout in
accounts/lockout.py still apply, because they do not look at an address.

Unset (the default, and in local development) this does nothing.
"""

import ipaddress

from django.conf import settings


def _meta_key(header_name):
    """'X-Vercel-Forwarded-For' -> 'HTTP_X_VERCEL_FORWARDED_FOR' (how Django stores it)."""
    return "HTTP_" + header_name.strip().upper().replace("-", "_")


def _first_valid_address(value):
    """The first entry of a comma-separated header, if it is a real IP address.

    Anything else (empty, a hostname, garbage) gives None, so a broken header
    is ignored instead of becoming a "address" that throttles can key on.
    """
    first = value.split(",")[0].strip()
    try:
        return str(ipaddress.ip_address(first))
    except ValueError:
        return None


class TrustedClientIPMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        header = getattr(settings, "CLIENT_IP_HEADER", "")
        if header:
            address = _first_valid_address(request.META.get(_meta_key(header), ""))
            if address:
                # One entry only, so NUM_PROXIES=1 selects exactly this one.
                request.META["HTTP_X_FORWARDED_FOR"] = address
        return self.get_response(request)
