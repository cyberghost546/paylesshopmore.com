"""Use the visitor's real address, as the hosting edge reports it, for the rate limits.

WHY THIS EXISTS
The site runs behind a proxy: the visitor talks to DigitalOcean's edge, and
the edge passes /api/ on to Django. X-Forwarded-For can then hold the edge's
own addresses rather than (or as well as) the visitor's, and those are the
SAME for many visitors at once. Every visitor would share one login /
password-reset / form limit, and one busy visitor would lock out the rest.

WHAT IT DOES
When DJANGO_CLIENT_IP_HEADER names a header (on DigitalOcean App Platform:
Do-Connecting-Ip), this middleware reads the visitor's address from it and
puts that single address into X-Forwarded-For before anything else looks.
With DJANGO_NUM_PROXIES=1, Django REST framework's throttles and the admin
allow-list (config/admin_access.py) then all see the real visitor.

WHAT IT DOES NOT PROTECT AGAINST
The edge sets this header itself, and on App Platform the container is only
reachable through the edge, so a visitor cannot fake it. The site-wide
ceilings in config/abuse.py and the per-account lockout in accounts/lockout.py
apply regardless, because they do not look at an address.

Unset (the default, and in local development) this does nothing.
"""

import ipaddress

from django.conf import settings


def _meta_key(header_name):
    """'Do-Connecting-Ip' -> 'HTTP_DO_CONNECTING_IP' (how Django stores it)."""
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
