"""The visitor's address comes from Vercel's header when one is configured.

See config/client_ip.py for why.
"""

from django.conf import settings
from django.test import RequestFactory, SimpleTestCase, override_settings
from rest_framework.throttling import BaseThrottle

from config.client_ip import TrustedClientIPMiddleware

# What a request through the live site looked like on 2026-10-19.
LIVE_HEADERS = {
    "HTTP_X_FORWARDED_FOR": "3.75.83.123, 152.233.29.5",
    "HTTP_X_VERCEL_FORWARDED_FOR": "81.172.243.77",
}


def run(**meta):
    """Pass a request through the middleware and return what it left behind."""
    request = RequestFactory().get("/api/anything/", **meta)
    TrustedClientIPMiddleware(lambda r: None)(request)
    return request


@override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
class TrustedClientIPTests(SimpleTestCase):
    @override_settings(CLIENT_IP_HEADER="X-Vercel-Forwarded-For")
    def test_throttles_see_the_real_visitor(self):
        request = run(**LIVE_HEADERS)
        self.assertEqual(request.META["HTTP_X_FORWARDED_FOR"], "81.172.243.77")
        self.assertEqual(BaseThrottle().get_ident(request), "81.172.243.77")

    @override_settings(CLIENT_IP_HEADER="")
    def test_off_by_default(self):
        request = run(**LIVE_HEADERS)
        self.assertEqual(request.META["HTTP_X_FORWARDED_FOR"], "3.75.83.123, 152.233.29.5")

    @override_settings(CLIENT_IP_HEADER="X-Vercel-Forwarded-For")
    def test_header_missing_leaves_the_request_alone(self):
        request = run(HTTP_X_FORWARDED_FOR="3.75.83.123, 152.233.29.5")
        self.assertEqual(request.META["HTTP_X_FORWARDED_FOR"], "3.75.83.123, 152.233.29.5")

    @override_settings(CLIENT_IP_HEADER="X-Vercel-Forwarded-For")
    def test_garbage_is_ignored(self):
        request = run(HTTP_X_FORWARDED_FOR="10.0.0.1", HTTP_X_VERCEL_FORWARDED_FOR="not-an-ip")
        self.assertEqual(request.META["HTTP_X_FORWARDED_FOR"], "10.0.0.1")

    @override_settings(CLIENT_IP_HEADER="X-Vercel-Forwarded-For")
    def test_only_the_first_entry_counts(self):
        request = run(HTTP_X_VERCEL_FORWARDED_FOR="2001:db8::1, 10.0.0.1")
        self.assertEqual(request.META["HTTP_X_FORWARDED_FOR"], "2001:db8::1")
