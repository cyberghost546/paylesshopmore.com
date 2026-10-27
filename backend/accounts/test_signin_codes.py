"""Tests for warehouse sign-in codes: an admin e-mails a worker a four-digit code.

Four digits is a short secret, so most of what is tested here is the ways it
is kept from being worth guessing: only warehouse accounts get one, five
wrong guesses kill it, it works once and soon expires, and the admin who sent
it never sees it.

Where a test needs to know the code, `secrets.randbelow` is patched rather than
the code read back out of the mail. A random code would otherwise collide with
the "wrong" one used in the same test one time in ten thousand.
"""

from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core import mail
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.throttling import ScopedRateThrottle

from config.testing import ThrottleFreeAPITestCase

from .models import WarehouseSignInCode
from .signin_codes import (
    LAST_ACTIVE_KEY,
    MAX_ATTEMPTS,
    CodeNotAllowed,
    code_goes_on_screen,
    issue_code,
    redeem_code,
)

User = get_user_model()

SEND_URL = reverse("staff-warehouse-sign-in-code")
LOGIN_URL = reverse("code-login")
PROFILE_URL = reverse("profile")

PASSWORD = "a-long-enough-password"

# What secrets.randbelow is patched to return, and the code it makes.
RIGHT = 4821
RIGHT_CODE = "4821"
WRONG_CODE = "0000"


def make_account(email, role, **extra):
    return User.objects.create_user(
        username=email,
        email=email,
        password=PASSWORD,
        first_name="Wim",
        role=role,
        **extra,
    )


def fixed_code(*values):
    """secrets.randbelow answering with these numbers in turn."""
    return patch("accounts.signin_codes.secrets.randbelow", side_effect=list(values))


class SignInCodeTestCase(ThrottleFreeAPITestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_account("baas@example.com", User.Role.ADMIN)
        self.office = make_account("kantoor@example.com", User.Role.OFFICE)
        self.worker = make_account("wim@example.com", User.Role.WAREHOUSE)
        self.customer = make_account("klant@example.com", User.Role.CUSTOMER)
        mail.outbox.clear()

    def send(self, email="wim@example.com", as_user=None, code=RIGHT):
        """Have `as_user` (the admin by default) send a code; returns the response."""
        self.client.force_authenticate(as_user or self.admin)
        with fixed_code(code):
            response = self.client.post(SEND_URL, {"email": email}, format="json")
        self.client.force_authenticate(None)
        return response

    def sign_in(self, email="wim@example.com", code=RIGHT_CODE):
        return self.client.post(
            LOGIN_URL, {"email": email, "code": code}, format="json"
        )


class SendCodeTests(SignInCodeTestCase):
    def test_an_admin_e_mails_a_worker_a_code(self):
        response = self.send()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["sent_to"], "wim@example.com")
        self.assertEqual(response.data["expires_in_minutes"], 15)

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["wim@example.com"])
        # On a line of its own, which is what makes it readable on a phone.
        self.assertRegex(mail.outbox[0].body, rf"(?m)^{RIGHT_CODE}$")
        # Not in the subject, which shows on a lock screen.
        self.assertNotIn(RIGHT_CODE, mail.outbox[0].subject)

    def test_the_admin_is_never_told_the_code(self):
        """If the answer carried it, sending one would be a way of signing in as the worker."""
        response = self.send()

        self.assertNotIn(RIGHT_CODE, response.content.decode())
        self.assertEqual(set(response.data), {"sent_to", "expires_in_minutes", "delivery"})
        self.assertEqual(response.data["delivery"], "email")

    def test_only_a_digest_is_stored_and_the_sender_is_recorded(self):
        self.send()

        row = WarehouseSignInCode.objects.get()
        self.assertEqual(row.user, self.worker)
        self.assertEqual(row.issued_by, self.admin)
        self.assertNotEqual(row.code_hash, RIGHT_CODE)
        self.assertEqual(len(row.code_hash), 64)
        self.assertIsNone(row.used_at)
        self.assertEqual(row.attempts, 0)

    def test_the_link_opens_the_code_form_with_the_address_but_not_the_code(self):
        self.send()

        body = mail.outbox[0].body
        self.assertIn("/login?method=code&email=wim%40example.com", body)
        self.assertNotIn(f"code={RIGHT_CODE}", body)

    def test_the_address_is_matched_without_regard_to_case(self):
        response = self.send(email="WIM@Example.COM")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(mail.outbox[0].to, ["wim@example.com"])

    def test_only_an_admin_can_send_one(self):
        for user in (self.office, self.worker, self.customer, None):
            response = self.send(as_user=user) if user else self._anonymous_send()
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(WarehouseSignInCode.objects.count(), 0)

    def _anonymous_send(self):
        return self.client.post(SEND_URL, {"email": "wim@example.com"}, format="json")

    def test_codes_are_only_for_warehouse_workers(self):
        for account in (self.admin, self.office, self.customer):
            response = self.send(email=account.email)

            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, account.role)
            self.assertIn("only for warehouse workers", str(response.data["email"]))

        driver = make_account("chauffeur@example.com", User.Role.DRIVER)
        self.assertEqual(self.send(email=driver.email).status_code, 400)

        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(WarehouseSignInCode.objects.count(), 0)

    def test_a_superuser_is_never_given_one(self):
        """is_staff on a superuser means /admin/ - far more than a four-digit code may open."""
        boss = User.objects.create_superuser(
            username="root@example.com", email="root@example.com", password=PASSWORD
        )
        User.objects.filter(pk=boss.pk).update(role=User.Role.WAREHOUSE)
        boss.refresh_from_db()

        with self.assertRaises(CodeNotAllowed):
            issue_code(boss, issued_by=self.admin)

    def test_an_address_nobody_has_is_refused_plainly(self):
        response = self.send(email="niemand@example.com")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(len(mail.outbox), 0)

    def test_a_switched_off_or_erased_account_is_refused(self):
        self.worker.is_active = False
        self.worker.save()
        self.assertEqual(self.send().status_code, status.HTTP_400_BAD_REQUEST)

        erased = make_account("weg@example.com", User.Role.WAREHOUSE)
        erased.anonymise()
        self.assertEqual(
            self.send(email=f"deleted-{erased.pk}@deleted.invalid").status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(len(mail.outbox), 0)

    def test_a_malformed_address_is_a_400(self):
        response = self.send(email="not-an-address")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sending_again_replaces_the_earlier_code(self):
        self.send(code=1111)
        self.send(code=2222)

        self.assertEqual(WarehouseSignInCode.objects.filter(user=self.worker).count(), 1)
        self.assertEqual(self.sign_in(code="1111").status_code, 401)
        self.assertEqual(self.sign_in(code="2222").status_code, 200)

    def test_a_failed_mail_leaves_no_live_code_and_says_so(self):
        self.client.force_authenticate(self.admin)
        with (
            fixed_code(RIGHT),
            patch("accounts.emails.send_mail", side_effect=OSError("mail server down")),
            self.assertLogs("staff.views", level="ERROR"),
        ):
            response = self.client.post(SEND_URL, {"email": "wim@example.com"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(WarehouseSignInCode.objects.count(), 0)

    def test_any_failure_to_send_leaves_no_live_code_not_just_a_mail_server_error(self):
        """The plain code is a local in the view, and an error reporter records locals.

        So whatever goes wrong while sending - a bad header, a template bug, not
        only the mail server being down - the code must already be dead by the
        time anything is reported.
        """
        self.client.force_authenticate(self.admin)
        with (
            fixed_code(RIGHT),
            patch("accounts.emails.send_mail", side_effect=ValueError("bad header")),
            self.assertLogs("staff.views", level="ERROR"),
        ):
            response = self.client.post(SEND_URL, {"email": "wim@example.com"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(WarehouseSignInCode.objects.count(), 0)
        # And the worker cannot use what was never delivered.
        self.assertEqual(self.sign_in().status_code, status.HTTP_401_UNAUTHORIZED)

    def test_the_lifetime_comes_from_the_setting(self):
        with self.settings(WAREHOUSE_CODE_MINUTES=5):
            response = self.send()

        self.assertEqual(response.data["expires_in_minutes"], 5)
        row = WarehouseSignInCode.objects.get()
        self.assertAlmostEqual(
            (row.expires_at - row.created_at).total_seconds(), 300, delta=5
        )

    def test_the_send_endpoint_is_throttled_per_admin(self):
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"warehouse_code_send": "2/hour"}):
            statuses = [self.send().status_code for _ in range(3)]

        self.assertEqual(statuses, [200, 200, 429])


class CodeLoginTests(SignInCodeTestCase):
    def test_the_right_code_signs_the_worker_in(self):
        self.send()

        response = self.sign_in()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], "wim@example.com")
        self.assertEqual(response.data["role"], "warehouse")
        self.assertNotIn("password", response.data)
        # The session cookie works: the profile answers for the worker.
        profile = self.client.get(PROFILE_URL)
        self.assertEqual(profile.status_code, status.HTTP_200_OK)
        self.assertEqual(profile.data["email"], "wim@example.com")

    def test_an_account_with_no_password_can_sign_in_with_a_code(self):
        """An invited colleague has an unusable password until they follow the link."""
        self.worker.set_unusable_password()
        self.worker.save()
        self.send()

        self.assertEqual(self.sign_in().status_code, status.HTTP_200_OK)

    def test_the_address_is_matched_without_regard_to_case(self):
        self.send()

        self.assertEqual(self.sign_in(email="  WIM@Example.com ").status_code, 200)

    def test_a_code_works_once(self):
        self.send()
        self.assertEqual(self.sign_in().status_code, 200)
        self.client.post(reverse("logout"))

        self.assertEqual(self.sign_in().status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIsNotNone(WarehouseSignInCode.objects.get().used_at)

    def test_a_wrong_code_signs_nobody_in_and_is_counted(self):
        self.send()

        response = self.sign_in(code=WRONG_CODE)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.get(PROFILE_URL).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(WarehouseSignInCode.objects.get().attempts, 1)

    def test_every_failure_looks_the_same(self):
        """Which addresses are workers, and which have a code, must not be learnable."""
        self.send()
        expired = make_account("laat@example.com", User.Role.WAREHOUSE)
        with fixed_code(1234):
            issue_code(expired, issued_by=self.admin)
        WarehouseSignInCode.objects.filter(user=expired).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        no_code = make_account("geen@example.com", User.Role.WAREHOUSE)

        attempts = [
            self.sign_in(code=WRONG_CODE),  # wrong code
            self.sign_in(email="niemand@example.com"),  # no such address
            self.sign_in(email="kantoor@example.com"),  # not a warehouse worker
            self.sign_in(email="laat@example.com", code="1234"),  # right but expired
            self.sign_in(email=no_code.email),  # no code was ever sent
            self.sign_in(code="12"),  # malformed
        ]

        for response in attempts:
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(response.content, attempts[0].content)

    def test_five_wrong_guesses_kill_the_code_even_for_the_right_one(self):
        self.send()

        for _ in range(MAX_ATTEMPTS):
            self.assertEqual(self.sign_in(code=WRONG_CODE).status_code, 401)

        self.assertEqual(self.sign_in().status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(WarehouseSignInCode.objects.get().attempts, MAX_ATTEMPTS)
        self.assertEqual(self.client.get(PROFILE_URL).status_code, 403)

    def test_the_guesses_are_spent_before_the_comparison(self):
        """Counting after would let fifty parallel guesses all see "0 attempts so far"."""
        self.send()
        WarehouseSignInCode.objects.update(attempts=MAX_ATTEMPTS - 1)

        # The last ticket goes to a wrong guess; the right code arriving next has none.
        self.assertIsNone(redeem_code("wim@example.com", WRONG_CODE))
        self.assertIsNone(redeem_code("wim@example.com", RIGHT_CODE))

    def test_a_malformed_code_costs_nothing(self):
        self.send()

        for code in ("12", "12345", "abcd", ""):
            self.assertEqual(self.sign_in(code=code).status_code, 401)

        self.assertEqual(WarehouseSignInCode.objects.get().attempts, 0)
        self.assertEqual(self.sign_in().status_code, 200)

    def test_an_expired_code_is_refused(self):
        self.send()
        WarehouseSignInCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))

        self.assertEqual(self.sign_in().status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_code_belongs_to_one_worker(self):
        other = make_account("jos@example.com", User.Role.WAREHOUSE)
        self.send(code=1111)
        self.send(email=other.email, code=2222)

        # Wim's code on Jos's address.
        self.assertEqual(self.sign_in(email=other.email, code="1111").status_code, 401)
        self.assertEqual(self.sign_in(email=other.email, code="2222").status_code, 200)

    def test_a_code_is_refused_once_the_account_is_no_longer_a_warehouse_worker(self):
        self.send()
        self.worker.role = User.Role.OFFICE
        self.worker.save()

        self.assertEqual(self.sign_in().status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_code_is_refused_once_the_account_is_switched_off(self):
        self.send()
        self.worker.is_active = False
        self.worker.save()

        self.assertEqual(self.sign_in().status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_warehouse_session_opens_the_floor_and_nothing_else(self):
        """The whole point of limiting codes to the floor: what it opens stays small."""
        self.send()
        self.sign_in()

        self.assertEqual(
            self.client.get(reverse("staff-warehouse-access")).status_code, 200
        )
        self.assertEqual(self.client.get(reverse("staff-customer-list")).status_code, 403)
        self.assertEqual(self.client.get(reverse("staff-invoice-list")).status_code, 403)
        self.assertEqual(self.client.get("/admin/").status_code, 302)

    def test_the_login_endpoint_is_throttled(self):
        self.send()

        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"code_login": "2/hour"}):
            statuses = [self.sign_in(code=WRONG_CODE).status_code for _ in range(3)]

        self.assertEqual(statuses, [401, 401, 429])


class AuditTrailTests(SignInCodeTestCase):
    """Who sent a code, to whom, and when it was spent: read-only in /admin/, no digest."""

    def setUp(self):
        super().setUp()
        self.boss = User.objects.create_superuser(
            username="root@example.com", email="root@example.com", password=PASSWORD
        )
        self.send()
        self.sign_in()
        self.row = WarehouseSignInCode.objects.get()
        self.client.logout()
        self.client.force_login(self.boss)

    def test_the_admin_lists_who_sent_it_to_whom_and_whether_it_was_used(self):
        response = self.client.get(reverse("admin:accounts_warehousesignincode_changelist"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.content.decode()
        self.assertIn("wim@example.com", body)
        self.assertIn("baas@example.com", body)

    def test_the_page_for_one_code_does_not_show_the_digest(self):
        response = self.client.get(
            reverse("admin:accounts_warehousesignincode_change", args=[self.row.pk])
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn(self.row.code_hash, response.content.decode())
        self.assertNotIn("code_hash", response.content.decode())

    def test_codes_cannot_be_added_or_edited_by_hand(self):
        add = self.client.get(reverse("admin:accounts_warehousesignincode_add"))
        edit = self.client.post(
            reverse("admin:accounts_warehousesignincode_change", args=[self.row.pk]),
            {"attempts": 0},
        )

        self.assertEqual(add.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(edit.status_code, status.HTTP_403_FORBIDDEN)


class IdleSessionTests(SignInCodeTestCase):
    """A shared floor device must not stay signed in as whoever used it last."""

    def expiry(self):
        return Session.objects.get(pk=self.client.session.session_key).expire_date

    def minutes_from_now(self, when):
        return (when - timezone.now()).total_seconds() / 60

    def test_a_code_session_ends_after_half_an_hour_idle_not_two_weeks(self):
        self.send()
        self.sign_in()

        self.assertAlmostEqual(self.minutes_from_now(self.expiry()), 30, delta=1)

    def test_it_slides_so_somebody_who_is_working_is_never_cut_off(self):
        self.send()
        self.sign_in()
        # Twenty-nine minutes of nothing: one minute from the end.
        Session.objects.filter(pk=self.client.session.session_key).update(
            expire_date=timezone.now() + timedelta(minutes=1)
        )

        self.assertEqual(self.client.get(PROFILE_URL).status_code, 200)

        self.assertAlmostEqual(self.minutes_from_now(self.expiry()), 30, delta=1)

    def test_an_idle_session_is_over(self):
        self.send()
        self.sign_in()
        Session.objects.filter(pk=self.client.session.session_key).update(
            expire_date=timezone.now() - timedelta(seconds=1)
        )

        self.assertEqual(self.client.get(PROFILE_URL).status_code, status.HTTP_403_FORBIDDEN)

    def test_the_idle_time_comes_from_the_setting(self):
        self.send()
        with self.settings(WAREHOUSE_SESSION_IDLE_MINUTES=5):
            self.sign_in()

        self.assertAlmostEqual(self.minutes_from_now(self.expiry()), 5, delta=1)

    def test_a_setting_of_zero_does_not_mean_until_the_browser_closes(self):
        self.send()
        with self.settings(WAREHOUSE_SESSION_IDLE_MINUTES=0):
            self.sign_in()

        self.assertAlmostEqual(self.minutes_from_now(self.expiry()), 1, delta=0.5)

    def test_the_profile_tells_the_browser_how_long_it_may_sit_idle(self):
        """So the device can go back to the code form on its own, instead of
        showing the last worker's name until somebody taps and is refused."""
        self.send()
        self.sign_in()

        read = self.client.get(PROFILE_URL)
        edit = self.client.patch(PROFILE_URL, {"first_name": "Wim"}, format="json")

        self.assertEqual(read.data["session_idle_seconds"], 30 * 60)
        # The profile page publishes the PATCH answer as the signed-in user, so
        # it must not drop the limit and switch the countdown off.
        self.assertEqual(edit.data["session_idle_seconds"], 30 * 60)

    def test_the_idle_limit_the_profile_reports_is_the_clamped_one(self):
        self.send()
        with self.settings(WAREHOUSE_SESSION_IDLE_MINUTES=0):
            self.sign_in()

        self.assertEqual(self.client.get(PROFILE_URL).data["session_idle_seconds"], 60)

    def test_a_password_session_reports_no_idle_limit(self):
        self.client.post(
            reverse("login"),
            {"username": "klant@example.com", "password": PASSWORD},
            format="json",
        )

        self.assertIsNone(self.client.get(PROFILE_URL).data["session_idle_seconds"])

    def request_at(self, minutes, background=False):
        """GET the profile `minutes` after signing in, by the middleware's clock.
        `background` is how the browser marks a request it made on a timer."""
        headers = {"HTTP_X_BACKGROUND_REFRESH": "1"} if background else {}
        with patch("accounts.middleware.time") as clock:
            clock.time.return_value = self.signed_in_at + minutes * 60
            return self.client.get(PROFILE_URL, **headers).status_code

    def sign_in_and_note_when(self):
        self.send()
        self.sign_in()
        self.signed_in_at = self.client.session[LAST_ACTIVE_KEY]

    def test_a_timed_refresh_does_not_count_as_somebody_working(self):
        """The warehouse home page refreshes itself every minute. Before this, a
        phone left on it never went idle and stayed signed in as the last
        worker for as long as the screen was on."""
        self.sign_in_and_note_when()

        for minute in range(1, 30):
            self.assertEqual(self.request_at(minute, background=True), 200)

        self.assertEqual(self.request_at(31, background=True), status.HTTP_403_FORBIDDEN)

    def test_a_request_somebody_made_does(self):
        self.sign_in_and_note_when()

        self.assertEqual(self.request_at(20), 200)
        # Twenty-five minutes after the last thing they did: still theirs.
        self.assertEqual(self.request_at(45, background=True), 200)
        # Thirty-one: over, refresh or no refresh.
        self.assertEqual(self.request_at(51, background=True), status.HTTP_403_FORBIDDEN)

    def test_an_idle_session_is_signed_out_not_just_refused(self):
        self.sign_in_and_note_when()

        self.assertEqual(self.request_at(31), status.HTTP_403_FORBIDDEN)

        # Gone for good: being active again does not bring it back.
        self.assertEqual(self.request_at(0), status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get(PROFILE_URL).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_password_session_is_not_timed_by_activity(self):
        self.client.post(
            reverse("login"),
            {"username": "klant@example.com", "password": PASSWORD},
            format="json",
        )
        self.signed_in_at = timezone.now().timestamp()

        self.assertEqual(self.request_at(24 * 60, background=True), 200)

    @override_settings(CORS_ALLOWED_ORIGINS=["https://app.example.com"])
    def test_a_frontend_on_another_origin_may_send_the_refresh_marker(self):
        """Otherwise every timed refresh would be refused at the preflight."""
        response = self.client.options(
            PROFILE_URL,
            HTTP_ORIGIN="https://app.example.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-background-refresh",
        )

        self.assertIn(
            "x-background-refresh",
            response.headers["Access-Control-Allow-Headers"].lower(),
        )

    def test_everybody_else_keeps_the_normal_session(self):
        """A customer's password sign-in keeps the normal two weeks. (Staff get
        an idle limit of their own: accounts/staff_sessions.py.)"""
        response = self.client.post(
            reverse("login"),
            {"username": "klant@example.com", "password": PASSWORD},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(
            self.minutes_from_now(self.expiry()),
            settings.SESSION_COOKIE_AGE / 60,
            delta=1,
        )


class CodeOnScreenTests(SignInCodeTestCase):
    """While the site cannot send real mail, the admin is shown the code to
    pass on in person - and it goes back to e-mail by itself once it can."""

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
        EMAIL_HOST="",
        WAREHOUSE_CODE_ON_SCREEN="auto",
    )
    def test_without_a_mail_server_the_admin_is_shown_the_code(self):
        response = self.send()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["delivery"], "screen")
        self.assertEqual(response.data["code"], RIGHT_CODE)
        # Nothing was e-mailed: there was nowhere for it to go.
        self.assertEqual(len(mail.outbox), 0)
        # On the record, so the audit trail can tell these sign-ins apart.
        self.assertTrue(WarehouseSignInCode.objects.get().shown_on_screen)
        # And it signs the worker in like any other code.
        self.assertEqual(self.sign_in().status_code, status.HTTP_200_OK)

    @override_settings(WAREHOUSE_CODE_ON_SCREEN="1")
    def test_it_can_be_forced_on(self):
        response = self.send()

        self.assertEqual(response.data["code"], RIGHT_CODE)
        self.assertEqual(len(mail.outbox), 0)

    def test_with_mail_working_it_is_never_shown(self):
        """The test runner's outbox counts as working mail."""
        response = self.send()

        self.assertNotIn("code", response.data)
        self.assertFalse(WarehouseSignInCode.objects.get().shown_on_screen)

    def test_when_it_goes_on_screen(self):
        smtp = "django.core.mail.backends.smtp.EmailBackend"
        cases = [
            # (backend, EMAIL_HOST, WAREHOUSE_CODE_ON_SCREEN) -> on screen?
            ((smtp, "", "auto"), True),
            ((smtp, "smtp.example.com", "auto"), False),  # mail added: back to e-mail
            (("django.core.mail.backends.console.EmailBackend", "", "auto"), True),
            (("django.core.mail.backends.dummy.EmailBackend", "", "auto"), True),
            (("anymail.backends.sendgrid.EmailBackend", "", "auto"), False),
            ((smtp, "", "0"), False),  # forced off
            ((smtp, "smtp.example.com", "1"), True),  # forced on
        ]
        for (backend, host, choice), expected in cases:
            with self.subTest(backend=backend, host=host, choice=choice), self.settings(
                EMAIL_BACKEND=backend, EMAIL_HOST=host, WAREHOUSE_CODE_ON_SCREEN=choice
            ):
                self.assertEqual(code_goes_on_screen(), expected)

    @override_settings(WAREHOUSE_CODE_ON_SCREEN="1")
    def test_still_only_for_admins(self):
        response = self.send(as_user=self.office)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertNotIn(RIGHT_CODE, response.content.decode())
