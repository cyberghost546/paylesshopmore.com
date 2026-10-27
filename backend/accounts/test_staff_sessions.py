"""The staff idle timeout (accounts/staff_sessions.py) and the optional /admin/
IP allow-list (config/admin_access.py)."""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from config.testing import ThrottleFreeAPITestCase

User = get_user_model()
PASSWORD = "a-long-enough-password"


def make_account(email, role):
    return User.objects.create_user(
        username=email, email=email, password=PASSWORD,
        first_name="Test", last_name="User", phone_number="+599 9 000 0000", role=role,
    )


class StaffIdleSessionTests(ThrottleFreeAPITestCase):
    client_class = APIClient

    @override_settings(STAFF_SESSION_IDLE_MINUTES=60)
    def test_staff_sessions_end_after_an_hour_idle_customers_do_not(self):
        make_account("kantoor@example.com", User.Role.OFFICE)
        make_account("klant@example.com", User.Role.CUSTOMER)

        self.client.post(reverse("login"), {"username": "kantoor@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(self.client.get("/api/profile/").data["session_idle_seconds"], 3600)

        self.client.post(reverse("logout"))
        self.client.post(reverse("login"), {"username": "klant@example.com", "password": PASSWORD}, format="json")
        self.assertIsNone(self.client.get("/api/profile/").data["session_idle_seconds"])


class AdminIpAllowListTests(ThrottleFreeAPITestCase):
    def rest(self, num_proxies):
        return {**settings.REST_FRAMEWORK, "NUM_PROXIES": num_proxies}

    def test_off_by_default(self):
        self.assertEqual(Client().get("/admin/login/").status_code, 200)

    def test_only_listed_addresses_reach_admin(self):
        with override_settings(ADMIN_ALLOWED_IPS=["203.0.113.0/24"], REST_FRAMEWORK=self.rest(1)):
            allowed = Client(HTTP_X_FORWARDED_FOR="203.0.113.7").get("/admin/login/")
            # The visitor typed a listed address in front; our proxy's entry is last.
            spoofed = Client(HTTP_X_FORWARDED_FOR="203.0.113.7, 198.51.100.9").get("/admin/login/")
            self.assertEqual(allowed.status_code, 200)
            self.assertEqual(spoofed.status_code, 404)

    def test_without_num_proxies_it_refuses_rather_than_guess(self):
        with override_settings(ADMIN_ALLOWED_IPS=["203.0.113.7"], REST_FRAMEWORK=self.rest(None)):
            self.assertEqual(Client(HTTP_X_FORWARDED_FOR="203.0.113.7").get("/admin/login/").status_code, 404)
