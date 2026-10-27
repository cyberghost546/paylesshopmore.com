"""The monthly report for the office dashboard (pages/Dashboard/Reports.jsx).

READ THIS FIRST
---------------
    GET /api/staff/reports/monthly/?month=2026-10

answers "how did October go?" in one request:

    current        the figures for the chosen month (see month_figures)
    previous       the same figures for the month before, so the page can
                   show "+12% compared with September"
    by_destination bookings per island that month, with their total weight
    by_freight     bookings per kind of freight (sea / air)
    months         the last 12 months up to the chosen one, for the chart

Without ?month= it reports on the current month (which is then still running).

Where each number comes from - one line each, so it is easy to check:

    bookings            Booking rows CREATED in the month (any status)
    bookings_cancelled  ...of which are now cancelled
    quotes              QuoteRequest rows created in the month
    messages            ContactMessage rows created in the month
    packages_received   Package rows created in the month
    packages_shipped    Packages whose shipped_at is in the month
    packages_delivered  Packages whose delivered_at is in the month
    weight_shipped_kg   total weight of the packages shipped in the month
    average_weight_kg   weight_shipped_kg / packages shipped that have a weight
    invoices_sent       Invoices whose sent_at is in the month
    invoiced            the sum of what those invoices ask ("Totaal te betalen")
    new_customers       accounts created in the month (not deleted/anonymised)

Months are calendar months in the site's time zone (settings.TIME_ZONE).
Money is sent as a string ("1234.50") so no cents get lost on the way, the
same as everywhere else in this API.
"""

from datetime import datetime
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Package
from bookings.models import Booking
from enquiries.models import ContactMessage, QuoteRequest
from invoicing.models import Invoice

from .permissions import IsStaff

User = get_user_model()

# How many months the chart goes back, including the chosen month.
CHART_MONTHS = 12


# ---------------------------------------------------------------- month maths


def parse_month(value):
    """'2026-10' -> (2026, 10). Empty or nonsense -> the current month.

    Nonsense falls back rather than erroring, the same way the overview's
    ?days= does: a stale bookmark should still open a working page.
    """
    try:
        year, month = (int(part) for part in str(value).split("-"))
        if 2000 <= year <= 2100 and 1 <= month <= 12:
            return year, month
    except ValueError:
        pass
    today = timezone.localdate()
    return today.year, today.month


def add_months(year, month, count):
    """Move `count` months forward (or back, when negative).

    Example: add_months(2026, 1, -1) -> (2025, 12)
    """
    index = year * 12 + (month - 1) + count
    return index // 12, index % 12 + 1


def month_start(year, month):
    """Midnight on the 1st of the month, in the site's time zone."""
    return timezone.make_aware(datetime(year, month, 1))


def month_key(year, month):
    return f"{year:04d}-{month:02d}"


# ------------------------------------------------------------------- figures


def invoice_total(invoice):
    """What one invoice asks the customer to pay, as a Decimal (0 when unknown)."""
    amount = invoice.amount_due
    return Decimal(amount) if amount is not None else Decimal("0")


def sent_invoices(start, end):
    """Invoices sent in [start, end), with what amount_due needs loaded up front.

    amount_due reads the package (old-style invoices) or the lines (composed
    ones); without select/prefetch that is one or two queries per invoice.
    """
    return (
        Invoice.objects.filter(sent_at__gte=start, sent_at__lt=end)
        .select_related("package")
        .prefetch_related("lines")
    )


def month_figures(start, end):
    """Every number in the report's cards, for the month [start, end)."""
    bookings = Booking.objects.filter(created_at__gte=start, created_at__lt=end)
    shipped = Package.objects.filter(shipped_at__gte=start, shipped_at__lt=end)
    # One query for the shipped packages: how many, how many have a weight,
    # and what they weigh together.
    shipped_numbers = shipped.aggregate(
        count=Count("id"),
        weighed=Count("id", filter=Q(weight_kg__isnull=False)),
        weight=Sum("weight_kg"),
    )
    weight = shipped_numbers["weight"] or Decimal("0")
    invoices = list(sent_invoices(start, end))

    return {
        "bookings": bookings.count(),
        "bookings_cancelled": bookings.filter(status=Booking.Status.CANCELLED).count(),
        "quotes": QuoteRequest.objects.filter(created_at__gte=start, created_at__lt=end).count(),
        "messages": ContactMessage.objects.filter(created_at__gte=start, created_at__lt=end).count(),
        "packages_received": Package.objects.filter(created_at__gte=start, created_at__lt=end).count(),
        "packages_shipped": shipped_numbers["count"],
        "packages_delivered": Package.objects.filter(
            delivered_at__gte=start, delivered_at__lt=end
        ).count(),
        "weight_shipped_kg": round(float(weight), 1),
        "average_weight_kg": (
            round(float(weight) / shipped_numbers["weighed"], 1) if shipped_numbers["weighed"] else None
        ),
        "invoices_sent": len(invoices),
        "invoiced": str(sum((invoice_total(invoice) for invoice in invoices), Decimal("0.00"))),
        # The same filter as the overview's customer count: an anonymised row
        # is a deleted customer, kept only to hold their shipments together.
        "new_customers": User.objects.filter(
            is_active=True,
            anonymised_at__isnull=True,
            date_joined__gte=start,
            date_joined__lt=end,
        ).count(),
    }


def bookings_by_destination(start, end):
    """[{destination: 'CW', label: 'Curaçao', bookings: 4, weight_kg: 51.5}, ...], busiest first."""
    rows = (
        Booking.objects.filter(created_at__gte=start, created_at__lt=end)
        .values("destination")
        .annotate(bookings=Count("id"), weight=Sum("weight_kg"))
        .order_by("-bookings", "destination")
    )
    labels = dict(Booking.Destination.choices)
    return [
        {
            "destination": row["destination"],
            "label": labels.get(row["destination"], row["destination"]),
            "bookings": row["bookings"],
            "weight_kg": round(float(row["weight"] or 0), 1),
        }
        for row in rows
    ]


def bookings_by_freight(start, end):
    """[{freight: 'sea', label: 'Zeevracht', bookings: 7}, ...], busiest first."""
    rows = (
        Booking.objects.filter(created_at__gte=start, created_at__lt=end)
        .values("freight")
        .annotate(bookings=Count("id"))
        .order_by("-bookings", "freight")
    )
    labels = dict(Booking.Freight.choices)
    return [
        {"freight": row["freight"], "label": labels.get(row["freight"], row["freight"]), "bookings": row["bookings"]}
        for row in rows
    ]


def monthly_series(year, month):
    """One row per month for the chart: the CHART_MONTHS months up to (year, month).

    Step by step:
      1. Make an empty row for each month, oldest first.
      2. Count bookings and shipped packages per month with one GROUP BY
         query each (TruncMonth), and fill them in.
      3. Add up the sent invoices per month in Python (amount_due is worked
         out in Python, so it cannot be summed by the database).
    """
    first = add_months(year, month, -(CHART_MONTHS - 1))
    start = month_start(*first)
    end = month_start(*add_months(year, month, 1))
    zone = timezone.get_current_timezone()

    # Step 1
    rows = {}
    for offset in range(CHART_MONTHS):
        key = month_key(*add_months(*first, offset))
        rows[key] = {"month": key, "bookings": 0, "packages_shipped": 0, "invoiced": Decimal("0.00")}

    # Step 2
    def fill(queryset, field, name):
        grouped = (
            queryset.filter(**{f"{field}__gte": start, f"{field}__lt": end})
            .annotate(bucket=TruncMonth(field, tzinfo=zone))
            .values("bucket")
            .annotate(total=Count("id"))
        )
        for row in grouped:
            key = month_key(row["bucket"].year, row["bucket"].month)
            if key in rows:
                rows[key][name] = row["total"]

    fill(Booking.objects.all(), "created_at", "bookings")
    fill(Package.objects.all(), "shipped_at", "packages_shipped")

    # Step 3
    for invoice in sent_invoices(start, end):
        sent = timezone.localtime(invoice.sent_at, zone)
        key = month_key(sent.year, sent.month)
        if key in rows:
            rows[key]["invoiced"] += invoice_total(invoice)

    return [{**row, "invoiced": str(row["invoiced"])} for row in rows.values()]


# ---------------------------------------------------------------------- view


class MonthlyReportView(APIView):
    """GET /api/staff/reports/monthly/?month=YYYY-MM - see the module docstring."""

    permission_classes = [IsStaff]

    def get(self, request):
        year, month = parse_month(request.query_params.get("month", ""))
        start = month_start(year, month)
        end = month_start(*add_months(year, month, 1))
        previous = add_months(year, month, -1)
        previous_start = month_start(*previous)

        return Response(
            {
                "month": month_key(year, month),
                "previous_month": month_key(*previous),
                # True while the month is still running, so the page can say
                # "so far" rather than compare half a month with a whole one
                # without a warning.
                "is_current": start <= timezone.now() < end,
                "current": month_figures(start, end),
                "previous": month_figures(previous_start, start),
                "by_destination": bookings_by_destination(start, end),
                "by_freight": bookings_by_freight(start, end),
                "months": monthly_series(year, month),
            }
        )
