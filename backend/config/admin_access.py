"""Optionally keep Django's /admin/ to a few IP addresses (e.g. the office).

OFF until you switch it on. On the api component set, for example:

    DJANGO_ADMIN_ALLOWED_IPS=203.0.113.7,198.51.100.0/24

(single addresses or ranges, separated by commas). Then /admin/ answers
"Not found" to everybody else - as if it did not exist, so it is not even
worth attacking from outside.

IMPORTANT: this needs DJANGO_NUM_PROXIES to be set as well. Behind the hosting
edge, the visitor's real address is in the X-Forwarded-For header, and only
NUM_PROXIES says which part of that header our own proxies wrote (the rest is
whatever the visitor typed). Without it this middleware cannot know the real
address, so it refuses everyone rather than guess - and a startup check
(config/checks.py) says so in the deploy log.

The dashboard and the API are not affected; they are protected by sign-in.
"""

import ipaddress
import logging

from django.conf import settings
from django.http import Http404

logger = logging.getLogger(__name__)


def allowed_networks():
    """DJANGO_ADMIN_ALLOWED_IPS as a list of networks; empty = feature off."""
    networks = []
    for item in settings.ADMIN_ALLOWED_IPS:
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.error("DJANGO_ADMIN_ALLOWED_IPS has an entry that is not an IP address: %r", item)
    return networks


def client_ip(request):
    """The visitor's real address, or None when it cannot be known safely.

    Example with NUM_PROXIES = 2 and
        X-Forwarded-For: 6.6.6.6, 203.0.113.7, 76.76.21.21
    the last 2 entries were written by our proxies, so the visitor is the one
    2 from the end: 203.0.113.7. "6.6.6.6" could be anything the visitor sent.
    """
    num_proxies = settings.REST_FRAMEWORK.get("NUM_PROXIES")
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if num_proxies:
        addresses = [part.strip() for part in forwarded.split(",") if part.strip()]
        if len(addresses) < num_proxies:
            return None
        return addresses[-num_proxies]
    if num_proxies == 0:
        return request.META.get("REMOTE_ADDR")
    return None  # NUM_PROXIES unset: the header cannot be trusted


class AdminIpAllowListMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/admin"):
            networks = allowed_networks()
            if networks:
                address = client_ip(request)
                try:
                    ip = ipaddress.ip_address(address) if address else None
                except ValueError:
                    ip = None
                if ip is None or not any(ip in network for network in networks):
                    raise Http404()
        return self.get_response(request)
