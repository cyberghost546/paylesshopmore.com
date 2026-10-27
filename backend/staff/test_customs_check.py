"""The customs paperwork check (customs_check.py).

The rules are tested with real rows; the AI's notes with OpenAI faked.
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from accounts.models import Package, PackageDocument
from bookings.models import Booking, BookingOrder
from docreview.models import DocumentJob

from . import customs_check
from .tests import StaffApiTestCase


def codes(result):
    return {item["code"] for item in result["issues"]}


class CustomsCheckTests(StaffApiTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()
        Package.objects.filter(pk=self.package.pk).update(
            status=Package.Status.READY_FOR_SHIPPING, value_eur=Decimal("200.00")
        )
        self.package.refresh_from_db()

    def read_invoice(self, total, currency="EUR", number="F-1", status=DocumentJob.Status.LINKED):
        """An invoice the document reader has read and linked to the shipment."""
        return DocumentJob.objects.create(
            source=DocumentJob.Source.STAFF_UPLOAD,
            status=status,
            dedupe_key=f"test:{DocumentJob.objects.count()}",
            package=self.package,
            extracted={
                "document_type": "shop_invoice",
                "shop_name": "bol.com",
                "summary": "Invoice for a laptop",
                "total_amount": total,
                "currency": currency,
                "invoice_number": number,
            },
        )

    def test_nothing_at_all_is_missing(self):
        Package.objects.filter(pk=self.package.pk).update(value_eur=None)
        self.package.refresh_from_db()
        result = customs_check.check(self.package)
        self.assertEqual(result["verdict"], "missing")
        self.assertEqual(codes(result), {"no_invoice", "no_value"})

    def test_matching_invoice_is_ok(self):
        self.read_invoice("199.00")
        result = customs_check.check(self.package)
        self.assertEqual(result["verdict"], "ok", result["issues"])
        self.assertEqual(result["invoices_eur"], "199.00")

    def test_a_value_far_from_the_invoices_needs_a_look(self):
        self.read_invoice("120.00", number="F-1")
        # The same invoice sent in twice: counted once, so EUR 120 and not 240
        # (which would have matched the declared 200 within the tolerance).
        self.read_invoice("120.00", number="F-1")
        result = customs_check.check(self.package)
        self.assertEqual(result["verdict"], "check")
        self.assertEqual(codes(result), {"value_mismatch"})
        self.assertIn("EUR 120.00", result["issues"][0]["message"])

    def test_foreign_currency_and_documents_waiting_for_review(self):
        self.read_invoice("150.00", currency="USD", number="US-1")
        self.read_invoice("200.00", number="F-2", status=DocumentJob.Status.NEEDS_REVIEW)
        self.assertEqual(codes(customs_check.check(self.package)), {"other_currency", "documents_to_review"})

    def test_a_receipt_the_customer_sent_counts_as_proof(self):
        PackageDocument.objects.create(
            customer=self.customer, package=self.package, kind=PackageDocument.Kind.RECEIPT,
            file="documents/x.pdf", original_name="bon.pdf", content_type="application/pdf",
        )
        self.assertNotIn("no_invoice", codes(customs_check.check(self.package)))

    def test_emigration_without_its_papers_is_missing(self):
        self.read_invoice("200.00")
        booking = Booking.objects.create(
            package=self.package, emigration=True, id_present=True, deregistered=False,
            sender_first_name="A", sender_last_name="B", recipient_first_name="C", recipient_last_name="D",
            signature_name="A B", agreed_terms=True,
        )
        BookingOrder.objects.create(booking=booking, shop_name="IKEA", description="Kast")
        result = customs_check.check(self.package)
        self.assertEqual(result["verdict"], "missing")
        self.assertIn("emigration_papers", codes(result))
        self.assertIn("proof of deregistration", " ".join(item["message"] for item in result["issues"]))
        # The order has no screenshot either.
        self.assertIn("order_without_proof", codes(result))

    def test_the_endpoint_is_staff_only_and_reads_nothing_into_the_ai_by_default(self):
        url = reverse("staff-package-customs-check", args=[self.package.pk])
        self.client.force_authenticate(self.customer)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.staff)
        with mock.patch("openai.OpenAI") as client_class:
            data = self.client.get(url).json()
        self.assertEqual(data["verdict"], "missing")
        self.assertNotIn("ai_notes", data)
        client_class.assert_not_called()

    @override_settings(OPENAI_API_KEY="test-key", ASSISTANT_AI_MODEL="gpt-test")
    def test_ai_notes_see_descriptions_and_amounts_but_no_customer(self):
        self.read_invoice("199.00")
        url = reverse("staff-package-customs-check", args=[self.package.pk])
        self.client.force_authenticate(self.staff)
        answer = SimpleNamespace(output_text="- Declared as boxes, but the invoice is for a laptop.")
        with mock.patch("openai.OpenAI") as client_class:
            client_class.return_value.responses.create.return_value = answer
            data = self.client.get(url, {"ai": "1"}).json()

        self.assertEqual(data["ai_notes"], "- Declared as boxes, but the invoice is for a laptop.")
        self.assertEqual(data["verdict"], "ok")  # the AI never changes the verdict
        sent = client_class.return_value.responses.create.call_args.kwargs["input"][0]["content"]
        self.assertIn("Invoice for a laptop", sent)
        self.assertNotIn("klant@example.com", sent)
        self.assertNotIn("Voorbeeld", sent)

    def test_the_daily_summary_lists_shipments_not_ready(self):
        from datetime import timedelta

        from django.utils import timezone

        from . import daily_summary

        data = daily_summary.build(timezone.localdate() - timedelta(days=1))
        self.assertEqual(data["open"]["paperwork_missing"], 1)
        self.assertEqual(data["customs"][0]["tracking_number"], "PLSM-0001")
        self.assertIn("Not ready for customs:", daily_summary.to_text(data))
