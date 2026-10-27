"""Answering a contact message from the dashboard (enquiries/replies.py).

What matters:
  * staff can reply, the e-mail goes to the sender with the original quoted,
    and the message is then marked handled;
  * when the mail server fails, the reply is still saved, marked "not sent",
    and the message stays open;
  * a customer (not staff) cannot reply, and an empty reply is refused.
"""

from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from config.testing import ReauthenticatedAPIClient

from .models import ContactMessage, ContactReply

User = get_user_model()


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    OFFICE_REPLY_TO_EMAIL="office@example.com",
)
class ReplyTests(APITestCase):
    client_class = ReauthenticatedAPIClient

    def setUp(self):
        self.staff = User.objects.create_user(
            username="agent@example.com",
            email="agent@example.com",
            password="a-long-enough-password",
            first_name="Back",
            last_name="Office",
            is_staff=True,
        )
        self.customer = User.objects.create_user(
            username="klant@example.com",
            email="klant@example.com",
            password="a-long-enough-password",
        )
        self.message = ContactMessage.objects.create(
            name="Anna",
            email="anna@example.com",
            subject="Prijs",
            message="Hoeveel kost een doos?\nNaar Curaçao.",
            language="nl",
        )
        self.url = f"/api/staff/messages/{self.message.pk}/reply/"

    def test_staff_reply_is_emailed_and_marks_the_message_handled(self):
        self.client.force_authenticate(self.staff)

        response = self.client.post(self.url, {"body": "Beste Anna, dat is 45 euro."}, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["handled"])
        reply = response.data["replies"][-1]
        self.assertTrue(reply["sent"])
        self.assertEqual(reply["author_name"], "Back Office")

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.to, ["anna@example.com"])
        self.assertEqual(sent.reply_to, ["office@example.com"])
        self.assertEqual(sent.subject, "Re: Prijs")
        self.assertIn("Beste Anna, dat is 45 euro.", sent.body)
        # The original, quoted line by line.
        self.assertIn("> Hoeveel kost een doos?\n> Naar Curaçao.", sent.body)

    def test_a_failed_send_is_saved_and_leaves_the_message_open(self):
        self.client.force_authenticate(self.staff)

        with mock.patch(
            "django.core.mail.EmailMessage.send", side_effect=OSError("Connection refused")
        ):
            response = self.client.post(self.url, {"body": "Hallo"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data["handled"])
        reply = response.data["replies"][-1]
        self.assertFalse(reply["sent"])
        self.assertEqual(reply["send_error"], "Connection refused")
        self.assertEqual(ContactReply.objects.count(), 1)

    def test_an_empty_reply_is_refused(self):
        self.client.force_authenticate(self.staff)

        response = self.client.post(self.url, {"body": "   "}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ContactReply.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_a_customer_cannot_reply(self):
        self.client.force_authenticate(self.customer)

        response = self.client.post(self.url, {"body": "Hallo"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(len(mail.outbox), 0)

    def test_the_message_list_shows_the_replies(self):
        ContactReply.objects.create(message=self.message, author=self.staff, body="Eerder antwoord")
        self.client.force_authenticate(self.staff)

        response = self.client.get("/api/staff/messages/")

        row = response.data["results"][0]
        self.assertEqual(row["replies"][0]["body"], "Eerder antwoord")
        self.assertFalse(row["replies"][0]["sent"])
