"""Reading a parcel's label with AI on the intake sheet (label_ai.py).

OpenAI is faked; no test talks to it. What matters: the boxes come back
filled, a number is only used when it is really on the label, the match is
our own lookup with nothing private in it, and only the warehouse and the
office can use it.
"""

import json
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from accounts.models import Package
from config.testing import WarehouseAPITestCase

from .models import IntakeSheet

User = get_user_model()
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
URL = reverse("staff-intake-read-label")


def label(**overrides):
    return {
        "lines": ["bol.com", "Papendorpseweg 100, Utrecht", "M. Martina", "Pay less Shop More", "PLSM-00077"],
        "supplier": "bol.com",
        "sender": "bol.com, Papendorpseweg 100, Utrecht",
        "recipient": "M. Martina, Pay less Shop More, Hertzstraat 10, Berkel en Rodenrijs",
        "destination": "",
        "tracking_number": "PLSM-00077",
        "customer_code": "",
        **overrides,
    }


@override_settings(OPENAI_API_KEY="test-key", DOCUMENT_AI_MODEL="gpt-test")
class LabelReadingTests(WarehouseAPITestCase):
    def setUp(self):
        self.floor = User.objects.create_user(
            username="vloer@example.com", email="vloer@example.com", password="a-long-enough-password",
            is_warehouse=True,
        )
        self.customer = User.objects.create_user(
            username="maria@example.com", email="maria@example.com", password="a-long-enough-password",
            first_name="Maria", last_name="Martina", phone_number="+599 9 123 4567",
        )
        Package.objects.create(user=self.customer, tracking_number="PLSM-00077", description="2 boxes")

    def read(self, answer, user=None, file=None):
        self.client.force_authenticate(user or self.floor)
        with mock.patch("openai.OpenAI") as client_class:
            client_class.return_value.responses.create.return_value = SimpleNamespace(output_text=json.dumps(answer))
            photo = file or SimpleUploadedFile("label.jpg", JPEG)
            response = self.client.post(URL, {"file": photo}, format="multipart")
        return response, client_class

    def test_the_boxes_come_back_filled_with_our_match(self):
        response, _ = self.read(label())
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["fields"]["supplier"], "bol.com")
        self.assertEqual(data["tracking_number"], "PLSM-00077")
        self.assertIn("M. Martina", data["fields"]["recipient"])
        self.assertEqual(data["lines"][0], "bol.com")
        self.assertEqual(data["match"]["kind"], "shipment")
        self.assertEqual(data["match"]["customer"], "Maria Martina")
        # Nothing the floor does not need: no e-mail, no phone.
        self.assertNotIn("maria@example.com", response.content.decode())
        self.assertNotIn("123 4567", response.content.decode())
        # Nothing is saved.
        self.assertFalse(IntakeSheet.objects.exists())

    def test_a_number_that_is_not_on_the_label_is_not_used(self):
        response, _ = self.read(label(tracking_number="PLSM-00099"))
        data = response.json()
        self.assertEqual(data["tracking_number"], "")
        self.assertIsNone(data["match"])

    def test_a_customer_number_on_the_label_finds_the_customer(self):
        code = self.customer.customer_code
        response, _ = self.read(label(tracking_number="", customer_code=code, lines=["M. Martina", code]))
        match = response.json()["match"]
        self.assertEqual(match["kind"], "customer")
        self.assertEqual(match["customer"], "Maria Martina")

    def test_only_images_and_pdfs(self):
        response, client_class = self.read(label(), file=SimpleUploadedFile("label.exe", b"MZ\x90\x00"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        client_class.assert_not_called()

    def test_customers_cannot_use_it(self):
        response, client_class = self.read(label(), user=self.customer)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        client_class.assert_not_called()

    @override_settings(OPENAI_API_KEY="")
    def test_without_a_key_it_is_a_503_and_the_page_reads_on_the_device(self):
        response, _ = self.read(label())
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
