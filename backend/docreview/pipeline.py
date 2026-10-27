"""The document pipeline: from "a file arrived" to "linked" or "a person looks".

READ THIS FIRST
---------------
The steps, in order (the numbers match the feature description):

  1-2  A document arrives and gets ONE job (create_job). The dedupe_key makes
       this idempotent: the same customer upload, e-mail attachment or file
       never gets a second job. Processing is queued after the database
       transaction commits.
  3    process_job claims the job (a conditional UPDATE, so two workers can
       never process the same job at once), reads the file, and asks the AI
       for the text and the fields (docreview/ai.py). Every try is kept as a
       DocumentJobAttempt, also the failed ones.
  4    The fields are checked (docreview/validation.py) and looked up in the
       database with exact matches (docreview/matching.py).
  5    The candidates become proposals; a single candidate is pre-selected.
  6-7  review_reasons() lists everything that needs a person: conflicts,
       missing or weak matches, failed checks, records that belong to
       different customers, anything to do with invoices (money is always
       checked by a person). No reasons at all -> the links are applied
       automatically. Any reason -> status "needs_review".
  8    apply_links() saves links inside a transaction, after checking every
       record AGAIN against the database at that moment (a lot can change
       between reading a document and a person pressing "Confirm").
  9    Every change is written to the audit log (DocumentJobEvent) with the
       value before and after, and the existing pages show the result: a
       customer's receipt appears on the right shipment, an e-mailed document
       is filed in the customer's documents.

What this module NEVER does: create a package, create or change an invoice,
or use an id that did not come from our own database lookup or from a
staff member's choice that was checked here.

The human actions (edit_fields, select, reject, confirm, retry, resolve) are
at the bottom; docreview/views.py calls them.
"""

import hashlib
import io
import logging
import os

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from accounts.models import PackageDocument

from . import ai
from .matching import ENTITIES, find_candidates, label_for, load, owner_of
from .models import DocumentJob, DocumentJobAttempt, DocumentJobEvent
from .validation import EDITABLE_FIELDS, LIST_FIELDS, clean

logger = logging.getLogger(__name__)

Action = DocumentJobEvent.Action
Status = DocumentJob.Status

# How often the machine tries again by itself when the AI service was busy or
# unreachable. After that the job is "failed" and a person can press Retry.
MAX_AUTOMATIC_ATTEMPTS = 3

# The files we accept, recognised by their first bytes (never by the name or
# the browser's claim), and the type each is stored and served as.
SIGNATURES = (
    (b"%PDF-", "application/pdf", ".pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
)
MAX_BYTES = 10 * 1024 * 1024

# Where an e-mailed or uploaded document lands in the customer's documents
# once it is linked, by what the AI says it is.
FILED_KIND = {
    "shop_invoice": PackageDocument.Kind.INVOICE,
    "receipt": PackageDocument.Kind.RECEIPT,
    "customs_form": PackageDocument.Kind.CUSTOMS,
}


class ReviewError(Exception):
    """A human action that cannot be done, worded for the person who tried."""


class NotAllowed(ReviewError):
    """The person may not do this (e.g. link an invoice without being an admin)."""


def detect_type(data):
    """(content_type, extension) from the file's first bytes, or (None, None).
    WebP is RIFF....WEBP."""
    for signature, content_type, extension in SIGNATURES:
        if data.startswith(signature):
            return content_type, extension
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None, None


def record(job, action, actor=None, *, field="", before=None, after=None, reason=""):
    """Write one audit event."""
    return DocumentJobEvent.objects.create(
        job=job, action=action, actor=actor, field=field, before=before, after=after, reason=reason or ""
    )


def is_enabled():
    """Automatic reading of incoming documents is on (settings.DOCUMENT_AI_AUTO)."""
    return bool(getattr(settings, "DOCUMENT_AI_AUTO", False)) and ai.is_configured()


# ------------------------------------------------------------ 1-2: new jobs


def enqueue(job):
    """Start processing once the current transaction has committed."""

    def start():
        from .tasks import process_document_job

        try:
            process_document_job.delay(job.pk)
        except Exception:  # noqa: BLE001 - the job stays "queued" and can be retried
            logger.exception("Document job %s could not be queued.", job.pk)

    transaction.on_commit(start)


def create_job(*, source, dedupe_key, actor=None, **fields):
    """Make the job for a document, or return the one it already has.

    Returns (job, created). Safe to call twice for the same document, also at
    the same moment (the unique dedupe_key decides who wins).
    """
    existing = DocumentJob.objects.filter(dedupe_key=dedupe_key).first()
    if existing is not None:
        return existing, False
    try:
        with transaction.atomic():
            job = DocumentJob.objects.create(source=source, dedupe_key=dedupe_key, uploaded_by=actor, **fields)
            record(job, Action.CREATED, actor, after={"source": source, "name": job.original_name})
    except IntegrityError:
        return DocumentJob.objects.get(dedupe_key=dedupe_key), False
    enqueue(job)
    return job, True


def job_for_package_document(document):
    """A customer uploaded a receipt/invoice/customs form (accounts.views)."""
    if not is_enabled():
        return None
    job, _ = create_job(
        source=DocumentJob.Source.CUSTOMER_DOCUMENT,
        dedupe_key=f"package_document:{document.pk}",
        package_document=document,
        original_name=document.original_name,
        content_type=document.served_content_type,
        size_bytes=document.size_bytes,
        note=document.note,
    )
    return job


def job_for_booking_attachment(attachment):
    """A customer added an order confirmation / invoice / track-and-trace to a booking."""
    if not is_enabled():
        return None
    extension = os.path.splitext(attachment.file.name or "")[1].lower()
    job, _ = create_job(
        source=DocumentJob.Source.BOOKING_ATTACHMENT,
        dedupe_key=f"booking_attachment:{attachment.pk}",
        booking_attachment=attachment,
        original_name=attachment.original_name,
        content_type=attachment.CONTENT_TYPES.get(extension, attachment.content_type),
        size_bytes=attachment.size_bytes,
    )
    return job


def job_from_upload(upload, *, actor, source, note=""):
    """Staff (or the warehouse) uploaded a file to be read. Returns (job, created).

    Raises ReviewError for a file we do not accept. The same file uploaded
    twice gives the same job back.
    """
    data = upload.read()
    if len(data) > MAX_BYTES:
        raise ReviewError("The file is larger than 10 MB.")
    content_type, extension = detect_type(data)
    if content_type is None:
        raise ReviewError("Only PDF, PNG, JPEG and WebP files can be read.")
    digest = hashlib.sha256(data).hexdigest()
    existing = DocumentJob.objects.filter(dedupe_key=f"upload:{digest}").first()
    if existing is not None:
        return existing, False
    return create_job(
        source=source,
        dedupe_key=f"upload:{digest}",
        actor=actor,
        file=ContentFile(data, name=f"upload{extension}"),
        original_name=(getattr(upload, "name", "") or "")[:255],
        content_type=content_type,
        size_bytes=len(data),
        sha256=digest,
        note=(note or "")[:255],
    )


def jobs_from_email(*, key_id, message_id, sender, subject, body, attachments):
    """An e-mail pushed to us by a mail service (docreview.views.InboundEmailView).

    One job per readable attachment; the e-mail text goes along as untrusted
    context. An e-mail without attachments becomes one job for its text.
    Returns [(job, created), ...]. `attachments` are (name, bytes) pairs that
    the view has already size-checked.
    """
    meta = {"from": sender[:254], "subject": subject[:300], "body": body[:20000]}
    results = []
    for index, (name, data) in enumerate(attachments, start=1):
        content_type, extension = detect_type(data)
        if content_type is None:
            continue  # not a document we read (a signature logo, a .docx ...)
        results.append(
            create_job(
                source=DocumentJob.Source.EMAIL,
                dedupe_key=f"email:{key_id}:{message_id}:{index}"[:200],
                file=ContentFile(data, name=f"email{extension}"),
                original_name=(name or "")[:255],
                content_type=content_type,
                size_bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
                source_meta=meta,
            )
        )
    if not results and body.strip():
        data = body.encode("utf-8")
        results.append(
            create_job(
                source=DocumentJob.Source.EMAIL,
                dedupe_key=f"email:{key_id}:{message_id}:text"[:200],
                file=ContentFile(data, name="email.txt"),
                original_name=(subject or "E-mail")[:255],
                content_type="text/plain",
                size_bytes=len(data),
                sha256=hashlib.sha256(data).hexdigest(),
                source_meta=meta,
            )
        )
    return results


# --------------------------------------------------------------- 3: reading


def read_bytes(job):
    """The document's bytes, from wherever it is stored. Raises ExtractionError."""
    if job.file:
        field = job.file
    elif job.package_document_id and job.package_document.file:
        field = job.package_document.file
    elif job.booking_attachment_id and job.booking_attachment.file:
        field = job.booking_attachment.file
    else:
        raise ai.ExtractionError("The original document is no longer stored.")
    try:
        with field.open("rb") as handle:
            return handle.read()
    except (FileNotFoundError, OSError) as error:
        raise ai.ExtractionError("The original document could not be opened.") from error


def pdf_text(data):
    """The text layer of a PDF (empty for a scan). A second, independent source
    of text to check the AI's identifiers against."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages[:30])[:200_000]
    except Exception:  # noqa: BLE001 - a scan or an unusual PDF simply has no text layer
        return ""


def context_for(job):
    """The untrusted text that came with the document, for the AI."""
    meta = job.source_meta or {}
    parts = []
    if meta.get("subject"):
        parts.append(f"E-mail subject: {meta['subject']}")
    if meta.get("from"):
        parts.append(f"E-mail from: {meta['from']}")
    if meta.get("body") and job.content_type != "text/plain":
        parts.append(f"E-mail text:\n{meta['body']}")
    if job.note:
        parts.append(f"Note by the uploader: {job.note}")
    return "\n".join(parts)


def process_job(job_id, requested_by=None):
    """Steps 3-7 for one job. Returns "done", "retry" or "skipped"."""
    # Claim it: only one worker gets past this line for a queued job.
    claimed = DocumentJob.objects.filter(pk=job_id, status=Status.QUEUED).update(
        status=Status.PROCESSING, attempts_count=F("attempts_count") + 1
    )
    if not claimed:
        return "skipped"
    job = DocumentJob.objects.select_related("package_document__customer", "booking_attachment__booking__user").get(
        pk=job_id
    )
    attempt = DocumentJobAttempt.objects.create(job=job, number=job.attempts_count, requested_by=requested_by)

    try:
        data = read_bytes(job)
        if not job.sha256:
            job.sha256 = hashlib.sha256(data).hexdigest()
        fields, info = ai.read_document(data, job.content_type, context_for(job))
    except ai.ExtractionError as error:
        attempt.error = str(error)
        attempt.finished_at = timezone.now()
        attempt.save()
        retry = error.retryable and job.attempts_count < MAX_AUTOMATIC_ATTEMPTS
        job.status = Status.QUEUED if retry else Status.FAILED
        job.last_error = str(error)
        job.save(update_fields=["status", "last_error", "sha256", "updated_at"])
        record(job, Action.EXTRACTION_FAILED, reason=str(error))
        return "retry" if retry else "done"

    attempt.ok = True
    attempt.raw_result = fields
    attempt.model = info["model"][:60]
    attempt.input_tokens = info["input_tokens"]
    attempt.output_tokens = info["output_tokens"]
    attempt.finished_at = timezone.now()
    attempt.save()

    ai_text = fields.get("text", "") if isinstance(fields.get("text"), str) else ""
    layer = pdf_text(data) if job.content_type == "application/pdf" else ""
    text_for_checks = "\n".join(
        part
        for part in (ai_text, layer, data.decode("utf-8", "replace") if job.content_type == "text/plain" else "")
        if part
    )
    extracted, issues = clean(fields, text_for_checks)

    job.text = (ai_text or layer)[:200_000]
    job.extracted = extracted
    job.validation = issues
    job.last_error = ""
    job.save()
    record(job, Action.EXTRACTED, after=extracted)

    evaluate(job)
    if not job.review_reasons:
        try:
            apply_links(job.pk, actor=None, links=job.selected, auto=True)
            return "done"
        except ReviewError as error:
            # Something changed between the check and the save: a person looks.
            job.refresh_from_db()
            job.review_reasons = [{"code": "recheck_failed", "message": str(error)}]
            job.save(update_fields=["review_reasons", "updated_at"])

    DocumentJob.objects.filter(pk=job.pk).update(status=Status.NEEDS_REVIEW)
    record(job, Action.NEEDS_REVIEW, after=[reason["message"] for reason in job.review_reasons])
    return "done"


# ------------------------------------------------------------ 4-7: deciding


def evaluate(job, *, keep_selection=False):
    """Look the fields up again, refresh the proposals, pre-select single
    candidates, and work out why a person must look. Saves the job."""
    job.proposals = find_candidates(job, job.extracted or {}, job.validation or [])
    selected = dict(job.selected or {}) if keep_selection else {}
    for entity in ENTITIES:
        candidates = job.proposals.get(entity, [])
        ids = {candidate["id"] for candidate in candidates}
        if entity in selected and selected[entity] not in ids and not keep_selection:
            selected.pop(entity)
        if entity not in selected and len(candidates) == 1:
            selected[entity] = candidates[0]["id"]
    job.selected = selected
    job.review_reasons = review_reasons(job)
    job.save(update_fields=["proposals", "selected", "review_reasons", "updated_at"])


def _links(selection):
    """{"package": 4} -> {"package": <Package 4>}, loaded fresh from the database."""
    return {entity: load(entity, selection.get(entity)) for entity in ENTITIES if selection.get(entity)}


def review_reasons(job):
    """Every reason a person has to look. Empty list = safe to link by itself."""
    reasons = []

    def add(code, message):
        reasons.append({"code": code, "message": message})

    extracted = job.extracted or {}
    for item in job.validation or []:
        add(
            f"check:{item['field']}",
            item["message"] if item["field"] == "text" else f"{item['field']}: {item['message']}",
        )

    proposals = job.proposals or {}
    for entity in ENTITIES:
        candidates = proposals.get(entity, [])
        if len(candidates) > 1:
            add(f"conflict:{entity}", f"More than one possible {entity} was found; pick the right one.")
        chosen = next((c for c in candidates if c["id"] == (job.selected or {}).get(entity)), None)
        if chosen is not None and not chosen["strong"]:
            add(f"weak:{entity}", f"The {entity} match rests on a value that did not pass the checks.")

    if not proposals.get("package"):
        add("no_package", "No shipment could be identified from the document.")
    if not proposals.get("customer"):
        add("no_customer", "No customer could be identified from the document.")

    # Money is always checked by a person.
    if proposals.get("invoice") or extracted.get("document_type") == "our_invoice":
        add("financial", "The document concerns one of our invoices. Invoices are always checked by a person.")

    for problem in check_links(job, _links(job.selected or {})):
        add("recheck", problem)
    return reasons


def check_links(job, links):
    """The rules every set of links must pass, both automatic and human.
    Returns a list of problems (empty = fine). Reads the records as they are
    in the database right now."""
    problems = []
    customer, package = links.get("customer"), links.get("package")
    order, invoice = links.get("order"), links.get("invoice")

    for entity, obj in links.items():
        if obj is None:
            problems.append(f"The selected {entity} no longer exists.")

    # Everything must belong to one and the same customer.
    owners = {entity: owner_of(entity, obj) for entity, obj in links.items() if obj is not None}
    distinct = {owner for owner in owners.values() if owner is not None}
    if len(distinct) > 1:
        problems.append(
            "The selected records belong to different customers: "
            + ", ".join(f"{entity} {label_for(entity, links[entity])}" for entity in owners)
        )
    if invoice is not None and package is not None and invoice.package_id != package.pk:
        problems.append("The selected invoice is for a different shipment than the selected shipment.")

    # The document's origin cannot be overruled: a customer's own upload stays theirs.
    document = job.package_document
    if document is not None:
        if customer is not None and customer.pk != document.customer_id:
            problems.append("The document was uploaded by a different customer than the one selected.")
        if package is not None and package.user_id != document.customer_id:
            problems.append("The selected shipment belongs to another customer than the one who uploaded it.")
        if package is not None and document.package_id not in (None, package.pk, job.package_id):
            problems.append(
                "The customer filed this document on another shipment. Move it on the Documents page first."
            )
        if package is not None and document.package_id != package.pk and package.locked:
            problems.append(f"{package.lock_reason} The document cannot be filed on it any more.")
    attachment = job.booking_attachment
    if attachment is not None:
        if attachment.booking.user_id and customer is not None and customer.pk != attachment.booking.user_id:
            problems.append("The booking belongs to a different customer than the one selected.")
        if attachment.order_id and order is not None and order.pk != attachment.order_id:
            problems.append("The document belongs to a different shop order than the one selected.")

    # A document we file into the customer's documents needs a customer.
    if job.source in (DocumentJob.Source.EMAIL, DocumentJob.Source.STAFF_UPLOAD, DocumentJob.Source.WAREHOUSE_PHOTO):
        if package is not None and customer is None and package.user_id is None:
            problems.append("The selected shipment has no customer to file the document under.")
    return problems


# ------------------------------------------------------------- 8-9: linking


def _file_copy(job, customer, package, actor):
    """Put an e-mailed/uploaded document in the customer's documents, once."""
    with job.file.open("rb") as handle:
        data = handle.read()
    extension = os.path.splitext(job.file.name)[1].lower() or ".pdf"
    if extension not in PackageDocument.SIGNATURES:
        return None  # e.g. an e-mail's plain text: nothing to file
    document = PackageDocument(
        customer=customer,
        package=package,
        uploaded_by=actor,
        kind=FILED_KIND.get((job.extracted or {}).get("document_type"), PackageDocument.Kind.OTHER),
        original_name=job.original_name or f"document{extension}",
        content_type=PackageDocument.CONTENT_TYPES[extension],
        size_bytes=len(data),
        note=f"Read from {job.get_source_display().lower()} (document job {job.pk})"[:255],
    )
    document.file.save(f"document{extension}", ContentFile(data), save=False)
    document.save()
    return document


def apply_links(job_id, *, actor, links, auto=False, reason=""):
    """Save the links of a job, and update the existing records. All or nothing.

    `links` is {"customer": id, "package": id, "order": id, "invoice": id}
    (any may be missing). Every id is loaded and checked again here, under a
    row lock on the job, so two people confirming at once cannot both win and
    nothing stale is saved. Raises ReviewError / NotAllowed.
    """
    with transaction.atomic():
        job = DocumentJob.objects.select_for_update().get(pk=job_id)
        if job.status == Status.RESOLVED:
            raise ReviewError("This job is already resolved.")
        # The automatic run links while it still holds the job ("processing");
        # a person has to wait until the reading is finished.
        if job.status == Status.QUEUED or (job.status == Status.PROCESSING and not auto):
            raise ReviewError("The document is still being read. Try again in a moment.")

        clean_ids = {entity: int(links[entity]) for entity in ENTITIES if links.get(entity) not in (None, "")}
        if not clean_ids:
            raise ReviewError("Select at least one record to link.")
        objects = _links(clean_ids)

        # Money: only an admin may link an invoice, and never the machine.
        if "invoice" in objects:
            if auto:
                raise ReviewError("Invoices are never linked automatically.")
            if actor is None or not getattr(actor, "is_admin", False):
                raise NotAllowed("Only an admin can link a document to an invoice.")

        # The customer follows from the records when it was not chosen.
        if "customer" not in objects:
            for entity in ("package", "order", "invoice"):
                owner = owner_of(entity, objects.get(entity))
                if owner:
                    objects["customer"] = load("customer", owner)
                    break

        problems = check_links(job, objects)
        if problems:
            raise ReviewError(" ".join(problems))

        before = {
            "customer": job.customer_id,
            "package": job.package_id,
            "order": job.booking_order_id,
            "invoice": job.invoice_id,
        }
        customer, package = objects.get("customer"), objects.get("package")
        job.customer = customer
        job.package = package
        job.booking_order = objects.get("order")
        job.invoice = objects.get("invoice")
        after = {
            "customer": job.customer_id,
            "package": job.package_id,
            "order": job.booking_order_id,
            "invoice": job.invoice_id,
        }

        # Update the existing records, so the website shows the result.
        document = job.package_document
        if document is not None:
            document = PackageDocument.objects.select_for_update().get(pk=document.pk)
            target = package.pk if package is not None else None
            # Only ever move it if it is unfiled, or filed by an earlier link of this job.
            if (
                target is not None
                and document.package_id != target
                and document.package_id in (None, before["package"])
            ):
                old = document.package_id
                document.package_id = target
                document.save(update_fields=["package"])
                record(
                    job,
                    Action.RECORD_UPDATED,
                    actor,
                    field="package_document.package",
                    before=old,
                    after=target,
                    reason=reason,
                )

        if job.file and customer is not None and job.source != DocumentJob.Source.CUSTOMER_DOCUMENT:
            if job.filed_document_id is None:
                filed = _file_copy(job, customer, package, actor)
                if filed is not None:
                    job.filed_document = filed
                    record(
                        job,
                        Action.RECORD_UPDATED,
                        actor,
                        field="filed_document",
                        before=None,
                        after=filed.pk,
                        reason=reason,
                    )
            else:
                filed = PackageDocument.objects.select_for_update().get(pk=job.filed_document_id)
                old = {"customer": filed.customer_id, "package": filed.package_id}
                new = {"customer": customer.pk, "package": package.pk if package else None}
                if old != new:
                    filed.customer_id, filed.package_id = new["customer"], new["package"]
                    filed.save(update_fields=["customer", "package"])
                    record(
                        job, Action.RECORD_UPDATED, actor, field="filed_document", before=old, after=new, reason=reason
                    )

        job.selected = {entity: obj.pk for entity, obj in objects.items() if obj is not None}
        job.status = Status.LINKED
        job.auto_linked = auto
        job.review_reasons = [] if auto else job.review_reasons
        job.resolved_by = actor
        job.resolved_at = timezone.now()
        job.save()
        record(
            job,
            Action.AUTO_LINKED if auto else Action.CONFIRMED,
            actor,
            field="links",
            before=before,
            after=after,
            reason=reason,
        )
        return job


# ---------------------------------------------------------- human actions


def _open_job(job_id, *, allow_linked=True):
    job = DocumentJob.objects.select_for_update().get(pk=job_id)
    if job.status in (Status.QUEUED, Status.PROCESSING):
        raise ReviewError("The document is still being read. Try again in a moment.")
    if job.status == Status.RESOLVED or (job.status == Status.LINKED and not allow_linked):
        raise ReviewError("This job is closed.")
    return job


def edit_fields(job_id, *, actor, changes, reason):
    """A person corrects what was read. Every changed field is audited, then
    the lookups run again. Values typed by a person are trusted even when the
    OCR text does not contain them (the OCR may be what was wrong)."""
    if not (reason or "").strip():
        raise ReviewError("Say why the fields were changed.")
    unknown = set(changes) - EDITABLE_FIELDS
    if unknown:
        raise ReviewError(f"These fields cannot be edited: {', '.join(sorted(unknown))}.")
    with transaction.atomic():
        job = _open_job(job_id)
        current = dict(job.extracted or {})
        human = set(current.pop("_human_fields", []))
        merged = dict(current)
        changed = []
        for field, value in changes.items():
            if field in LIST_FIELDS:
                value = (
                    [str(item) for item in value]
                    if isinstance(value, list)
                    else [part.strip() for part in str(value or "").split(",") if part.strip()]
                )
            else:
                value = str(value or "")
            if merged.get(field) != value:
                changed.append(field)
                merged[field] = value
        if not changed:
            raise ReviewError("Nothing was changed.")

        extracted, issues = clean({**merged, "text": job.text}, job.text)
        human |= set(changed)
        issues = [item for item in issues if not (item["field"] in human and item["code"] == "not_in_text")]
        if not job.text:
            # A person typed the fields in by hand (e.g. the AI failed): the
            # "no text" warning is not a reason to distrust them.
            issues = [item for item in issues if item["code"] != "no_text"]
        for field in changed:
            record(
                job,
                Action.FIELD_EDITED,
                actor,
                field=field,
                before=current.get(field),
                after=extracted.get(field),
                reason=reason,
            )
        extracted["_human_fields"] = sorted(human)
        job.extracted = extracted
        job.validation = issues
        if job.status == Status.FAILED:
            job.status = Status.NEEDS_REVIEW
        job.save()
        evaluate(job)
        return job


def select(job_id, *, actor, entity, pk):
    """A person picks the right record (or clears the choice with pk=None)."""
    if entity not in ENTITIES:
        raise ReviewError("Unknown kind of record.")
    if entity == "invoice" and pk is not None and not getattr(actor, "is_admin", False):
        raise NotAllowed("Only an admin can link a document to an invoice.")
    with transaction.atomic():
        job = _open_job(job_id)
        if pk is not None and load(entity, pk) is None:
            raise ReviewError(f"That {entity} does not exist.")
        before = (job.selected or {}).get(entity)
        selected = dict(job.selected or {})
        if pk is None:
            selected.pop(entity, None)
        else:
            selected[entity] = int(pk)
        job.selected = selected
        record(job, Action.MATCH_SELECTED, actor, field=entity, before=before, after=selected.get(entity))
        job.review_reasons = review_reasons(job)
        job.save(update_fields=["selected", "review_reasons", "updated_at"])
        return job


def reject(job_id, *, actor, entity, pk, reason):
    """A person says a proposed record is wrong. It is never proposed again for this job."""
    if entity not in ENTITIES:
        raise ReviewError("Unknown kind of record.")
    if not (reason or "").strip():
        raise ReviewError("Say why the match is wrong.")
    with transaction.atomic():
        job = _open_job(job_id)
        rejected = {key: list(value) for key, value in (job.rejected or {}).items()}
        if int(pk) not in rejected.setdefault(entity, []):
            rejected[entity].append(int(pk))
        job.rejected = rejected
        selected = dict(job.selected or {})
        if selected.get(entity) == int(pk):
            selected.pop(entity)
        job.selected = selected
        job.save(update_fields=["rejected", "selected", "updated_at"])
        record(job, Action.MATCH_REJECTED, actor, field=entity, before=int(pk), after=None, reason=reason)
        evaluate(job, keep_selection=True)
        return job


def confirm(job_id, *, actor, reason=""):
    """A person confirms the selected records: they are linked (step 8)."""
    job = DocumentJob.objects.get(pk=job_id)
    return apply_links(job_id, actor=actor, links=job.selected or {}, reason=reason)


def retry(job_id, *, actor):
    """Read the document again with OCR + AI (a new attempt)."""
    with transaction.atomic():
        job = _open_job(job_id, allow_linked=False)
        job.status = Status.QUEUED
        job.save(update_fields=["status", "updated_at"])
        record(job, Action.RETRY_REQUESTED, actor)
    enqueue(job)
    return job


def resolve(job_id, *, actor, reason):
    """A person closes the job, with or without links (e.g. "not ours", "spam")."""
    if not (reason or "").strip():
        raise ReviewError("Say why the job is resolved.")
    with transaction.atomic():
        job = _open_job(job_id)
        before = job.status
        job.status = Status.RESOLVED
        job.resolved_by = actor
        job.resolved_at = timezone.now()
        job.save(update_fields=["status", "resolved_by", "resolved_at", "updated_at"])
        record(job, Action.RESOLVED, actor, field="status", before=before, after=Status.RESOLVED, reason=reason)
        return job
