"""What the Document review page receives. Read-only: every change goes
through the actions in docreview/views.py -> docreview/pipeline.py."""

from rest_framework import serializers

from .matching import ENTITIES, label_for, load
from .models import DocumentJob, DocumentJobAttempt, DocumentJobEvent


def person(user):
    if user is None:
        return ""
    return user.get_full_name().strip() or user.email


class DocumentJobListSerializer(serializers.ModelSerializer):
    source_display = serializers.CharField(source="get_source_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    document_type = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    reasons = serializers.SerializerMethodField()
    customer_label = serializers.SerializerMethodField()
    package_label = serializers.SerializerMethodField()

    class Meta:
        model = DocumentJob
        fields = [
            "id",
            "source",
            "source_display",
            "status",
            "status_display",
            "original_name",
            "content_type",
            "document_type",
            "summary",
            "reasons",
            "customer_label",
            "package_label",
            "auto_linked",
            "attempts_count",
            "last_error",
            "created_at",
            "updated_at",
        ]

    def get_document_type(self, job):
        return (job.extracted or {}).get("document_type", "")

    def get_summary(self, job):
        return (job.extracted or {}).get("summary", "")

    def get_reasons(self, job):
        return len(job.review_reasons or [])

    def get_customer_label(self, job):
        return label_for("customer", job.customer)

    def get_package_label(self, job):
        return job.package.tracking_number if job.package_id else ""


class AttemptSerializer(serializers.ModelSerializer):
    requested_by = serializers.SerializerMethodField()

    class Meta:
        model = DocumentJobAttempt
        fields = [
            "number",
            "started_at",
            "finished_at",
            "ok",
            "model",
            "error",
            "raw_result",
            "input_tokens",
            "output_tokens",
            "requested_by",
        ]

    def get_requested_by(self, attempt):
        return person(attempt.requested_by)


class EventSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = DocumentJobEvent
        fields = ["id", "action", "action_display", "actor", "field", "before", "after", "reason", "created_at"]

    def get_actor(self, event):
        # Empty = the automatic processing did it.
        return person(event.actor)


class DocumentJobDetailSerializer(DocumentJobListSerializer):
    attempts = AttemptSerializer(many=True, read_only=True)
    events = EventSerializer(many=True, read_only=True)
    uploaded_by = serializers.SerializerMethodField()
    resolved_by = serializers.SerializerMethodField()
    selected_labels = serializers.SerializerMethodField()
    links = serializers.SerializerMethodField()
    can_link_invoice = serializers.SerializerMethodField()
    extracted = serializers.SerializerMethodField()
    human_fields = serializers.SerializerMethodField()

    class Meta(DocumentJobListSerializer.Meta):
        fields = DocumentJobListSerializer.Meta.fields + [
            "size_bytes",
            "sha256",
            "source_meta",
            "note",
            "uploaded_by",
            "extracted",
            "human_fields",
            "text",
            "validation",
            "review_reasons",
            "proposals",
            "selected",
            "selected_labels",
            "rejected",
            "links",
            "filed_document",
            "resolved_by",
            "resolved_at",
            "attempts",
            "events",
            "can_link_invoice",
        ]

    def get_uploaded_by(self, job):
        return person(job.uploaded_by)

    def get_resolved_by(self, job):
        return person(job.resolved_by)

    def get_extracted(self, job):
        return {key: value for key, value in (job.extracted or {}).items() if not key.startswith("_")}

    def get_human_fields(self, job):
        return (job.extracted or {}).get("_human_fields", [])

    def get_selected_labels(self, job):
        """A label for each selected record, also when it was picked by hand
        (and so is not among the proposals)."""
        return {
            entity: label_for(entity, load(entity, pk)) or "(no longer exists)"
            for entity, pk in (job.selected or {}).items()
            if entity in ENTITIES
        }

    def get_links(self, job):
        objects = {
            "customer": job.customer,
            "package": job.package,
            "order": job.booking_order,
            "invoice": job.invoice,
        }
        return {
            entity: {"id": obj.pk, "label": label_for(entity, obj)} if obj is not None else None
            for entity, obj in objects.items()
        }

    def get_can_link_invoice(self, job):
        request = self.context.get("request")
        return bool(request and getattr(request.user, "is_admin", False))
