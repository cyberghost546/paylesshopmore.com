"""AI document reading with human review: the three tables.

READ THIS FIRST
---------------
A document comes in (a customer's receipt, a shop's order confirmation, an
e-mail, a photo of a shipping label). We want to know which customer, order,
package and invoice it is about - without anybody typing that in.

    DocumentJob         one document, and everything we worked out about it
    DocumentJobAttempt  one go at reading it with OCR + AI (there can be retries)
    DocumentJobEvent    the audit log: who did what to the job, and when

The flow (docreview/pipeline.py has the details):

    queued -> processing -> linked          (a reliable match: done by itself)
                         -> needs_review    (a person must look)
                         -> failed          (reading failed; kept to investigate)
    needs_review -> linked | resolved       (after a person confirms or closes it)

Two rules that run through everything here:

1. The AI only ever READS. It returns text it saw in the document (a tracking
   number, an e-mail address). It never chooses database ids: those come from
   exact database lookups in docreview/matching.py, or from a staff member
   picking a record, and both are checked again before anything is saved.

2. Nothing is deleted. A failed job stays, every attempt stays, every change
   is written to DocumentJobEvent with the value before and after.
"""

from django.conf import settings
from django.db import models


def job_file_path(instance, filename):
    """Where an uploaded or e-mailed document is stored. Never public: files
    are only ever served by docreview.views, which checks who is asking.
    The visitor's own file name is not used in the path."""
    import os
    import uuid

    from django.utils import timezone

    extension = os.path.splitext(filename or "")[1].lower()[:8]
    return f"document-jobs/{timezone.localtime():%Y/%m}/{uuid.uuid4().hex}{extension}"


class DocumentJob(models.Model):
    class Source(models.TextChoices):
        # Already stored elsewhere: the job points at the original row.
        CUSTOMER_DOCUMENT = "customer_document", "Customer upload"
        BOOKING_ATTACHMENT = "booking_attachment", "Booking attachment"
        # Stored by this app, in `file`.
        STAFF_UPLOAD = "staff_upload", "Uploaded by staff"
        WAREHOUSE_PHOTO = "warehouse_photo", "Warehouse photo"
        EMAIL = "email", "E-mail"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        PROCESSING = "processing", "Processing"
        NEEDS_REVIEW = "needs_review", "Needs review"
        LINKED = "linked", "Linked"
        RESOLVED = "resolved", "Resolved"
        FAILED = "failed", "Failed"

    source = models.CharField(max_length=20, choices=Source.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED, db_index=True)

    # Makes creating a job idempotent: the same document can only ever have
    # one job. Examples: "package_document:12", "booking_attachment:7",
    # "email:3:<message-id>:1", "upload:<sha256>".
    dedupe_key = models.CharField(max_length=200, unique=True)

    # ---- the document itself ------------------------------------------------
    # For uploads and e-mails, the file is stored here.
    file = models.FileField(upload_to=job_file_path, blank=True)
    # For documents that already live elsewhere, the original row. SET_NULL:
    # if the original is deleted, the job (and its audit trail) stays.
    package_document = models.ForeignKey(
        "accounts.PackageDocument", on_delete=models.SET_NULL, null=True, blank=True, related_name="document_jobs"
    )
    booking_attachment = models.ForeignKey(
        "bookings.BookingAttachment", on_delete=models.SET_NULL, null=True, blank=True, related_name="document_jobs"
    )
    original_name = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=100, blank=True)
    size_bytes = models.PositiveIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True, db_index=True)
    # Untrusted text that came with the document: an e-mail's sender, subject
    # and body. Shown to staff as plain text and given to the AI as data.
    source_meta = models.JSONField(default=dict, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    note = models.CharField(max_length=255, blank=True)

    # ---- what was read --------------------------------------------------------
    # The fields as read by the AI and then edited by staff (the current truth).
    # The AI's own first answer is kept untouched on each DocumentJobAttempt.
    extracted = models.JSONField(default=dict, blank=True)
    # The document's text (the OCR transcription), for staff to read and for
    # checking that identifiers really appear in the document.
    text = models.TextField(blank=True)
    # [{"field": "customer_email", "code": "invalid", "message": "..."}]
    validation = models.JSONField(default=list, blank=True)
    # Why a person has to look: [{"code": "conflict", "message": "..."}]
    review_reasons = models.JSONField(default=list, blank=True)
    # What the database lookups found, per kind of record:
    # {"package": [{"id": 4, "label": "PLSM-00004 ...", "reasons": [...], "strong": true}], ...}
    proposals = models.JSONField(default=dict, blank=True)
    # The record chosen per kind, before it is confirmed: {"package": 4, ...}
    selected = models.JSONField(default=dict, blank=True)
    # Records a person said are wrong, never proposed again: {"package": [4]}
    rejected = models.JSONField(default=dict, blank=True)

    # ---- the confirmed links ----------------------------------------------------
    # Set only by pipeline.apply_links, inside a transaction, after checking.
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="document_jobs"
    )
    package = models.ForeignKey(
        "accounts.Package", on_delete=models.SET_NULL, null=True, blank=True, related_name="document_jobs"
    )
    booking_order = models.ForeignKey(
        "bookings.BookingOrder", on_delete=models.SET_NULL, null=True, blank=True, related_name="document_jobs"
    )
    invoice = models.ForeignKey(
        "invoicing.Invoice", on_delete=models.SET_NULL, null=True, blank=True, related_name="document_jobs"
    )
    # The copy filed in the customer's documents for an e-mailed or uploaded
    # document (so it shows on their shipment). Set at most once.
    filed_document = models.ForeignKey(
        "accounts.PackageDocument", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    auto_linked = models.BooleanField(default=False)

    attempts_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "-created_at"])]

    def __str__(self):
        return f"Document job {self.pk} ({self.get_status_display()})"

    @property
    def is_open(self):
        """Still waiting for work (by the machine or by a person)."""
        return self.status in (self.Status.QUEUED, self.Status.PROCESSING, self.Status.NEEDS_REVIEW, self.Status.FAILED)


class DocumentJobAttempt(models.Model):
    """One go at reading the document. Kept for ever, also when it failed."""

    job = models.ForeignKey(DocumentJob, on_delete=models.CASCADE, related_name="attempts")
    number = models.PositiveIntegerField()
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    ok = models.BooleanField(default=False)
    model = models.CharField(max_length=60, blank=True)
    # The AI's answer exactly as it came back, before any checking or editing.
    raw_result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["number"]
        constraints = [models.UniqueConstraint(fields=["job", "number"], name="document_attempt_number_once")]

    def __str__(self):
        return f"Attempt {self.number} for job {self.job_id}"


class DocumentJobEvent(models.Model):
    """The audit log. Append-only: rows are written, never changed.

    One row per thing that happened. For a change, `field` names what changed
    and `before` / `after` hold the old and new values, e.g.
        action="field_edited", field="customer_email",
        before="ana@exmple.com", after="ana@example.com", reason="typo in OCR"
    """

    class Action(models.TextChoices):
        CREATED = "created", "Created"
        EXTRACTED = "extracted", "Read by AI"
        EXTRACTION_FAILED = "extraction_failed", "Reading failed"
        NEEDS_REVIEW = "needs_review", "Sent to review"
        AUTO_LINKED = "auto_linked", "Linked automatically"
        FIELD_EDITED = "field_edited", "Field edited"
        MATCH_SELECTED = "match_selected", "Match selected"
        MATCH_REJECTED = "match_rejected", "Match rejected"
        CONFIRMED = "confirmed", "Confirmed"
        RECORD_UPDATED = "record_updated", "Record updated"
        RETRY_REQUESTED = "retry_requested", "Retry requested"
        RESOLVED = "resolved", "Resolved"

    job = models.ForeignKey(DocumentJob, on_delete=models.CASCADE, related_name="events")
    action = models.CharField(max_length=20, choices=Action.choices)
    # Null when the system did it (the automatic processing).
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    field = models.CharField(max_length=60, blank=True)
    before = models.JSONField(null=True, blank=True)
    after = models.JSONField(null=True, blank=True)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.get_action_display()} on job {self.job_id}"

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValueError("Audit events are never changed.")
        super().save(*args, **kwargs)
