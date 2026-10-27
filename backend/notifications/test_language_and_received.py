"""Shipment e-mails in the customer's language, and the "received" notice.

Notifications are e-mailed from a transaction.on_commit hook, so each test
that expects mail runs the hooks with captureOnCommitCallbacks(execute=True).
"""

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase

from accounts.models import Package
from accounts.warehouse import move_warehouse_stage
from config.testing import ThrottleFreeAPITestCase

from .messages import body_for, subject_for
from .models import Notification
from .services import notify_shipment_status

User = get_user_model()
Stage = Package.WarehouseStage


def make_customer(email="klant@example.com", language="", **extra):
    return User.objects.create_user(
        username=email,
        email=email,
        password="a-long-enough-password",
        first_name="Kees",
        last_name="Klant",
        language=language,
        **extra,
    )


def make_package(user, number="PLSM-1001", **extra):
    return Package.objects.create(user=user, tracking_number=number, **extra)


class ShipmentMailLanguageTests(TestCase):
    def mail_for(self, language):
        customer = make_customer(language=language)
        package = make_package(customer)
        with self.captureOnCommitCallbacks(execute=True):
            notify_shipment_status(package, Package.Status.QUOTED)
            package.status = Package.Status.IN_TRANSIT
            package.save()
            notify_shipment_status(package, Package.Status.QUOTED)
        return mail.outbox[-1]

    def test_dutch(self):
        message = self.mail_for("nl")
        self.assertEqual(message.subject, "Uw zending is onderweg (PLSM-1001)")
        self.assertIn("Beste Kees Klant,", message.body)
        self.assertIn("Trackingnummer: PLSM-1001", message.body)

    def test_english(self):
        message = self.mail_for("en")
        self.assertEqual(message.subject, "Your shipment is on its way (PLSM-1001)")
        self.assertIn("Hello Kees Klant,", message.body)

    def test_papiamentu(self):
        message = self.mail_for("pap")
        self.assertEqual(message.subject, "Bo enbio ta na kaminda (PLSM-1001)")
        self.assertIn("Kerido Kees Klant,", message.body)

    def test_no_language_yet_is_written_in_dutch(self):
        # The site's default, and what the password-reset mail falls back to.
        message = self.mail_for("")
        self.assertTrue(message.subject.startswith("Uw zending is onderweg"))

    def test_every_language_has_every_status(self):
        from .messages import MESSAGES

        statuses = set(MESSAGES["en"]["subjects"])
        for language, copy in MESSAGES.items():
            self.assertEqual(set(copy["subjects"]), statuses, language)
            self.assertEqual(set(copy["lines"]), statuses, language)
            self.assertEqual(set(copy), set(MESSAGES["en"]), language)

    def test_invoice_mail_is_translated_too(self):
        customer = make_customer(language="nl")
        package = make_package(customer)
        notification = Notification.objects.create(
            user=customer,
            kind=Notification.Kind.INVOICE_SENT,
            package=package,
            context={"invoice_number": "2026-0042", "tracking_number": "PLSM-1001"},
        )
        self.assertEqual(subject_for(notification), "Factuur 2026-0042")
        self.assertIn("Uw factuur 2026-0042 staat klaar.", body_for(notification))


class ReceivedNotificationTests(TestCase):
    def test_the_customer_hears_once_when_the_warehouse_receives_it(self):
        customer = make_customer(language="en")
        package = make_package(customer, status=Package.Status.PAID)

        with self.captureOnCommitCallbacks(execute=True):
            move_warehouse_stage(package, Stage.RECEIVED)
            move_warehouse_stage(package, Stage.AWAITING_MEASUREMENT)
            move_warehouse_stage(package, Stage.PACKED)

        received = Notification.objects.filter(user=customer, context__status="received")
        self.assertEqual(received.count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Your shipment has arrived at our warehouse (PLSM-1001)")

    def test_not_when_it_goes_straight_to_shipped(self):
        # The office marked it in transit; that has its own notification.
        package = make_package(make_customer(), status=Package.Status.IN_TRANSIT)

        with self.captureOnCommitCallbacks(execute=True):
            move_warehouse_stage(package, Stage.SHIPPED)

        self.assertFalse(Notification.objects.filter(context__status="received").exists())

    def test_the_shipping_preference_is_respected(self):
        customer = make_customer(notify_shipping=False)
        package = make_package(customer, status=Package.Status.PAID)

        with self.captureOnCommitCallbacks(execute=True):
            move_warehouse_stage(package, Stage.RECEIVED)

        # Still in the bell, but no e-mail.
        self.assertTrue(Notification.objects.filter(user=customer, context__status="received").exists())
        self.assertEqual(mail.outbox, [])


class ProfileLanguageTests(ThrottleFreeAPITestCase):
    def setUp(self):
        super().setUp()
        self.customer = make_customer()
        self.client.force_authenticate(self.customer)

    def test_the_site_can_store_the_language(self):
        response = self.client.patch("/api/profile/", {"language": "pap"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["language"], "pap")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.language, "pap")

    def test_only_supported_languages(self):
        response = self.client.patch("/api/profile/", {"language": "de"}, format="json")
        self.assertEqual(response.status_code, 400)
