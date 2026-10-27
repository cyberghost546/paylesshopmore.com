"""The database tables for pre-alerts.

THE BIG PICTURE
    PreAlert  1 --- *    PreAlertDocument   (the shop's invoice, as files)
    PreAlert  1 --- 0..1 tracking.CarrierShipment   (the courier tracking)
    PreAlert  * --- 0..1 accounts.Package    (our shipment, once it is in one)

A pre-alert is the customer's word that a parcel is coming. It is NOT a
received package: nothing here says the parcel has arrived until the
warehouse scans it (status ARRIVED), and it only becomes part of one of our
shipments when the office adds it to one (status IN_SHIPMENT).
"""

import os
import uuid

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone


class PreAlert(models.Model):
    class Status(models.TextChoices):
        # The customer sent it; the parcel is on its way to us (or not yet sent
        # by the shop). Where it is exactly is the courier tracking's job.
        SUBMITTED = "submitted", "Pre-alert submitted"
        # Scanned at our warehouse (tracking.matching.confirm_arrival).
        ARRIVED = "arrived", "Arrived at warehouse"
        # Added to one of our shipments (accounts.Package) by the office.
        IN_SHIPMENT = "in_shipment", "Added to a shipment"
        # Withdrawn by the customer before it arrived, or by the office.
        CANCELLED = "cancelled", "Cancelled"

    class Currency(models.TextChoices):
        EUR = "EUR", "Euro (€)"
        USD = "USD", "US dollar ($)"

    # Shown to the customer and staff: "PA-2026-000123". Set right after the
    # row is first saved, from its id, so two pre-alerts can never share one.
    reference = models.CharField(max_length=20, unique=True, blank=True)

    # Whose parcel this is: always the signed-in customer who sent the form.
    # SET_NULL: an erased account leaves the record (the parcel may still be
    # on a shelf) without anything personal on it.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="prealerts",
    )

    # The courier and its tracking number. The number is stored cleaned up
    # (tracking.normalize), so the warehouse's scan matches it exactly.
    carrier = models.ForeignKey("tracking.Carrier", on_delete=models.PROTECT, related_name="prealerts")
    tracking_number = models.CharField(max_length=64, db_index=True)

    # The shop: one from our list, or "other" with the name typed.
    shop = models.ForeignKey(
        "shops.Shop", on_delete=models.SET_NULL, null=True, blank=True, related_name="prealerts"
    )
    shop_name = models.CharField(max_length=80)

    description = models.CharField(max_length=500)

    # Who receives it at the destination, and where. The address is one of the
    # customer's own; its text is copied in, so the record still says where
    # it was meant to go if the address is edited or deleted later.
    consignee_name = models.CharField(max_length=150)
    consignee_address = models.ForeignKey(
        "accounts.Address", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    consignee_address_text = models.TextField(blank=True)

    # What the customer says it is worth: for customs and for a claim.
    # Optional: the pre-alert form no longer asks for it, so it is empty
    # (None) unless staff fill it in later.
    declared_value = models.DecimalField(
        max_digits=10, decimal_places=2, validators=[MinValueValidator(0.01)], null=True, blank=True
    )
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.EUR)

    # When the customer ticked "I have read the list of restricted items".
    # Required: the form cannot be sent without it.
    restricted_items_confirmed_at = models.DateTimeField()

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)

    # Set by the warehouse scan.
    arrived_at = models.DateTimeField(null=True, blank=True)
    arrived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Set by the office when it adds the parcel to one of our shipments.
    package = models.ForeignKey(
        "accounts.Package", on_delete=models.SET_NULL, null=True, blank=True, related_name="prealerts"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"]), models.Index(fields=["status"])]
        constraints = [
            # One live pre-alert per tracking number. Two would leave the
            # warehouse unable to tell whose parcel it is (matching refuses a
            # number on two orders). A cancelled one does not count.
            models.UniqueConstraint(
                fields=["tracking_number"],
                condition=~Q(status="cancelled"),
                name="prealert_one_live_per_tracking_number",
            ),
        ]

    def __str__(self):
        return f"{self.reference or 'Pre-alert'} {self.tracking_number}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.reference:
            # From the id, which the database has just handed out: unique.
            self.reference = f"PA-{timezone.localdate():%Y}-{self.pk:06d}"
            PreAlert.objects.filter(pk=self.pk).update(reference=self.reference)

    @property
    def can_cancel(self):
        """The customer may withdraw it only while the parcel is not with us yet."""
        return self.status == self.Status.SUBMITTED


def prealert_document_path(instance, filename):
    """Where an invoice is stored: a random name, never the customer's own.

    The extension has already been checked against the file's contents (see
    serializers.validate_document) by the time this runs.
    """
    extension = os.path.splitext(filename or "")[1].lower()
    return f"prealerts/{timezone.now():%Y}/{instance.prealert_id}/{uuid.uuid4().hex}{extension}"


class PreAlertDocument(models.Model):
    """One file of the shop's invoice. Served only through a view that checks
    who is asking - never from a public URL."""

    MAX_PER_PREALERT = 5

    prealert = models.ForeignKey(PreAlert, on_delete=models.CASCADE, related_name="documents")
    file = models.FileField(upload_to=prealert_document_path)
    original_name = models.CharField(max_length=255, blank=True)
    content_type = models.CharField(max_length=100)
    size_bytes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return self.original_name or os.path.basename(self.file.name)
