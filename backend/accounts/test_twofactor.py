"""Admin-controlled two-factor sign-in: every mode, the codes, recovery, the
admin's settings, lockout protection, and the encryption of the secrets.

The flow under test is described in accounts/twofactor.py.
"""

import base64
import time
from io import StringIO
from unittest.mock import patch

from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, RequestFactory, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from config.testing import ThrottleFreeAPITestCase

from . import twofactor, twofactor_crypto
from .floor import WAREHOUSE_UNLOCKED_KEY
from .models import TwoFactorAuditEvent, TwoFactorDevice, TwoFactorPolicy, TwoFactorRecoveryCode

User = get_user_model()
PASSWORD = "a-long-enough-password"
Mode = TwoFactorPolicy.Mode


def make_account(email, role=User.Role.CUSTOMER):
    return User.objects.create_user(
        username=email, email=email, password=PASSWORD,
        first_name="Test", last_name="User", phone_number="+599 9 000 0000", role=role,
    )


def set_mode(mode):
    TwoFactorPolicy(mode=mode).save()
    cache.delete(twofactor.POLICY_CACHE_KEY)


def secret_of(user):
    return twofactor_crypto.decrypt(TwoFactorDevice.objects.get(user=user).secret_encrypted)


def code_for(user, steps_ahead=0):
    return twofactor.code_at(secret_of(user), twofactor.current_step() + steps_ahead)


class TwoFactorTestCase(ThrottleFreeAPITestCase):
    client_class = APIClient  # real sign-ins, nothing skipped

    def setUp(self):
        super().setUp()
        self.admin = make_account("baas@example.com", User.Role.ADMIN)
        self.office = make_account("kantoor@example.com", User.Role.OFFICE)
        self.customer = make_account("klant@example.com")

    def sign_in(self, email, client=None):
        client = client or self.client
        return client.post(reverse("login"), {"username": email, "password": PASSWORD}, format="json")

    def staff_api(self, client=None):
        return (client or self.client).get("/api/staff/overview/")

    def turn_on(self, user_email, client=None):
        """Sign in and set the app up; returns the recovery codes."""
        client = client or self.client
        self.sign_in(user_email, client)
        client.post("/api/auth/2fa/setup/")
        user = User.objects.get(email=user_email)
        response = client.post("/api/auth/2fa/confirm/", {"code": code_for(user)}, format="json")
        assert response.status_code == 200, response.content
        return response.data["recovery_codes"]


class TotpTests(ThrottleFreeAPITestCase):
    def test_the_rfc_6238_example(self):
        """RFC 6238 appendix B: secret "12345678901234567890" at 59 s -> 94287082 (8 digits)."""
        secret = base64.b32encode(b"12345678901234567890").decode()
        self.assertEqual(twofactor.code_at(secret, twofactor.current_step(59)), "287082")


class DisabledModeTests(TwoFactorTestCase):
    """The default, and what local development runs with: nothing changes."""

    def test_no_policy_row_means_disabled_and_the_old_sign_in(self):
        self.assertEqual(twofactor.effective_mode(), Mode.DISABLED)
        response = self.sign_in("baas@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["two_factor"], "off")
        self.assertEqual(self.staff_api().status_code, 200)

    def test_the_personal_routes_are_closed_to_everybody_but_admins(self):
        for email in ("kantoor@example.com", "klant@example.com"):
            with self.subTest(email=email):
                self.sign_in(email)
                self.assertEqual(self.client.post("/api/auth/2fa/setup/").status_code, 403)
                self.client.post(reverse("logout"))

    def test_an_admin_sets_it_up_first_then_switches_it_on(self):
        """No dead end: the Security page wants the admin's own app first, and
        while it is off the admin is the one person who may set it up."""
        self.turn_on("baas@example.com")
        # Still off: nobody is asked for a code yet, the admin included.
        self.assertEqual(self.client.get(reverse("profile")).data["two_factor"], "off")
        self.assertEqual(self.staff_api().status_code, 200)

        response = self.client.put(
            "/api/staff/security/two-factor/", {"mode": Mode.REQUIRED_ALL, "password": PASSWORD}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(twofactor.effective_mode(), Mode.REQUIRED_ALL)

    def test_disabled_ignores_a_phone_set_up_earlier(self):
        set_mode(Mode.OPTIONAL)
        self.turn_on("kantoor@example.com")
        self.client.post(reverse("logout"))
        set_mode(Mode.DISABLED)
        self.assertEqual(self.sign_in("kantoor@example.com").data["two_factor"], "off")
        self.assertEqual(self.staff_api().status_code, 200)


class OptionalModeTests(TwoFactorTestCase):
    def setUp(self):
        super().setUp()
        set_mode(Mode.OPTIONAL)

    def test_people_without_it_sign_in_as_before(self):
        self.assertEqual(self.sign_in("kantoor@example.com").data["two_factor"], "off")
        self.assertEqual(self.staff_api().status_code, 200)

    def test_turning_it_on_then_signing_in_with_a_code(self):
        codes = self.turn_on("kantoor@example.com")
        self.assertEqual(len(codes), 10)
        self.client.post(reverse("logout"))

        self.assertEqual(self.sign_in("kantoor@example.com").data["two_factor"], "code_required")
        refused = self.staff_api()
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.json()["code"], "two_factor_required")

        with patch("accounts.twofactor.time.time", return_value=time.time() + 30):
            ok = self.client.post("/api/auth/2fa/verify/", {"code": code_for(self.office)}, format="json")
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(self.staff_api().status_code, 200)

    def test_wrong_expired_and_replayed_codes_are_refused(self):
        self.turn_on("kantoor@example.com")
        self.client.post(reverse("logout"))
        self.sign_in("kantoor@example.com")

        wrong = self.client.post("/api/auth/2fa/verify/", {"code": "000000"}, format="json")
        self.assertEqual(wrong.status_code, 400)
        expired = self.client.post("/api/auth/2fa/verify/", {"code": code_for(self.office, -4)}, format="json")
        self.assertEqual(expired.status_code, 400)
        # The code used during setup, again: refused (a code works once).
        replay = self.client.post("/api/auth/2fa/verify/", {"code": code_for(self.office)}, format="json")
        self.assertEqual(replay.status_code, 400)

    def test_a_recovery_code_works_once_and_is_stored_hashed(self):
        codes = self.turn_on("kantoor@example.com")
        stored = TwoFactorRecoveryCode.objects.filter(user=self.office).values_list("code_hash", flat=True)
        self.assertTrue(all(codes[0].replace("-", "")[4:] not in h for h in stored))

        for expected in (200, 400):
            self.client.post(reverse("logout"))
            self.sign_in("kantoor@example.com")
            response = self.client.post("/api/auth/2fa/verify/", {"code": codes[0].upper()}, format="json")
            self.assertEqual(response.status_code, expected)
        self.assertTrue(TwoFactorAuditEvent.objects.filter(kind="recovery_code_used", user=self.office).exists())

    def test_five_wrong_codes_pause_the_account(self):
        self.turn_on("kantoor@example.com")
        self.client.post(reverse("logout"))
        self.sign_in("kantoor@example.com")
        for _ in range(twofactor.MAX_FAILURES):
            self.client.post("/api/auth/2fa/verify/", {"code": "000000"}, format="json")
        with patch("accounts.twofactor.time.time", return_value=time.time() + 30):
            right = self.client.post("/api/auth/2fa/verify/", {"code": code_for(self.office)}, format="json")
        self.assertEqual(right.status_code, 429)
        self.assertTrue(TwoFactorAuditEvent.objects.filter(kind="locked_out").exists())

    def test_a_password_alone_cannot_replace_the_phone_or_change_the_email(self):
        self.turn_on("kantoor@example.com")
        self.client.post(reverse("logout"))
        self.sign_in("kantoor@example.com")
        self.assertEqual(self.client.post("/api/auth/2fa/setup/").status_code, 409)
        email = self.client.patch("/api/profile/", {"email": "x@example.com", "current_password": PASSWORD},
                                  format="json")
        self.assertEqual(email.status_code, 403)

    def test_turning_it_off_needs_the_password_and_a_code(self):
        self.turn_on("kantoor@example.com")
        later = time.time() + 30
        with patch("accounts.twofactor.time.time", return_value=later):
            no_password = self.client.post(
                "/api/auth/2fa/disable/", {"password": "nope", "code": code_for(self.office)}, format="json"
            )
            self.assertEqual(no_password.status_code, 400)
            ok = self.client.post("/api/auth/2fa/disable/", {"password": PASSWORD, "code": code_for(self.office)},
                                  format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertFalse(TwoFactorDevice.objects.filter(user=self.office).exists())
        self.assertTrue(TwoFactorAuditEvent.objects.filter(kind="disabled", user=self.office).exists())


class RequiredForAdminsTests(TwoFactorTestCase):
    def setUp(self):
        super().setUp()
        set_mode(Mode.REQUIRED_ADMINS)

    def test_an_admin_without_it_is_guided_to_set_it_up_first(self):
        self.assertEqual(self.sign_in("baas@example.com").data["two_factor"], "setup_required")
        self.assertEqual(self.staff_api().status_code, 403)
        self.client.post("/api/auth/2fa/setup/")
        self.client.post("/api/auth/2fa/confirm/", {"code": code_for(self.admin)}, format="json")
        self.assertEqual(self.staff_api().status_code, 200)

    def test_office_staff_are_not_asked(self):
        self.assertEqual(self.sign_in("kantoor@example.com").data["two_factor"], "off")
        self.assertEqual(self.staff_api().status_code, 200)

    def test_an_admin_cannot_turn_it_off(self):
        self.turn_on("baas@example.com")
        response = self.client.post("/api/auth/2fa/disable/", {"password": PASSWORD, "code": "123456"},
                                    format="json")
        self.assertEqual(response.status_code, 403)

    def test_django_admin_waits_for_the_code(self):
        root = User.objects.create_superuser("root@example.com", "root@example.com", PASSWORD)
        client = Client()
        client.force_login(root)  # a password sign-in on Django's own form
        self.assertEqual(client.get("/admin/").status_code, 403)


class RequiredForEveryoneTests(TwoFactorTestCase):
    def setUp(self):
        super().setUp()
        set_mode(Mode.REQUIRED_ALL)

    def test_customers_must_set_it_up_too(self):
        self.assertEqual(self.sign_in("klant@example.com").data["two_factor"], "setup_required")
        self.assertEqual(self.client.get("/api/packages/").status_code, 403)

    def test_a_floor_sign_in_is_not_asked(self):
        worker = make_account("wim@example.com", User.Role.WAREHOUSE)
        request = RequestFactory().get("/")
        request.user = worker
        request.session = SessionStore()
        request.session[WAREHOUSE_UNLOCKED_KEY] = True
        self.assertEqual(twofactor.state(request), "off")


class EnvironmentTests(TwoFactorTestCase):
    @override_settings(TWO_FACTOR_MINIMUM_MODE="required_admins")
    def test_the_minimum_mode_wins_over_a_looser_choice(self):
        set_mode(Mode.DISABLED)
        self.assertEqual(twofactor.effective_mode(), Mode.REQUIRED_ADMINS)

    @override_settings(DEBUG=False, TWO_FACTOR_FORCE_DISABLED=True)
    def test_the_development_switch_does_nothing_in_production(self):
        set_mode(Mode.REQUIRED_ALL)
        self.assertEqual(twofactor.effective_mode(), Mode.REQUIRED_ALL)

    @override_settings(DEBUG=True, TWO_FACTOR_FORCE_DISABLED=True)
    def test_the_development_switch_works_locally(self):
        set_mode(Mode.REQUIRED_ALL)
        self.assertEqual(twofactor.effective_mode(), Mode.DISABLED)


class PolicySettingsTests(TwoFactorTestCase):
    url = "/api/staff/security/two-factor/"

    def put(self, mode, password=PASSWORD):
        return self.client.put(self.url, {"mode": mode, "password": password}, format="json")

    def test_only_admins_can_see_or_change_it(self):
        self.sign_in("kantoor@example.com")
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.put(Mode.DISABLED).status_code, 403)

    def test_a_change_needs_the_password_and_is_audited(self):
        self.sign_in("baas@example.com")
        self.assertEqual(self.put(Mode.OPTIONAL, password="wrong").status_code, 400)
        self.assertEqual(self.put(Mode.OPTIONAL).status_code, 200)
        event = TwoFactorAuditEvent.objects.get(kind="policy_changed")
        self.assertEqual(event.detail, {"from": "disabled", "to": "optional"})
        self.assertEqual(event.actor, self.admin)

    def test_an_admin_cannot_lock_themselves_out(self):
        self.sign_in("baas@example.com")
        refused = self.put(Mode.REQUIRED_ADMINS)
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(twofactor.stored_mode(), Mode.DISABLED)

        set_mode(Mode.OPTIONAL)
        self.client.post(reverse("logout"))
        self.turn_on("baas@example.com")
        response = self.put(Mode.REQUIRED_ADMINS)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["effective_mode"], Mode.REQUIRED_ADMINS)

    def test_the_page_lists_admins_without_it(self):
        self.sign_in("baas@example.com")
        data = self.client.get(self.url).data
        self.assertEqual(data["affected"]["required_admins"]["total"], 1)
        self.assertEqual(data["affected"]["required_admins"]["without"][0]["email"], "baas@example.com")


class RecoveryTests(TwoFactorTestCase):
    def setUp(self):
        super().setUp()
        set_mode(Mode.OPTIONAL)
        self.colleague = APIClient()
        self.turn_on("kantoor@example.com", self.colleague)

    def test_an_admin_resets_a_colleague_who_is_signed_out_everywhere(self):
        self.sign_in("baas@example.com")
        response = self.client.post(f"/api/staff/customers/{self.office.pk}/reset-two-factor/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["two_factor"], "off")
        self.assertEqual(self.colleague.get(reverse("profile")).status_code, 403)
        self.assertTrue(TwoFactorAuditEvent.objects.filter(kind="reset_by_admin", user=self.office).exists())

    def test_office_cannot_reset_and_nobody_resets_themselves(self):
        office_client = APIClient()
        self.sign_in("kantoor@example.com", office_client)
        self.assertEqual(office_client.post(f"/api/staff/customers/{self.admin.pk}/reset-two-factor/").status_code, 403)
        self.sign_in("baas@example.com")
        self.assertEqual(self.client.post(f"/api/staff/customers/{self.admin.pk}/reset-two-factor/").status_code, 403)

    def test_the_server_command_for_the_last_admin(self):
        call_command("reset_two_factor", "kantoor@example.com", stdout=StringIO())
        self.assertFalse(TwoFactorDevice.objects.filter(user=self.office).exists())
        self.assertTrue(TwoFactorAuditEvent.objects.filter(kind="reset_from_server").exists())


class SessionTests(TwoFactorTestCase):
    def test_a_new_sign_in_is_never_already_verified(self):
        set_mode(Mode.OPTIONAL)
        self.turn_on("kantoor@example.com")
        self.assertEqual(self.client.get(reverse("profile")).data["two_factor"], "verified")
        self.sign_in("kantoor@example.com")  # again, same browser
        self.assertEqual(self.client.get(reverse("profile")).data["two_factor"], "code_required")

    def test_turning_it_off_signs_out_the_other_browsers(self):
        set_mode(Mode.OPTIONAL)
        other = APIClient()
        self.turn_on("kantoor@example.com")
        self.sign_in("kantoor@example.com", other)
        with patch("accounts.twofactor.time.time", return_value=time.time() + 30):
            self.client.post("/api/auth/2fa/disable/", {"password": PASSWORD, "code": code_for(self.office)},
                             format="json")
        self.assertEqual(self.client.get(reverse("profile")).status_code, 200)
        self.assertEqual(other.get(reverse("profile")).status_code, 403)
        self.assertGreaterEqual(Session.objects.count(), 1)


class EncryptionTests(TwoFactorTestCase):
    def test_the_secret_is_not_stored_as_plain_text(self):
        set_mode(Mode.OPTIONAL)
        self.sign_in("kantoor@example.com")
        secret = self.client.post("/api/auth/2fa/setup/").data["secret"]
        stored = TwoFactorDevice.objects.get(user=self.office).secret_encrypted
        self.assertNotIn(secret, stored)
        self.assertEqual(twofactor_crypto.decrypt(stored), secret)

    def test_rotating_the_key(self):
        old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
        set_mode(Mode.OPTIONAL)
        with override_settings(TWO_FACTOR_ENCRYPTION_KEYS=[old]):
            self.sign_in("kantoor@example.com")
            secret = self.client.post("/api/auth/2fa/setup/").data["secret"]
        with override_settings(TWO_FACTOR_ENCRYPTION_KEYS=[new, old]):
            call_command("rotate_two_factor_key", stdout=StringIO())
        with override_settings(TWO_FACTOR_ENCRYPTION_KEYS=[new]):
            self.assertEqual(secret_of(self.office), secret)
