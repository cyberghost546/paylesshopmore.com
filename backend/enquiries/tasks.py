"""Work for the Celery worker: sorting a contact message with AI (sorting.py)."""

from celery import shared_task

from .models import ContactMessage
from .sorting import sort_message


@shared_task
def sort_contact_message(message_id):
    """Sort one message. A message deleted in the meantime is simply skipped."""
    message = ContactMessage.objects.filter(pk=message_id).first()
    return bool(message and sort_message(message))
