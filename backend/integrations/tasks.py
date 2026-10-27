"""Sending webhooks on the worker, and trying again when it fails.

Retry plan for one delivery (the receiver's server may be down for a while):

    attempt 1  right away
    attempt 2  after 1 minute
    attempt 3  after 5 minutes
    attempt 4  after 30 minutes
    attempt 5  after 2 hours
    attempt 6  after 6 hours   -> still failing? status "failed", stop.

Two ways a retry happens:
- With a worker (CELERY_BROKER_URL set, production): the task schedules itself
  again with a countdown.
- Without one (local development, tasks run inline): nothing is scheduled,
  because an inline "retry" would just run again straight away. Run
  `python manage.py send_webhooks` to send whatever is due.
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import WebhookDelivery
from .webhooks import send

logger = logging.getLogger(__name__)

# Seconds to wait before attempt 2, 3, 4, 5 and 6.
RETRY_DELAYS = [60, 5 * 60, 30 * 60, 2 * 60 * 60, 6 * 60 * 60]
MAX_ATTEMPTS = len(RETRY_DELAYS) + 1


@shared_task
def deliver_webhook(delivery_id):
    """Try to send one delivery. Safe to run twice: a delivered one is skipped."""
    with transaction.atomic():
        # select_for_update: two workers holding the same id cannot both send.
        delivery = (
            WebhookDelivery.objects.select_for_update()
            .select_related("endpoint")
            .filter(pk=delivery_id, status=WebhookDelivery.Status.PENDING)
            .first()
        )
        if delivery is None:
            return  # already delivered, given up on, or deleted
        if not delivery.endpoint.is_active:
            delivery.status = WebhookDelivery.Status.FAILED
            delivery.last_error = "Endpoint switched off."
            delivery.save(update_fields=["status", "last_error"])
            return

        ok, code, error = send(delivery)

        delivery.attempts += 1
        delivery.last_status_code = code
        delivery.last_error = error
        if ok:
            delivery.status = WebhookDelivery.Status.DELIVERED
            delivery.delivered_at = timezone.now()
        elif delivery.attempts >= MAX_ATTEMPTS:
            delivery.status = WebhookDelivery.Status.FAILED
            logger.warning("Webhook %s to %s failed for good: %s", delivery.pk, delivery.endpoint, error)
        else:
            wait = RETRY_DELAYS[delivery.attempts - 1]
            delivery.next_attempt_at = timezone.now() + timedelta(seconds=wait)
        delivery.save()

    if delivery.status == WebhookDelivery.Status.PENDING and not settings.CELERY_TASK_ALWAYS_EAGER:
        deliver_webhook.apply_async(args=[str(delivery.pk)], countdown=wait)


def send_due_deliveries():
    """Send every pending delivery whose next attempt is due. Returns how many were tried."""
    due = WebhookDelivery.objects.filter(
        status=WebhookDelivery.Status.PENDING, next_attempt_at__lte=timezone.now()
    ).values_list("pk", flat=True)
    count = 0
    for pk in list(due):
        deliver_webhook(str(pk))  # called directly: runs here, not on a worker
        count += 1
    return count
