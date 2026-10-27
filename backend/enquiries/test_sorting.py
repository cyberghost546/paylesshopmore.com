"""Sorting contact messages with AI (sorting.py), with OpenAI faked.

What matters: a message gets its topic, urgency and one-line summary; a
visitor never waits for the AI; nothing breaks when the AI is off or wrong;
and the office can put urgent ones first.
"""

import json
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from config.testing import ReauthenticatedAPIClient, ThrottleFreeAPITestCase

from .models import ContactMessage
from .sorting import sort_message

User = get_user_model()
ON = {"OPENAI_API_KEY": "test-key", "ASSISTANT_AI_MODEL": "gpt-test"}


def fake_ai(**answer):
    answer = {"topic": "damage", "urgency": "high", "summary": "Two boxes arrived broken on Bonaire.", **answer}
    return mock.patch(
        "openai.OpenAI",
        **{"return_value.responses.create.return_value": SimpleNamespace(output_text=json.dumps(answer))},
    )


def make_message(text="Mijn dozen zijn kapot aangekomen!", **extra):
    return ContactMessage.objects.create(name="Anna", email="anna@example.com", subject="Klacht", message=text, **extra)


@override_settings(**ON)
class SortingTests(ThrottleFreeAPITestCase):
    client_class = ReauthenticatedAPIClient

    def setUp(self):
        self.staff = User.objects.create_user(
            username="office@example.com", email="office@example.com", password="a-long-enough-password",
            is_staff=True,
        )

    def test_a_message_is_sorted_and_the_stranger_text_is_marked_as_data(self):
        message = make_message()
        with fake_ai() as client_class:
            self.assertTrue(sort_message(message))

        message.refresh_from_db()
        self.assertEqual((message.ai_topic, message.ai_urgency), ("damage", "high"))
        self.assertEqual(message.ai_summary, "Two boxes arrived broken on Bonaire.")
        self.assertIsNotNone(message.ai_sorted_at)
        sent = client_class.return_value.responses.create.call_args.kwargs
        self.assertIn("<message>\nMijn dozen zijn kapot aangekomen!\n</message>", sent["input"][0]["content"])
        self.assertIs(sent["store"], False)

    def test_a_wrong_or_failed_answer_leaves_it_unsorted(self):
        message = make_message()
        with fake_ai(topic="something-else"):
            self.assertFalse(sort_message(message))
        with mock.patch("openai.OpenAI", side_effect=RuntimeError("down")):
            self.assertFalse(sort_message(message))
        message.refresh_from_db()
        self.assertIsNone(message.ai_sorted_at)

    @override_settings(OPENAI_API_KEY="")
    def test_without_a_key_nothing_is_called(self):
        with mock.patch("openai.OpenAI") as client_class:
            self.assertFalse(sort_message(make_message()))
        client_class.assert_not_called()

    def test_the_visitor_never_waits_for_the_ai(self):
        # No Celery broker here (CELERY_TASK_ALWAYS_EAGER): sorting is left
        # for the Messages page, not done inside the visitor's request.
        with mock.patch("openai.OpenAI") as client_class:
            response = self.client.post(
                reverse("contact"),
                {"name": "Anna", "email": "anna@example.com", "subject": "Algemene vraag",
                 "message": "Hoeveel kost een doos?", "language": "nl"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        client_class.assert_not_called()
        self.assertIsNone(ContactMessage.objects.get().ai_sorted_at)

    def test_the_office_page_sorts_the_unsorted_ones(self):
        make_message()
        already = make_message(ai_topic="price", ai_urgency="low")
        ContactMessage.objects.filter(pk=already.pk).update(ai_sorted_at="2026-10-01T10:00:00Z")

        self.client.force_authenticate(self.staff)
        with fake_ai() as client_class:
            response = self.client.post(reverse("staff-message-sort"))
        self.assertEqual(response.json(), {"sorted": 1})
        self.assertEqual(client_class.return_value.responses.create.call_count, 1)

    def test_customers_cannot_sort(self):
        customer = User.objects.create_user(username="c@example.com", email="c@example.com", password="x" * 20)
        self.client.force_authenticate(customer)
        self.assertEqual(self.client.post(reverse("staff-message-sort")).status_code, status.HTTP_403_FORBIDDEN)

    def test_urgent_first_and_filter_by_topic(self):
        low = make_message("Wat zijn jullie openingstijden?", ai_topic="other", ai_urgency="low")
        urgent = make_message("Kapot!", ai_topic="damage", ai_urgency="high")
        unsorted = make_message("Prijs?")
        self.client.force_authenticate(self.staff)

        rows = self.client.get(reverse("staff-message-list"), {"ordering": "urgency"}).json()["results"]
        self.assertEqual([row["id"] for row in rows], [urgent.pk, unsorted.pk, low.pk])
        self.assertEqual(rows[0]["ai_topic"], "damage")

        rows = self.client.get(reverse("staff-message-list"), {"ai_topic": "damage"}).json()["results"]
        self.assertEqual([row["id"] for row in rows], [urgent.pk])

    @override_settings(CELERY_TASK_ALWAYS_EAGER=False)
    def test_with_a_worker_it_is_sorted_in_the_background(self):
        with mock.patch("enquiries.tasks.sort_contact_message.delay") as delay, self.captureOnCommitCallbacks(
            execute=True
        ):
            response = self.client.post(
                reverse("contact"),
                {"name": "Anna", "email": "anna@example.com", "subject": "Algemene vraag",
                 "message": "Hoeveel kost een doos?", "language": "nl"},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        delay.assert_called_once_with(ContactMessage.objects.get().pk)
