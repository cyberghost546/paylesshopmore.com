"""Regression tests for the findings of the October 2026 security review.

Each class is one finding, and each test is the attack it was found with:
if one of these starts failing, that hole is open again.
"""

import importlib
from unittest.mock import patch

from django.apps import apps as django_apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import override_settings

from accounts.models import Package
from config.testing import ThrottleFreeAPITestCase
from warehouse.report import spreadsheet_safe, to_csv

User = get_user_model()
PASSWORD = "a-long-enough-password"


def make_user(email, **extra):
    return User.objects.create_user(
        username=email,
        email=email,
        password=PASSWORD,
        first_name="Test",
        last_name="User",
        phone_number="+599 9 000 0000",
        **extra,
    )


class StaffCannotEditAccountsAboveThemTests(ThrottleFreeAPITestCase):
    """An office worker rewriting an admin's e-mail, then resetting its password."""

    def setUp(self):
        super().setUp()
        self.admin = make_user("boss@example.com", role=User.Role.ADMIN)
        self.office = make_user("office@example.com", role=User.Role.OFFICE)
        self.superuser = make_user("root@example.com", is_superuser=True, is_staff=True)
        self.customer = make_user("klant@example.com")

    def patch_email(self, target, email):
        return self.client.patch(
            f"/api/staff/customers/{target.pk}/", {"email": email}, format="json"
        )

    def test_office_cannot_change_an_admins_email(self):
        self.client.force_authenticate(self.office)
        response = self.patch_email(self.admin, "attacker@evil.test")

        self.assertEqual(response.status_code, 403)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.email, "boss@example.com")

        # And so the reset that followed it in the attack goes nowhere.
        self.client.force_authenticate(None)
        self.client.post("/api/auth/password-reset/", {"email": "attacker@evil.test"})
        self.assertEqual(mail.outbox, [])

    def test_office_cannot_change_a_superusers_email(self):
        self.client.force_authenticate(self.office)
        self.assertEqual(self.patch_email(self.superuser, "attacker@evil.test").status_code, 403)

    def test_office_cannot_change_an_admins_address(self):
        self.client.force_authenticate(self.office)
        response = self.client.post(
            f"/api/staff/customers/{self.admin.pk}/address/",
            {"street": "X", "house_number": "1", "postal_code": "1", "city": "X", "country": "X"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_cannot_change_a_superusers_email(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.patch_email(self.superuser, "new@example.com").status_code, 403)

    def test_office_can_still_correct_a_customer(self):
        self.client.force_authenticate(self.office)
        self.assertEqual(self.patch_email(self.customer, "fixed@example.com").status_code, 200)

    def test_admin_can_correct_another_staff_account(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.patch_email(self.office, "office2@example.com").status_code, 200)


class ProfileEmailChangeTests(ThrottleFreeAPITestCase):
    """A borrowed session changing the address, and case-only duplicates."""

    def setUp(self):
        super().setUp()
        self.user = make_user("klant@example.com")
        self.other = make_user("boss@example.com")
        self.client.force_authenticate(self.user)

    def test_changing_email_needs_the_current_password(self):
        response = self.client.patch("/api/profile/", {"email": "new@example.com"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("current_password", response.data)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "klant@example.com")

    def test_wrong_password_is_refused(self):
        response = self.client.patch(
            "/api/profile/",
            {"email": "new@example.com", "current_password": "not-it"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_right_password_changes_it_lowercased(self):
        response = self.client.patch(
            "/api/profile/",
            {"email": "New@Example.com", "current_password": PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, "new@example.com")

    def test_other_fields_need_no_password(self):
        response = self.client.patch(
            "/api/profile/",
            {"first_name": "Ander", "email": "KLANT@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_case_variant_of_someone_elses_email_is_refused(self):
        response = self.client.patch(
            "/api/profile/",
            {"email": "Boss@Example.com", "current_password": PASSWORD},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.filter(email__iexact="boss@example.com").count(), 1)

    def test_signup_with_a_case_variant_is_email_taken(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            "/api/auth/signup/",
            {
                "username": "someone",
                "first_name": "A",
                "last_name": "B",
                "email": "BOSS@example.com",
                "phone_number": "1",
                "password": PASSWORD,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data.get("code"), "email_taken")


@override_settings(LOGIN_FAILURE_LIMIT=3)
class PerAccountLoginLockoutTests(ThrottleFreeAPITestCase):
    """Guessing one account's password from addresses that keep changing."""

    def setUp(self):
        super().setUp()
        self.user = make_user("boss@example.com", role=User.Role.ADMIN)

    def api_login(self, username, password, n):
        return self.client.post(
            "/api/auth/login/",
            {"username": username, "password": password},
            format="json",
            HTTP_X_FORWARDED_FOR=f"10.0.0.{n}",
        )

    def test_rotating_forwarded_for_does_not_escape_the_ceiling(self):
        codes = [self.api_login("boss@example.com", "wrong", n).status_code for n in range(4)]
        self.assertEqual(codes, [401, 401, 401, 429])

        # Locked even with the right password, until the window passes.
        self.assertEqual(self.api_login("boss@example.com", PASSWORD, 9).status_code, 429)

    def test_username_and_email_share_one_budget(self):
        self.api_login("boss@example.com", "wrong", 1)
        self.api_login("BOSS@EXAMPLE.COM", "wrong", 2)
        self.api_login("boss@example.com", "wrong", 3)
        self.assertEqual(self.api_login("Boss@example.com", "wrong", 4).status_code, 429)

    def test_successful_logins_do_not_count(self):
        for n in range(5):
            self.assertEqual(self.api_login("boss@example.com", PASSWORD, n).status_code, 200)

    def test_admin_login_is_limited_and_shares_the_budget(self):
        self.api_login("boss@example.com", "wrong", 1)
        self.api_login("boss@example.com", "wrong", 2)
        response = self.client.post(
            "/admin/login/", {"username": "boss@example.com", "password": "wrong"}
        )
        self.assertEqual(response.status_code, 200)  # the form again: a failure
        response = self.client.post(
            "/admin/login/", {"username": "boss@example.com", "password": PASSWORD}
        )
        self.assertEqual(response.status_code, 429)


# NUM_PROXIES=1: the visitor's address is known (the last X-Forwarded-For entry).
@override_settings(
    LOGIN_FAILURE_LIMIT=3,
    LOGIN_FAILURE_ACCOUNT_LIMIT=5,
    REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1},
)
class LockoutIsNotADenialOfServiceTests(ThrottleFreeAPITestCase):
    """A stranger's wrong guesses must not lock the owner out of their account."""

    def setUp(self):
        super().setUp()
        self.user = make_user("boss@example.com", role=User.Role.ADMIN)

    def api_login(self, password, address):
        return self.client.post(
            "/api/auth/login/",
            {"username": "boss@example.com", "password": password},
            format="json",
            HTTP_X_FORWARDED_FOR=address,
        ).status_code

    def test_the_owner_still_gets_in_from_their_own_address(self):
        codes = [self.api_login("wrong", "203.0.113.9") for _ in range(4)]
        self.assertEqual(codes, [401, 401, 401, 429])

        self.assertEqual(self.api_login(PASSWORD, "198.51.100.7"), 200)

    def test_many_addresses_still_meet_the_account_ceiling(self):
        codes = [self.api_login("wrong", f"203.0.113.{n}") for n in range(6)]
        self.assertEqual(codes, [401, 401, 401, 401, 401, 429])

        # Now from everywhere, the right password included.
        self.assertEqual(self.api_login(PASSWORD, "198.51.100.7"), 429)


class DriverSeesOnlyDeliveriesTests(ThrottleFreeAPITestCase):
    """A driver walking package ids to collect every customer's details."""

    def setUp(self):
        super().setUp()
        self.customer = make_user("klant@example.com")
        self.driver = make_user("driver@example.com", role=User.Role.DRIVER)
        self.other_driver = make_user("driver2@example.com", role=User.Role.DRIVER)
        self.client.force_authenticate(self.driver)

    def package(self, number, status):
        return Package.objects.create(
            user=self.customer,
            tracking_number=number,
            description="Dozen",
            delivery_address_text="Straat 1",
            status=status,
        )

    def get(self, package):
        return self.client.get(f"/api/driver/deliveries/{package.pk}/")

    def test_a_shipment_not_yet_arrived_is_a_404(self):
        quoted = self.package("PLSM-1", Package.Status.QUOTED)
        self.assertEqual(self.get(quoted).status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/driver/deliveries/{quoted.pk}/photo/").status_code, 404
        )

    def test_an_arrived_shipment_is_visible(self):
        self.assertEqual(self.get(self.package("PLSM-2", Package.Status.ARRIVED)).status_code, 200)

    def test_own_delivery_stays_visible_and_anothers_does_not(self):
        arrived = self.package("PLSM-3", Package.Status.ARRIVED)
        response = self.client.post(
            f"/api/driver/deliveries/{arrived.pk}/deliver/", {"recipient_name": "Buurman"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.get(arrived).status_code, 200)

        self.client.force_authenticate(self.other_driver)
        self.assertEqual(self.get(arrived).status_code, 404)

    def test_office_still_sees_everything(self):
        office = make_user("office@example.com", role=User.Role.OFFICE)
        self.client.force_authenticate(office)
        self.assertEqual(self.get(self.package("PLSM-4", Package.Status.QUOTED)).status_code, 200)


@override_settings(PASSWORD_RESET_MAILS_PER_ADDRESS=3)
class ResetMailFloodTests(ThrottleFreeAPITestCase):
    """Rotating client addresses to send one inbox endless reset mails."""

    def setUp(self):
        super().setUp()
        make_user("klant@example.com")

    def ask(self, email, n):
        return self.client.post(
            "/api/auth/password-reset/",
            {"email": email},
            format="json",
            HTTP_X_FORWARDED_FOR=f"10.0.0.{n}",
        )

    def test_mails_per_address_are_capped_and_the_answer_does_not_change(self):
        codes = [self.ask("klant@example.com", n).status_code for n in range(5)]
        self.assertEqual(codes, [204] * 5)
        self.assertEqual(len(mail.outbox), 3)

    def test_case_does_not_buy_more_mails(self):
        for n, email in enumerate(["klant@example.com", "KLANT@example.com", "Klant@Example.com", "klant@EXAMPLE.com"]):
            self.ask(email, n)
        self.assertEqual(len(mail.outbox), 3)

    def test_other_addresses_are_unaffected(self):
        make_user("ander@example.com")
        for n in range(4):
            self.ask("klant@example.com", n)
        self.ask("ander@example.com", 9)
        self.assertEqual(len(mail.outbox), 4)
        self.assertEqual(mail.outbox[-1].to, ["ander@example.com"])


class CaseInsensitiveEmailConstraintTests(ThrottleFreeAPITestCase):
    """The database itself refusing a second account for the same address."""

    def test_a_case_variant_cannot_be_saved_even_past_the_serializers(self):
        make_user("anna@example.com")
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_user("Anna@Example.com")

    def test_the_migration_refuses_existing_duplicates_readably(self):
        migration = importlib.import_module(
            "accounts.migrations.0022_user_email_case_insensitive_unique"
        )
        make_user("anna@example.com")
        # Clean data: the pre-check passes.
        migration.refuse_case_duplicates(django_apps, None)

        with patch.object(User.objects, "annotate") as annotate:
            annotate.return_value.values.return_value.annotate.return_value.filter.return_value.count.return_value = 2
            with self.assertRaisesMessage(RuntimeError, "2 e-mail address(es)"):
                migration.refuse_case_duplicates(django_apps, None)


class RequestOriginTests(ThrottleFreeAPITestCase):
    URL = "/api/staff/request-origin/"

    def test_admin_sees_the_headers_and_the_throttle_identity(self):
        self.client.force_authenticate(make_user("boss@example.com", role=User.Role.ADMIN))
        response = self.client.get(self.URL, HTTP_X_FORWARDED_FOR="203.0.113.9, 10.0.0.1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["x_forwarded_for"], "203.0.113.9, 10.0.0.1")
        # NUM_PROXIES unset: the whole header, spoofable part included.
        self.assertEqual(response.data["throttle_ident"], "203.0.113.9,10.0.0.1")

    @override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
    def test_num_proxies_picks_the_address_the_last_proxy_saw(self):
        # DRF reloads its settings on override_settings by itself.
        self.client.force_authenticate(make_user("boss@example.com", role=User.Role.ADMIN))
        response = self.client.get(self.URL, HTTP_X_FORWARDED_FOR="203.0.113.9, 10.0.0.1")
        self.assertEqual(response.data["throttle_ident"], "10.0.0.1")

    def test_office_and_customers_are_refused(self):
        for user in (make_user("office@example.com", role=User.Role.OFFICE), make_user("k@example.com")):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(self.URL).status_code, 403)


DATABASE_CACHE = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "test_security_cache",
        "OPTIONS": {"MAX_ENTRIES": 1_000_000},
    }
}


@override_settings(CACHES=DATABASE_CACHE, LOGIN_FAILURE_LIMIT=3)
class CacheFloodTests(ThrottleFreeAPITestCase):
    """Wiping a lockout by making the cache forget it.

    Run against the cache a deployment without Redis uses. The per-process
    memory cache this suite otherwise runs on holds 300 entries and is
    exactly what this attack worked against.
    """

    def setUp(self):
        call_command("createcachetable", verbosity=0)
        super().setUp()
        make_user("boss@example.com")

    def login(self, username, password, n):
        return self.client.post(
            "/api/auth/login/",
            {"username": username, "password": password},
            format="json",
            HTTP_X_FORWARDED_FOR=f"10.{n // 65536}.{n // 256 % 256}.{n % 256}",
        ).status_code

    def test_junk_usernames_do_not_unlock_an_account(self):
        self.assertEqual(
            [self.login("boss@example.com", "wrong", n) for n in range(4)],
            [401, 401, 401, 429],
        )
        for n in range(400):
            self.login(f"junk{n}", "wrong", 1000 + n)
        self.assertEqual(self.login("boss@example.com", PASSWORD, 9999), 429)

    def test_production_without_redis_uses_the_database_cache(self):
        self.assertIn("DatabaseCache", self._production_cache_backend())

    @staticmethod
    def _production_cache_backend():
        """The cache settings.py picks with DEBUG off and no REDIS_URL."""
        import os
        import subprocess
        import sys

        env = {
            **os.environ,
            "DJANGO_DEBUG": "0",
            "DJANGO_SECRET_KEY": "test-only-not-a-secret",
            "DATABASE_URL": "postgres://x:x@localhost:5432/x",
            "REDIS_URL": "",
        }
        return subprocess.run(
            [sys.executable, "-c", "from config import settings; print(settings.CACHES['default']['BACKEND'])"],
            env=env,
            capture_output=True,
            text=True,
            check=True,
            cwd=settings.BASE_DIR,
        ).stdout


class SpreadsheetFormulaTests(ThrottleFreeAPITestCase):
    def test_formula_names_are_neutralised(self):
        for name in ("=HYPERLINK(\"http://x\")", "+1", "-1", "@SUM(A1)", "\tx"):
            self.assertEqual(spreadsheet_safe(name), "'" + name)
        self.assertEqual(spreadsheet_safe("Anna B."), "Anna B.")
        self.assertEqual(spreadsheet_safe(3), 3)

    def test_csv_export_escapes_worker_names(self):
        report = {
            "columns": [{"key": "scans", "label": "Scans"}],
            "workers": [{"name": "=cmd()", "scans": 2}],
            "totals": {"scans": 2},
        }
        self.assertIn("'=cmd()", to_csv(report))


# ---------------------------------------------------------------------------
# Second review (October 2026): fixes and their regression tests.
# ---------------------------------------------------------------------------

CONTACT = {
    "name": "Jan Doe",
    "email": "jan@example.com",
    "subject": "Algemene vraag",
    "message": "Ik heb een vraag over verzenden naar Curacao.",
    "language": "nl",
}


class SiteWideCeilingTests(ThrottleFreeAPITestCase):
    """M1: a client rotating X-Forwarded-For dodges every per-IP throttle.

    The site-wide ceiling does not look at an address, so rotating it buys
    nothing. Each request below claims a different address.
    """

    def post_contact(self, index, body=None):
        return self.client.post(
            "/api/contact/",
            body if body is not None else CONTACT,
            format="json",
            HTTP_X_FORWARDED_FOR=f"203.0.113.{index}",
        )

    @override_settings(SITE_WIDE_LIMITS={"contact": 2})
    def test_rotating_addresses_still_meets_the_site_wide_ceiling(self):
        from enquiries.models import ContactMessage

        codes = [self.post_contact(i).status_code for i in range(4)]

        self.assertEqual(codes, [201, 201, 429, 429])
        self.assertEqual(ContactMessage.objects.count(), 2)

    @override_settings(SITE_WIDE_LIMITS={"contact": 2})
    def test_invalid_requests_do_not_use_up_the_budget(self):
        # A flood of junk must not lock real visitors out: only requests that
        # really created something are counted.
        for index in range(10):
            self.assertEqual(self.post_contact(index, body={"name": ""}).status_code, 400)

        self.assertEqual(self.post_contact(99).status_code, 201)

    @override_settings(SITE_WIDE_LIMITS={"signup": 1})
    def test_mass_signup_is_capped(self):
        def signup(email, index):
            return self.client.post(
                "/api/auth/signup/",
                {
                    "username": email,
                    "email": email,
                    "password": "a-long-enough-password-1",
                    "first_name": "Bot",
                    "last_name": "Account",
                    "phone_number": "+599 9 000 0000",
                },
                format="json",
                HTTP_X_FORWARDED_FOR=f"198.51.100.{index}",
            )

        self.assertEqual(signup("one@example.com", 1).status_code, 201)
        self.client.logout()
        self.assertEqual(signup("two@example.com", 2).status_code, 429)
        self.assertFalse(User.objects.filter(email="two@example.com").exists())


class PublicRequestSizeTests(ThrottleFreeAPITestCase):
    """M2: an anonymous booking could carry ~100 MB of files in one request."""

    @override_settings(PUBLIC_REQUEST_MAX_BYTES=1000)
    def test_oversized_public_request_is_refused_before_it_is_read(self):
        big = {**CONTACT, "message": "x" * 2000}
        response = self.client.post("/api/contact/", big, format="json")

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["code"], "request_too_large")

    @override_settings(PUBLIC_REQUEST_MAX_BYTES=1000)
    def test_booking_upload_endpoint_is_covered(self):
        response = self.client.post(
            "/api/bookings/", data=b"x" * 5000, content_type="multipart/form-data; boundary=x"
        )
        self.assertEqual(response.status_code, 413)

    @override_settings(PUBLIC_REQUEST_MAX_BYTES=1000)
    def test_a_normal_public_request_still_works(self):
        self.assertEqual(self.client.post("/api/contact/", CONTACT, format="json").status_code, 201)

    @override_settings(PUBLIC_REQUEST_MAX_BYTES=1000)
    def test_other_endpoints_are_not_limited(self):
        # The staff and warehouse APIs send larger batches on purpose.
        response = self.client.post(
            "/api/auth/login/", {"username": "x" * 2000, "password": "y"}, format="json"
        )
        self.assertNotEqual(response.status_code, 413)

    def test_a_public_post_without_a_length_is_refused(self):
        response = self.client.post("/api/contact/", CONTACT, format="json", CONTENT_LENGTH="")
        self.assertEqual(response.status_code, 411)


class NumProxiesCheckTests(ThrottleFreeAPITestCase):
    """M1: a deployment without DJANGO_NUM_PROXIES says so in its log."""

    def test_warns_in_production_without_num_proxies(self):
        from config.checks import check_num_proxies

        rest = {**settings.REST_FRAMEWORK, "NUM_PROXIES": None}
        with override_settings(DEBUG=False, REST_FRAMEWORK=rest):
            warnings = check_num_proxies(None)
        self.assertEqual([w.id for w in warnings], ["plsm.W001"])

    def test_silent_once_configured(self):
        from config.checks import check_num_proxies

        rest = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 2}
        with override_settings(DEBUG=False, REST_FRAMEWORK=rest):
            self.assertEqual(check_num_proxies(None), [])


class ReceiptContentTypeTests(ThrottleFreeAPITestCase):
    """L2: a receipt was served back with whatever type the uploader claimed."""

    def setUp(self):
        super().setUp()
        import shutil
        import tempfile

        media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=media)
        override.enable()
        self.addCleanup(override.disable)
        self.customer = make_user("bon@example.com")
        self.client.force_authenticate(self.customer)

    def test_claimed_html_type_is_not_stored_or_served(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from accounts.models import PackageDocument

        upload = SimpleUploadedFile(
            "bon.pdf", b"%PDF-1.4\n<html><script>alert(1)</script>", content_type="text/html"
        )
        response = self.client.post("/api/documents/", {"file": upload}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)

        document = PackageDocument.objects.get()
        self.assertEqual(document.content_type, "application/pdf")
        download = self.client.get(f"/api/documents/{document.pk}/file/")
        self.assertEqual(download["Content-Type"], "application/pdf")

    def test_rows_saved_before_the_fix_are_served_safely(self):
        from django.core.files.base import ContentFile

        from accounts.models import PackageDocument

        document = PackageDocument(
            customer=self.customer, original_name="bon.pdf", content_type="text/html", size_bytes=9
        )
        document.file.save("bon.pdf", ContentFile(b"%PDF-1.4\n"), save=True)

        download = self.client.get(f"/api/documents/{document.pk}/file/")
        self.assertEqual(download["Content-Type"], "application/pdf")


class PinRollingLimitTests(ThrottleFreeAPITestCase):
    """L3: a correct PIN reset the wrong-try counter, so a colleague could try
    four guesses after every one of the owner's sign-ins, indefinitely."""

    def setUp(self):
        super().setUp()
        from accounts import floor

        self.floor = floor
        self.worker = make_user("vloer@example.com", role=User.Role.WAREHOUSE)
        floor.set_pin(self.worker, "4826")

    def test_wrong_tries_add_up_across_correct_sign_ins(self):
        from accounts.models import WarehousePin

        for _ in range(3):  # 3 x (4 wrong + 1 right) = 12 wrong in total
            for _ in range(4):
                self.floor.pin_matches(self.worker, "9135")
            self.floor.pin_matches(self.worker, "4826")

        self.assertIsNotNone(WarehousePin.objects.get(user=self.worker).locked_at)
        self.assertFalse(self.floor.pin_matches(self.worker, "4826"))

    def test_a_new_pin_starts_with_a_clean_record(self):
        from accounts.models import WarehousePin

        for _ in range(2):
            for _ in range(4):
                self.floor.pin_matches(self.worker, "9135")
            self.floor.pin_matches(self.worker, "4826")

        self.floor.set_pin(self.worker, "5937")
        for _ in range(4):
            self.floor.pin_matches(self.worker, "9135")

        self.assertIsNone(WarehousePin.objects.get(user=self.worker).locked_at)
        self.assertTrue(self.floor.pin_matches(self.worker, "5937"))


class HiddenStatsTests(ThrottleFreeAPITestCase):
    """L4: the business figures were published even with the band hidden."""

    def test_hidden_band_returns_no_figures(self):
        from accounts.models import SiteSettings

        site = SiteSettings.load()
        site.show_stats_band = False
        site.save()

        self.assertEqual(self.client.get("/api/stats/").json(), {"visible": False})

    def test_visible_band_still_has_its_figures(self):
        from accounts.models import SiteSettings

        site = SiteSettings.load()
        site.show_stats_band = True
        site.save()

        data = self.client.get("/api/stats/").json()
        self.assertTrue(data["visible"])
        self.assertIn("customers", data)


class StaffEmailChangeNoticeTests(ThrottleFreeAPITestCase):
    """Office staff rewriting a customer's address hands them the account:
    the old address must be told."""

    def setUp(self):
        super().setUp()
        self.office = make_user("balie@example.com", role=User.Role.OFFICE)
        self.customer = make_user("oud@example.com")
        self.client.force_authenticate(self.office)

    def test_old_address_is_told(self):
        response = self.client.patch(
            f"/api/staff/customers/{self.customer.pk}/", {"email": "nieuw@example.com"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["oud@example.com"])
        self.assertIn("nieuw@example.com", mail.outbox[0].body)

    def test_no_mail_when_the_address_is_unchanged(self):
        self.client.patch(
            f"/api/staff/customers/{self.customer.pk}/", {"first_name": "Kees"}, format="json"
        )
        self.assertEqual(mail.outbox, [])
