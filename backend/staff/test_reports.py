"""The monthly report (staff/reports.py).

What matters: rows are counted in the month they belong to (not the month
before or after), the previous month is there for comparison, invoices are
added up exactly, the chart has 12 months, and only staff can read it.
"""

from datetime import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Package
from bookings.models import Booking
from config.testing import ReauthenticatedAPIClient
from invoicing.models import Invoice

from .reports import add_months, parse_month

User = get_user_model()

URL = "/api/staff/reports/monthly/"


def at(year, month, day):
    return timezone.make_aware(datetime(year, month, day, 12, 0))


class MonthMathTests(APITestCase):
    def test_add_months_crosses_the_year(self):
        self.assertEqual(add_months(2026, 1, -1), (2025, 12))
        self.assertEqual(add_months(2026, 12, 1), (2027, 1))
        self.assertEqual(add_months(2026, 10, -11), (2025, 11))

    def test_parse_month_falls_back_to_this_month(self):
        today = timezone.localdate()
        self.assertEqual(parse_month("2026-10"), (2026, 10))
        self.assertEqual(parse_month("rubbish"), (today.year, today.month))
        self.assertEqual(parse_month("2026-13"), (today.year, today.month))


class MonthlyReportTests(APITestCase):
    client_class = ReauthenticatedAPIClient

    def setUp(self):
        self.staff = User.objects.create_user(
            username="agent@example.com", email="agent@example.com", password="x" * 20, is_staff=True
        )
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com", password="x" * 20
        )

    def booking(self, when, destination="CW", weight=None, status_=Booking.Status.NEW):
        booking = Booking.objects.create(
            destination=destination,
            sender_first_name="A",
            sender_last_name="B",
            weight_kg=weight,
            status=status_,
        )
        # created_at is auto_now_add, so it is moved afterwards.
        Booking.objects.filter(pk=booking.pk).update(created_at=when)
        return booking

    def package(self, number, shipped=None, weight=None, value=None):
        return Package.objects.create(
            user=self.customer,
            tracking_number=number,
            description="Doos",
            weight_kg=weight,
            value_eur=value,
            shipped_at=shipped,
        )

    def sent_invoice(self, package, when):
        """A sent invoice, with everything the database insists a sent one has."""
        return Invoice.objects.create(
            package=package,
            status=Invoice.Status.SENT,
            sent_at=when,
            reviewed_by=self.staff,
            reviewed_at=when,
            pdf="invoices/test.pdf",
        )

    def test_counts_the_right_month_and_the_month_before(self):
        self.booking(at(2026, 10, 3), "CW", Decimal("10.5"))
        self.booking(at(2026, 10, 20), "CW", Decimal("4"))
        self.booking(at(2026, 10, 21), "AW", status_=Booking.Status.CANCELLED)
        self.booking(at(2026, 9, 30), "BQ")  # previous month
        self.booking(at(2026, 11, 1), "BQ")  # next month: not counted

        self.package("PLSM-1", shipped=at(2026, 10, 5), weight=Decimal("20"))
        self.package("PLSM-2", shipped=at(2026, 10, 6), weight=Decimal("10"))
        self.package("PLSM-3", shipped=at(2026, 10, 7))  # no weight: not in the average

        self.client.force_authenticate(self.staff)
        response = self.client.get(URL, {"month": "2026-10"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data
        self.assertEqual(data["month"], "2026-10")
        self.assertEqual(data["previous_month"], "2026-09")
        self.assertEqual(data["current"]["bookings"], 3)
        self.assertEqual(data["current"]["bookings_cancelled"], 1)
        self.assertEqual(data["previous"]["bookings"], 1)
        self.assertEqual(data["current"]["packages_shipped"], 3)
        self.assertEqual(data["current"]["weight_shipped_kg"], 30.0)
        self.assertEqual(data["current"]["average_weight_kg"], 15.0)

        self.assertEqual(
            data["by_destination"][0],
            {"destination": "CW", "label": "Curaçao", "bookings": 2, "weight_kg": 14.5},
        )

        self.assertEqual(len(data["months"]), 12)
        self.assertEqual(data["months"][0]["month"], "2025-11")
        self.assertEqual(data["months"][-1]["month"], "2026-10")
        self.assertEqual(data["months"][-1]["bookings"], 3)
        self.assertEqual(data["months"][-2]["bookings"], 1)

    def test_adds_up_the_invoices_sent_that_month(self):
        first = self.package("PLSM-10", value=Decimal("100.25"))
        second = self.package("PLSM-11", value=Decimal("49.75"))
        draft = self.package("PLSM-12", value=Decimal("999"))
        self.sent_invoice(first, at(2026, 10, 2))
        self.sent_invoice(second, at(2026, 10, 9))
        Invoice.objects.create(package=draft)  # never sent: not counted

        self.client.force_authenticate(self.staff)
        data = self.client.get(URL, {"month": "2026-10"}).data

        self.assertEqual(data["current"]["invoices_sent"], 2)
        self.assertEqual(data["current"]["invoiced"], "150.00")
        self.assertEqual(data["months"][-1]["invoiced"], "150.00")

    def test_only_staff_can_read_it(self):
        self.client.force_authenticate(self.customer)
        self.assertEqual(self.client.get(URL).status_code, status.HTTP_403_FORBIDDEN)
