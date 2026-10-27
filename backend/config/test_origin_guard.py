"""Only requests that came through the website reach Django (config/origin_guard.py).

Worth pinning: a direct request is refused once enforcing, the health checks
never are (Railway calls them directly), nothing changes while the secret is
unset, and while not enforcing a missing header is only logged.
"""

from django.test import TestCase, override_settings

from config.checks import check_origin_secret, check_two_factor

SECRET = "s3cret-value-for-tests"


class OriginGuardTests(TestCase):
    def get(self, path, header=None):
        extra = {"HTTP_X_ORIGIN_AUTH": header} if header is not None else {}
        return self.client.get(path, **extra)

    @override_settings(ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=True)
    def test_refuses_a_request_without_the_header(self):
        self.assertEqual(self.get("/api/auth/csrf/").status_code, 403)

    @override_settings(ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=True)
    def test_refuses_a_wrong_value(self):
        self.assertEqual(self.get("/api/auth/csrf/", "guess").status_code, 403)

    @override_settings(ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=True)
    def test_refuses_the_admin_too(self):
        self.assertEqual(self.get("/admin/login/").status_code, 403)

    @override_settings(ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=True)
    def test_answers_a_request_from_the_website(self):
        self.assertEqual(self.get("/api/auth/csrf/", SECRET).status_code, 200)

    @override_settings(ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=True)
    def test_health_checks_are_exempt(self):
        self.assertEqual(self.get("/api/health/").status_code, 200)

    @override_settings(ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=False)
    def test_only_logs_while_not_enforcing(self):
        with self.assertLogs("config.origin_guard", level="WARNING") as logs:
            response = self.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        # The path is logged, never what the caller sent.
        self.assertIn("/api/auth/csrf/", logs.output[0])

    @override_settings(ORIGIN_SECRET="", ORIGIN_SECRET_ENFORCE=True)
    def test_does_nothing_without_a_secret(self):
        self.assertEqual(self.get("/api/auth/csrf/").status_code, 200)


class OriginSecretCheckTests(TestCase):
    """plsm.W008: production says so while direct requests are still answered."""

    def ids(self, **overrides):
        with override_settings(**overrides):
            return [warning.id for warning in check_origin_secret(None)]

    def test_warns_until_enforcing(self):
        self.assertEqual(self.ids(DEBUG=False, ORIGIN_SECRET="", ORIGIN_SECRET_ENFORCE=False), ["plsm.W008"])
        self.assertEqual(self.ids(DEBUG=False, ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=False), ["plsm.W008"])

    def test_silent_once_enforcing(self):
        self.assertEqual(self.ids(DEBUG=False, ORIGIN_SECRET=SECRET, ORIGIN_SECRET_ENFORCE=True), [])


class AdminTwoFactorMinimumCheckTests(TestCase):
    """plsm.W007: production without an admin two-factor minimum says so."""

    def ids(self, **overrides):
        settings = {"DEBUG": False, "TWO_FACTOR_ENCRYPTION_KEYS": ["k"], **overrides}
        with override_settings(**settings):
            return [warning.id for warning in check_two_factor(None)]

    def test_warns_without_a_minimum(self):
        self.assertIn("plsm.W007", self.ids(TWO_FACTOR_MINIMUM_MODE=""))
        self.assertIn("plsm.W007", self.ids(TWO_FACTOR_MINIMUM_MODE="optional"))

    def test_silent_at_required_admins_or_stricter(self):
        self.assertNotIn("plsm.W007", self.ids(TWO_FACTOR_MINIMUM_MODE="required_admins"))
        self.assertNotIn("plsm.W007", self.ids(TWO_FACTOR_MINIMUM_MODE="required_all"))
