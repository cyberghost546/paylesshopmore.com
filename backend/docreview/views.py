"""The Document review API.

    /api/staff/document-jobs/                  GET list (?status= ?source= ?search=)
                                               POST upload a file to be read
    /api/staff/document-jobs/<id>/             GET everything about one job
    /api/staff/document-jobs/<id>/file/        GET the original document
    /api/staff/document-jobs/<id>/candidates/  GET ?entity=package&q=... records to pick from
    /api/staff/document-jobs/<id>/fields/      POST {"changes": {...}, "reason": "..."}
    /api/staff/document-jobs/<id>/select/      POST {"entity": "package", "id": 4 | null}
    /api/staff/document-jobs/<id>/reject/      POST {"entity": "package", "id": 4, "reason": "..."}
    /api/staff/document-jobs/<id>/confirm/     POST {"reason": "..."}
    /api/staff/document-jobs/<id>/retry/       POST
    /api/staff/document-jobs/<id>/resolve/     POST {"reason": "..."}

    /api/integrations/v1/documents/            POST an e-mail (API key with "documents:write")

Who may do what:
  * Office staff (IsStaff) see and work every job. Customers never reach any
    of this: their own uploads go in through their own pages, and they never
    see another customer's anything.
  * Warehouse workers may only UPLOAD (a photo of a label); the answer is the
    new job, nothing else.
  * Linking a document to an invoice needs an admin (pipeline.NotAllowed).

Every action is done by docreview/pipeline.py, which re-checks the records
and writes the audit log.
"""

import base64
import binascii
import hashlib

from django.http import FileResponse, Http404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from integrations.models import Scope
from integrations.views import IntegrationView
from staff.permissions import IsStaff, IsWarehouseOrStaff

from . import pipeline
from .matching import ENTITIES, label_for, search
from .models import DocumentJob
from .serializers import DocumentJobDetailSerializer, DocumentJobListSerializer


def _answer(call):
    """Run a pipeline action; turn its errors into 400 / 403 answers."""
    try:
        return call()
    except pipeline.NotAllowed as error:
        return Response({"detail": str(error)}, status=status.HTTP_403_FORBIDDEN)
    except pipeline.ReviewError as error:
        return Response({"detail": str(error)}, status=status.HTTP_400_BAD_REQUEST)
    except DocumentJob.DoesNotExist:
        raise Http404 from None


class DocumentJobViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    def get_permissions(self):
        if self.action == "create":
            return [IsWarehouseOrStaff()]
        return [IsStaff()]

    def get_queryset(self):
        jobs = DocumentJob.objects.select_related("customer", "package", "booking_order", "invoice")
        if self.action == "retrieve":
            jobs = jobs.prefetch_related("attempts__requested_by", "events__actor").select_related(
                "uploaded_by", "resolved_by", "package_document", "booking_attachment"
            )
        params = self.request.query_params
        if params.get("status") in DocumentJob.Status.values:
            jobs = jobs.filter(status=params["status"])
        if params.get("source") in DocumentJob.Source.values:
            jobs = jobs.filter(source=params["source"])
        term = params.get("search", "").strip()
        if term:
            from django.db.models import Q

            jobs = jobs.filter(
                Q(original_name__icontains=term)
                | Q(text__icontains=term)
                | Q(customer__email__icontains=term)
                | Q(package__tracking_number__icontains=term)
            )
        return jobs

    def get_serializer_class(self):
        return DocumentJobDetailSerializer if self.action != "list" else DocumentJobListSerializer

    def _detail(self, job, code=status.HTTP_200_OK):
        job = self.get_queryset().get(pk=job.pk) if self.action != "retrieve" else job
        return Response(DocumentJobDetailSerializer(job, context=self.get_serializer_context()).data, status=code)

    def create(self, request):
        """Upload a file to be read. Warehouse workers' uploads count as warehouse photos."""
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Choose a file."})
        source = (
            DocumentJob.Source.STAFF_UPLOAD
            if request.user.is_staff and request.data.get("source") != DocumentJob.Source.WAREHOUSE_PHOTO
            else DocumentJob.Source.WAREHOUSE_PHOTO
        )
        try:
            job, created = pipeline.job_from_upload(
                upload, actor=request.user, source=source, note=str(request.data.get("note", ""))
            )
        except pipeline.ReviewError as error:
            raise ValidationError({"file": str(error)}) from None
        code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
        if not request.user.is_staff:
            return Response({"id": job.pk, "status": job.status}, status=code)
        return Response(DocumentJobDetailSerializer(job, context=self.get_serializer_context()).data, status=code)

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        """The original document, for the preview. Never served from a public URL."""
        job = self.get_object()
        try:
            data = pipeline.read_bytes(job)
        except pipeline.ai.ExtractionError:
            raise Http404("The original document is no longer stored.") from None
        # The type comes from the file's own first bytes, never from the
        # uploader: a file that is not one of ours is sent as a download.
        detected, _ = pipeline.detect_type(data)
        content_type = detected or (
            "text/plain; charset=utf-8" if job.content_type == "text/plain" else "application/octet-stream"
        )
        import io

        response = FileResponse(
            io.BytesIO(data), content_type=content_type, as_attachment=True, filename=f"document-{job.pk}"
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response

    @action(detail=True, methods=["get"])
    def candidates(self, request, pk=None):
        """Existing records a person can pick, for the search box."""
        self.get_object()
        entity = request.query_params.get("entity", "")
        if entity not in ENTITIES:
            raise ValidationError({"entity": f"One of: {', '.join(ENTITIES)}."})
        results = search(entity, request.query_params.get("q", ""))
        return Response([{"id": obj.pk, "label": label_for(entity, obj)} for obj in results])

    @action(detail=True, methods=["post"])
    def fields(self, request, pk=None):
        changes = request.data.get("changes")
        if not isinstance(changes, dict):
            raise ValidationError({"changes": "Send the changed fields as an object."})
        return _answer(
            lambda: self._detail(
                pipeline.edit_fields(
                    int(pk), actor=request.user, changes=changes, reason=str(request.data.get("reason", ""))
                )
            )
        )

    @action(detail=True, methods=["post"])
    def select(self, request, pk=None):
        chosen = request.data.get("id")
        if chosen not in (None, ""):
            try:
                chosen = int(chosen)
            except (TypeError, ValueError):
                raise ValidationError({"id": "Must be a number."}) from None
        else:
            chosen = None
        return _answer(
            lambda: self._detail(
                pipeline.select(int(pk), actor=request.user, entity=str(request.data.get("entity", "")), pk=chosen)
            )
        )

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        try:
            rejected = int(request.data.get("id"))
        except (TypeError, ValueError):
            raise ValidationError({"id": "Must be a number."}) from None
        return _answer(
            lambda: self._detail(
                pipeline.reject(
                    int(pk),
                    actor=request.user,
                    entity=str(request.data.get("entity", "")),
                    pk=rejected,
                    reason=str(request.data.get("reason", "")),
                )
            )
        )

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        return _answer(
            lambda: self._detail(
                pipeline.confirm(int(pk), actor=request.user, reason=str(request.data.get("reason", "")))
            )
        )

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        return _answer(lambda: self._detail(pipeline.retry(int(pk), actor=request.user)))

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        return _answer(
            lambda: self._detail(
                pipeline.resolve(int(pk), actor=request.user, reason=str(request.data.get("reason", "")))
            )
        )


class InboundEmailView(IntegrationView):
    """POST /api/integrations/v1/documents/ - an e-mail to read.

    For a mail service (Postmark, Mailgun, a Cloudflare Email Worker ...) that
    turns e-mails sent to e.g. documents@paylesshopmore.com into a web request.
    Needs an API key with the "documents:write" scope (dashboard -> Integrations).

    Body:
        {"id": "<the e-mail's Message-ID>",
         "from": "shop@example.com", "subject": "Your order", "text": "...",
         "attachments": [{"filename": "invoice.pdf", "content": "<base64>"}]}

    Answers 202 with the jobs made. Sending the same "id" again is safe: the
    same jobs come back (200). Everything in the e-mail is untrusted: it is
    stored as text, shown as text, and given to the AI as data.
    """

    required_scope = Scope.DOCUMENTS_WRITE
    MAX_ATTACHMENTS = 10
    MAX_TEXT = 50_000

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        attachments = body.get("attachments") or []
        if not isinstance(attachments, list) or len(attachments) > self.MAX_ATTACHMENTS:
            raise ValidationError({"attachments": f"A list of at most {self.MAX_ATTACHMENTS} files."})

        files = []
        for item in attachments:
            if not isinstance(item, dict):
                raise ValidationError({"attachments": "Each attachment is an object."})
            try:
                data = base64.b64decode(str(item.get("content", "")), validate=True)
            except (binascii.Error, ValueError):
                raise ValidationError({"attachments": "content must be base64."}) from None
            if len(data) > pipeline.MAX_BYTES:
                raise ValidationError({"attachments": "Each attachment can be at most 10 MB."})
            files.append((str(item.get("filename", ""))[:255], data))

        text = str(body.get("text", ""))[: self.MAX_TEXT]
        message_id = str(body.get("id", "")).strip()[:150]
        if not message_id:
            # No id from the mail service: the content itself identifies the e-mail.
            digest = hashlib.sha256(text.encode() + b"".join(data for _, data in files)).hexdigest()
            message_id = f"sha256-{digest}"

        results = pipeline.jobs_from_email(
            key_id=request.auth.pk,
            message_id=message_id,
            sender=str(body.get("from", "")),
            subject=str(body.get("subject", "")),
            body=text,
            attachments=files,
        )
        created = any(made for _, made in results)
        return Response(
            {"jobs": [{"id": job.pk, "status": job.status} for job, _ in results]},
            status=status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK,
        )
