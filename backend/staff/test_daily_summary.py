"""The office's daily summary (daily_summary.py): exact numbers, optional AI lines.

OpenAI is faked; no test talks to it.
"""

from datetime import timedelta
from io import StringIO
from types import SimpleNamespace
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from accounts.models import Package
from enquiries.models import ContactMessage

from . import daily_summary
from .tests import StaffApiTestCase

URL = reverse("staff-daily-summary")


def fake_ai(text):
    return mock.patch(
        "openai.OpenAI",
        **{"return_value.responses.create.return_value": SimpleNamespace(output_text=text, status="completed")},
    )


@override_settings(OPENAI_API_KEY="", ASSISTANT_AI_MODEL="gpt-test")
class DailySummaryTests(StaffApiTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        yesterday = timezone.now() - timedelta(days=1)
        # A message from yesterday, still unanswered (setUp's own is today's).
        old = ContactMessage.objects.create(name="A", email="a@example.com", subject="S", message="M")
        ContactMessage.objects.filter(pk=old.pk).update(created_at=yesterday)
        # A shipment stuck at "received" for three days: over its one-day limit.
        Package.objects.filter(pk=self.package.pk).update(
            warehouse_stage=Package.WarehouseStage.RECEIVED,
            warehouse_stage_at=timezone.now() - timedelta(days=3),
        )

    def test_counts_yesterday_and_what_is_waiting(self):
        data = daily_summary.build(timezone.localdate() - timedelta(days=1))
        self.assertEqual(data["day"]["messages"], 1)
        self.assertEqual(data["open"]["messages_unanswered"], 2)
        self.assertEqual(data["open"]["shipments_need_attention"], 1)
        self.assertEqual(
            data["attention"],
            [
                {
                    "tracking_number": "PLSM-0001",
                    "stage": "Package received",
                    "days_in_stage": 3,
                    "reason": "waiting too long in this stage",
                }
            ],
        )

    def test_staff_only(self):
        self.client.force_authenticate(self.customer)
        self.assertEqual(self.client.get(URL).status_code, status.HTTP_403_FORBIDDEN)

    def test_numbers_without_the_ai(self):
        self.client.force_authenticate(self.staff)
        with mock.patch("openai.OpenAI") as client_class:
            data = self.client.get(URL).json()
        self.assertEqual(data["open"]["messages_unanswered"], 2)
        self.assertNotIn("highlights", data)
        client_class.assert_not_called()

    @override_settings(OPENAI_API_KEY="test-key")
    def test_ai_lines_are_asked_for_once_and_kept(self):
        self.client.force_authenticate(self.staff)
        with fake_ai("- Answer the 2 open messages.") as client_class:
            first = self.client.get(URL, {"highlights": "1"}).json()
            second = self.client.get(URL, {"highlights": "1"}).json()
        self.assertEqual(first["highlights"], "- Answer the 2 open messages.")
        self.assertEqual(second["highlights"], first["highlights"])
        self.assertEqual(client_class.return_value.responses.create.call_count, 1)

        # Only counts and the attention list reach OpenAI: no names or e-mail addresses.
        sent = client_class.return_value.responses.create.call_args.kwargs["input"][0]["content"]
        self.assertNotIn("klant@example.com", sent)
        self.assertNotIn("Voorbeeld", sent)

    @override_settings(OPENAI_API_KEY="test-key")
    def test_a_failing_ai_leaves_the_numbers(self):
        self.client.force_authenticate(self.staff)
        with mock.patch("openai.OpenAI", side_effect=RuntimeError("down")):
            data = self.client.get(URL, {"highlights": "1"}).json()
        self.assertEqual(data["highlights"], "")
        self.assertEqual(data["open"]["messages_unanswered"], 2)

    @override_settings(OPENAI_API_KEY="test-key")
    def test_the_morning_email(self):
        self.staff.notify_warehouse = True
        self.staff.save()
        with fake_ai("- Start with PLSM-0001."):
            call_command("send_office_summary", stdout=StringIO())

        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        self.assertEqual(email.to, ["agent@example.com"])
        self.assertIn("Daily summary", email.subject)
        self.assertIn("- Start with PLSM-0001.", email.body)
        self.assertIn("Messages not answered: 2", email.body)
        self.assertIn("PLSM-0001 - Package received, 3 day(s)", email.body)
