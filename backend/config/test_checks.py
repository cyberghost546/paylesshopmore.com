"""The startup checks in config/checks.py that need a database to run."""

from django.test import TestCase, override_settings

from config.checks import check_two_factor


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
