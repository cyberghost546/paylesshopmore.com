"""What the public forms submit: contact messages and quote requests.

Both are written by anonymous visitors, so every field is treated as untrusted
input and nothing here is ever rendered as HTML.
"""

from django.conf import settings
from django.db import models


class ContactMessage(models.Model):
    """A message from the contact page."""

    name = models.CharField(max_length=150)
    email = models.EmailField()
    subject = models.CharField(max_length=100)
    message = models.TextField()

    # Whether someone has dealt with it. Simple on purpose: a full ticketing
    # workflow is a different project.
    handled = models.BooleanField(default=False)

    # The language the visitor was reading, so the reply goes out in the same
    # one. Blank when the form did not send it.
    language = models.CharField(max_length=5, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    # ---- Sorted by AI (enquiries/sorting.py) --------------------------------
    # What the message is about and how urgent it is, so the office sees
    # complaints and urgent questions first. Blank until sorted; a person can
    # always read the message itself, and nothing is decided by these.
    class Topic(models.TextChoices):
        PRICE = "price", "Price or quote"
        TRACKING = "tracking", "Where is my parcel"
        BOOKING = "booking", "Booking or shipping"
        COMPLAINT = "complaint", "Complaint"
        DAMAGE = "damage", "Damage or loss"
        CAR = "car", "Car or vehicle"
        MOVING = "moving", "Moving or emigrating"
        PAYMENT = "payment", "Payment or invoice"
        OTHER = "other", "Other"
        SPAM = "spam", "Spam"

    class Urgency(models.TextChoices):
        HIGH = "high", "Urgent"
        NORMAL = "normal", "Normal"
        LOW = "low", "Can wait"

    ai_topic = models.CharField(max_length=20, choices=Topic.choices, blank=True)
    ai_urgency = models.CharField(max_length=10, choices=Urgency.choices, blank=True)
    # One line saying what they want, so the list can be read without opening
    # every message.
    ai_summary = models.CharField(max_length=200, blank=True)
    # When it was sorted. Null = not yet (or the AI was not available).
    ai_sorted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["handled", "-created_at"])]

    def __str__(self):
        return f"{self.subject} — {self.email}"


class ContactReply(models.Model):
    """One answer the office sent to a contact message, from the dashboard.

    READ THIS FIRST: the dashboard writes this row FIRST and only then tries
    to e-mail it (enquiries/replies.py). So the row is the record of what we
    said, even when the mail server was down at that moment:

        emailed_at set      -> the e-mail went out
        emailed_at empty    -> it did not; `send_error` says why

    The office can see that in the dashboard and simply send again.
    """

    # CASCADE: a reply means nothing without the message it answers.
    message = models.ForeignKey(
        ContactMessage, on_delete=models.CASCADE, related_name="replies"
    )

    # Who wrote it. SET_NULL so removing a colleague's account later does not
    # delete what the customer was told.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contact_replies",
    )

    body = models.TextField()

    created_at = models.DateTimeField(auto_now_add=True)
    emailed_at = models.DateTimeField(null=True, blank=True)
    # Short and technical ("Connection refused"), for whoever has to fix it.
    send_error = models.CharField(max_length=300, blank=True)

    class Meta:
        # Oldest first: a conversation reads from top to bottom.
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"Reply to {self.message_id} ({self.created_at:%Y-%m-%d %H:%M})"


def quote_upload_path(instance, filename):
    """Where an uploaded shopping list is stored.

    Django sanitises the filename and appends a random suffix on collision, so
    a visitor cannot overwrite an existing file or escape the directory by
    submitting something like ../../settings.py.
    """
    return f"quotes/{filename}"


class QuoteRequest(models.Model):
    """A "request a quote" submission from a destination page."""

    class Status(models.TextChoices):
        NEW = "new", "New"
        QUOTED = "quoted", "Quote sent"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"

    # The island the request came from, as shown on that page.
    destination = models.CharField(max_length=100)

    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    email = models.EmailField()
    message = models.TextField(blank=True)

    # Optional: the copy tells people they may describe their list in the
    # message box instead of attaching anything.
    file = models.FileField(upload_to=quote_upload_path, blank=True, null=True)

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.NEW
    )
    language = models.CharField(max_length=5, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "-created_at"])]

    def __str__(self):
        return f"{self.first_name} {self.last_name} — {self.destination}"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()


class QuoteReply(models.Model):
    """One answer the office sent to a quote request, from the dashboard.

    The same arrangement as ContactReply above, for the same reason: the row
    is written FIRST and only then e-mailed (enquiries/replies.py), so it is
    the record of what the customer was told even when the mail server was
    down - `emailed_at` set means it went out, empty means it did not and
    `send_error` says why.
    """

    # CASCADE: a reply means nothing without the request it answers.
    quote = models.ForeignKey(QuoteRequest, on_delete=models.CASCADE, related_name="replies")
    # SET_NULL so removing a colleague's account does not delete what was said.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quote_replies",
    )

    body = models.TextField()

    created_at = models.DateTimeField(auto_now_add=True)
    emailed_at = models.DateTimeField(null=True, blank=True)
    send_error = models.CharField(max_length=300, blank=True)

    class Meta:
        # Oldest first: a conversation reads from top to bottom.
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"Reply to quote {self.quote_id} ({self.created_at:%Y-%m-%d %H:%M})"
