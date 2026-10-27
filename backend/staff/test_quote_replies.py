"""Answering a quote request from the dashboard, and "Write with AI" on it.

OpenAI is faked; no test talks to it.
"""

from types import SimpleNamespace
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from enquiries.models import QuoteReply, QuoteRequest

from .tests import StaffApiTestCase


class QuoteReplyTests(StaffApiTestCase):
    def url(self, name):
        return reverse(f"staff-quote-{name}", args=[self.quote.pk])

    def test_a_reply_is_emailed_saved_and_marks_the_quote_sent(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(self.url("reply"), {"body": "Beste Voorbeeld, de prijs is EUR 240."}, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["status"], QuoteRequest.Status.QUOTED)
        self.assertEqual(len(data["replies"]), 1)
        self.assertTrue(data["replies"][0]["sent"])

        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        self.assertEqual(email.to, ["klant@example.com"])
        self.assertIn("Curaçao", email.subject)
        self.assertIn("EUR 240", email.body)
        # Their own request, quoted below the answer.
        self.assertIn("> Graag een offerte voor twee dozen.", email.body)

    def test_a_failed_email_keeps_the_reply_and_the_status(self):
        self.client.force_authenticate(self.staff)
        with mock.patch("django.core.mail.EmailMessage.send", side_effect=ConnectionRefusedError("refused")):
            response = self.client.post(self.url("reply"), {"body": "Hallo"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        reply = QuoteReply.objects.get()
        self.assertIsNone(reply.emailed_at)
        self.assertIn("refused", reply.send_error)
        self.quote.refresh_from_db()
        self.assertEqual(self.quote.status, QuoteRequest.Status.NEW)

    def test_an_empty_reply_is_refused(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(self.url("reply"), {"body": "  "}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(QuoteReply.objects.exists())

    def test_customers_cannot_reply_or_draft(self):
        self.client.force_authenticate(self.customer)
        for name in ("reply", "draft-reply"):
            with self.subTest(name=name):
                response = self.client.post(self.url(name), {"body": "Hi"}, format="json")
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(OPENAI_API_KEY="test-key", ASSISTANT_AI_MODEL="gpt-test")
    def test_write_with_ai_leaves_the_price_to_staff_and_sends_nothing(self):
        self.client.force_authenticate(self.staff)
        answer = SimpleNamespace(output_text="Beste Voorbeeld, de prijs is [price].", status="completed")
        with mock.patch("openai.OpenAI") as client_class:
            client_class.return_value.responses.create.return_value = answer
            response = self.client.post(self.url("draft-reply"))

        self.assertEqual(response.json(), {"body": "Beste Voorbeeld, de prijs is [price]."})
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(QuoteReply.objects.exists())

        sent = client_class.return_value.responses.create.call_args.kwargs
        self.assertIn("QUOTE REQUEST", sent["instructions"])
        self.assertIn("Destination: Curaçao", sent["input"][0]["content"])
        self.assertIn("<message>\nGraag een offerte voor twee dozen.\n</message>", sent["input"][0]["content"])

    @override_settings(OPENAI_API_KEY="")
    def test_write_with_ai_without_a_key_is_a_503(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(self.url("draft-reply"))
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
