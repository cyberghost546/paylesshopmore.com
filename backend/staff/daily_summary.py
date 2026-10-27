"""The office's daily summary: what happened yesterday, and what is waiting now.

READ THIS FIRST
---------------
`build(day)` counts, straight from the database:

    "day":  what came in or moved on `day` (new bookings, messages, quote
            requests, pre-alerts; parcels shipped and delivered)
    "open": what is waiting for somebody right now (new bookings, unanswered
            messages, documents to review, shipments stuck in a stage, ...)
    "attention": up to ATTENTION_LIMIT shipments that need somebody, with why

The numbers are always exact: they never come from the AI. On top of them,
`write_highlights(data)` asks OpenAI for a few short lines on what to start
with today. That is a reading of the numbers above, nothing more - it sees
only the counts and the shipments' tracking numbers and stages, never a
customer's name, address or message - and when the AI is not set up or
fails, the summary simply goes without it.

Used in two places:
* the dashboard's Overview page (GET /api/staff/summary/, staff/views.py),
* the morning e-mail (management command send_office_summary, run by the
  same scheduled job as the warehouse report - daily-reports in .do/app.yaml).
"""

import json
import logging
from datetime import datetime, time, timedelta

from django.conf import settings
from django.utils import timezone

from accounts.models import Package
from bookings.models import Booking
from docreview.models import DocumentJob
from enquiries.models import ContactMessage, QuoteRequest
from invoicing.models import Invoice
from prealerts.models import PreAlert
from warehouse.shipments import attention_q, with_flags

from . import customs_check

logger = logging.getLogger(__name__)

ATTENTION_LIMIT = 10
# Checking every shipment's paperwork is many queries; the dashboard asks on
# every visit, so the answer is kept this long (customs_check.not_ready).
CUSTOMS_SECONDS = 10 * 60


def _customs():
    """{"rows": [...], "count": n}: shipments not left yet that customs would refuse."""
    from django.core.cache import cache

    cached = cache.get("daily-summary-customs")
    if cached is None:
        rows, count = customs_check.not_ready()
        cached = {"rows": rows, "count": count}
        cache.set("daily-summary-customs", cached, CUSTOMS_SECONDS)
    return cached


def _bounds(day):
    """The start and end of `day` in the site's time zone, as aware datetimes."""
    zone = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(day, time.min), zone)
    return start, start + timedelta(days=1)


def _needing_attention(now):
    """Shipments still on their way that need somebody (warehouse/shipments.py's rule)."""
    # with_flags adds has_open_damage, which attention_q filters on.
    return with_flags(Package.objects.all()).filter(attention_q(now)).exclude(status__in=Package.TERMINAL_STATUSES)


def _attention(now):
    """The shipments that need somebody, most overdue first, with the reason."""
    rows = []
    packages = _needing_attention(now).order_by("warehouse_stage_at")[:ATTENTION_LIMIT]
    for package in packages:
        if package.problem_note:
            reason = "problem noted"
        elif package.has_open_damage:
            reason = "open damage report"
        else:
            reason = "waiting too long in this stage"
        rows.append(
            {
                "tracking_number": package.tracking_number,
                "stage": package.get_warehouse_stage_display(),
                "days_in_stage": max((now - package.warehouse_stage_at).days, 0),
                "reason": reason,
            }
        )
    return rows


def build(day, now=None):
    """The summary for `day` (a date), with "open" counted as of `now`."""
    now = now or timezone.now()
    start, end = _bounds(day)
    on_day = {"created_at__gte": start, "created_at__lt": end}
    customs = _customs()

    return {
        "date": day.isoformat(),
        "day": {
            "bookings": Booking.objects.filter(**on_day).count(),
            "messages": ContactMessage.objects.filter(**on_day).count(),
            "quote_requests": QuoteRequest.objects.filter(**on_day).count(),
            "prealerts": PreAlert.objects.filter(**on_day).count(),
            "prealerts_arrived": PreAlert.objects.filter(arrived_at__gte=start, arrived_at__lt=end).count(),
            "shipped": Package.objects.filter(shipped_at__gte=start, shipped_at__lt=end).count(),
            "delivered": Package.objects.filter(delivered_at__gte=start, delivered_at__lt=end).count(),
        },
        "open": {
            "bookings_new": Booking.objects.filter(status=Booking.Status.NEW).count(),
            "messages_unanswered": ContactMessage.objects.filter(handled=False).count(),
            # Of those, the ones the AI sorted as urgent (enquiries/sorting.py).
            "messages_urgent": ContactMessage.objects.filter(
                handled=False, ai_urgency=ContactMessage.Urgency.HIGH
            ).count(),
            "quote_requests_new": QuoteRequest.objects.filter(status=QuoteRequest.Status.NEW).count(),
            "documents_to_review": DocumentJob.objects.filter(
                status__in=[DocumentJob.Status.NEEDS_REVIEW, DocumentJob.Status.FAILED]
            ).count(),
            "invoices_to_approve": Invoice.objects.filter(status=Invoice.Status.PENDING_REVIEW).count(),
            "prealerts_on_the_way": PreAlert.objects.filter(status=PreAlert.Status.SUBMITTED).count(),
            "shipments_need_attention": _needing_attention(now).count(),
            "arrived_not_delivered": Package.objects.filter(status=Package.Status.ARRIVED).count(),
            "paperwork_missing": customs["count"],
        },
        "attention": _attention(now),
        # Not left yet, and missing what customs needs (customs_check.py).
        "customs": customs["rows"],
    }


# The labels for the e-mail and the AI, in one place. The dashboard has its
# own (frontend i18n/pages/summary.js).
LABELS = {
    "day": {
        "bookings": "New bookings",
        "messages": "New contact messages",
        "quote_requests": "New quote requests",
        "prealerts": "New pre-alerts",
        "prealerts_arrived": "Pre-alerted parcels arrived",
        "shipped": "Shipments sent",
        "delivered": "Shipments delivered",
    },
    "open": {
        "bookings_new": "Bookings waiting to be confirmed",
        "messages_unanswered": "Messages not answered",
        "messages_urgent": "  of which urgent",
        "quote_requests_new": "Quote requests not answered",
        "documents_to_review": "Documents to review",
        "invoices_to_approve": "Invoices to approve",
        "prealerts_on_the_way": "Pre-alerted parcels on their way",
        "shipments_need_attention": "Shipments that need attention",
        "arrived_not_delivered": "Arrived, not delivered yet",
        "paperwork_missing": "Shipments missing customs paperwork",
    },
}

HIGHLIGHTS_INSTRUCTIONS = """\
You help the office of Pay Less Shop More, a shipping company, start the day.
You get yesterday's activity and what is waiting now, as JSON. Write 2 to 4
short lines in English: what to do first and why, using the numbers. Mention
specific tracking numbers only from the "attention" list. Plain text, each
line starting with "- ". Do not invent anything that is not in the data. If
nothing is waiting, say so in one line."""


def write_highlights(data):
    """A few AI-written lines on what to start with, or "" when unavailable. Never raises."""
    if not getattr(settings, "OPENAI_API_KEY", ""):
        return ""
    try:
        import openai

        options = {}
        if settings.ASSISTANT_AI_REASONING:
            options["reasoning"] = {"effort": settings.ASSISTANT_AI_REASONING}
        client = openai.OpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0)
        response = client.responses.create(
            model=settings.ASSISTANT_AI_MODEL,
            instructions=HIGHLIGHTS_INSTRUCTIONS,
            input=[{"role": "user", "content": json.dumps(data)}],
            max_output_tokens=1500,
            store=False,
            **options,
        )
        return (response.output_text or "").strip()
    except Exception:  # noqa: BLE001 - the summary must arrive without them
        logger.exception("Writing the daily summary's highlights failed")
        return ""


def to_text(data, highlights=""):
    """The summary as a plain-text e-mail body."""
    lines = [f"Daily summary - {data['date']}", ""]
    if highlights:
        lines += ["Start with:", highlights, ""]
    lines.append("Waiting now:")
    lines += [f"  {LABELS['open'][key]}: {value}" for key, value in data["open"].items()]
    lines += ["", f"On {data['date']}:"]
    lines += [f"  {LABELS['day'][key]}: {value}" for key, value in data["day"].items()]
    if data["attention"]:
        lines += ["", "Shipments that need somebody:"]
        lines += [
            f"  {row['tracking_number']} - {row['stage']}, {row['days_in_stage']} day(s): {row['reason']}"
            for row in data["attention"]
        ]
    if data["customs"]:
        lines += ["", "Not ready for customs:"]
        lines += [
            f"  {row['tracking_number']} ({row['status']}): {' '.join(row['problems'])}" for row in data["customs"]
        ]
    return "\n".join(lines) + "\n"
