"""Re-authentication before sensitive admin actions, Argon2id password
hashing, and the API's Content-Security-Policy header."""

import time
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from config.testing import ThrottleFreeAPITestCase

from . import reauth

User = get_user_model()
PASSWORD = "a-long-enough-password"


def make_account(email, role=User.Role.CUSTOMER):
    return User.objects.create_user(
        username=email, email=email, password=PASSWORD,
        first_name="Test", last_name="User", phone_number="+599 9 000 0000", role=role,
    )


class ReauthTests(ThrottleFreeAPITestCase):
    client_class = APIClient  # a real sign-in

    def setUp(self):
        super().setUp()
        self.admin = make_account("baas@example.com", User.Role.ADMIN)
        self.worker = make_account("wim@example.com", User.Role.WAREHOUSE)
        self.client.post(reverse("login"), {"username": "baas@example.com", "password": PASSWORD}, format="json")
        self.role_url = f"/api/staff/customers/{self.worker.pk}/role/"

    def later(self):
        """A clock past the re-authentication window."""
        return patch("accounts.reauth.time.time", return_value=time.time() + reauth.window_seconds() + 5)

    def test_just_signed_in_counts_as_confirmed(self):
        response = self.client.post(self.role_url, {"role": "driver"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_later_a_sensitive_action_asks_again(self):
        with self.later():
            response = self.client.post(self.role_url, {"role": "driver"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "reauth_required")
        self.worker.refresh_from_db()
        self.assertEqual(self.worker.role, User.Role.WAREHOUSE)

    def test_confirming_the_password_opens_the_window_again(self):
        with self.later():
            wrong = self.client.post("/api/auth/reauthenticate/", {"password": "nope"}, format="json")
            self.assertEqual(wrong.status_code, 400)
        later = time.time() + reauth.window_seconds() + 5
        with patch("accounts.reauth.time.time", return_value=later):
            ok = self.client.post("/api/auth/reauthenticate/", {"password": PASSWORD}, format="json")
            self.assertEqual(ok.status_code, 200)
            response = self.client.post(self.role_url, {"role": "driver"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_wrong_passwords_share_the_login_lockout(self):
        with override_settings(LOGIN_FAILURE_LIMIT=3):
            for _ in range(3):
                self.client.post("/api/auth/reauthenticate/", {"password": "nope"}, format="json")
            locked = self.client.post("/api/auth/reauthenticate/", {"password": PASSWORD}, format="json")
        self.assertEqual(locked.status_code, 429)

    def test_somebody_without_permission_gets_a_plain_refusal(self):
        office = APIClient()
        make_account("kantoor@example.com", User.Role.OFFICE)
        office.post(reverse("login"), {"username": "kantoor@example.com", "password": PASSWORD}, format="json")
        with self.later():
            response = office.post(self.role_url, {"role": "driver"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertNotEqual(response.data.get("code"), "reauth_required")

    def test_creating_an_api_key_asks_too(self):
        with self.later():
            response = self.client.post("/api/staff/integrations/keys/", {"name": "X", "scopes": ["invoices:read"]},
                                        format="json")
        self.assertEqual(response.data["code"], "reauth_required")


class PasswordHashTests(ThrottleFreeAPITestCase):
    client_class = APIClient

    @override_settings(PASSWORD_HASHERS=[
        "django.contrib.auth.hashers.Argon2PasswordHasher",
        "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    ])
    def test_an_old_pbkdf2_password_still_works_and_becomes_argon2id(self):
        user = make_account("klant@example.com")
        user.password = make_password(PASSWORD, hasher="pbkdf2_sha256")
        user.save(update_fields=["password"])

        response = self.client.post(reverse("login"), {"username": "klant@example.com", "password": PASSWORD},
                                    format="json")
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.password.startswith("argon2$argon2id$"))


class ApiCspTests(ThrottleFreeAPITestCase):
    def test_json_answers_load_nothing_and_cannot_be_framed(self):
        response = self.client.get("/api/stats/")
        self.assertEqual(response["Content-Security-Policy"], "default-src 'none'; frame-ancestors 'none'")
