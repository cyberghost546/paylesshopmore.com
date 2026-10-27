"""Finding the existing records a document is about. Plain database lookups.

READ THIS FIRST
---------------
No AI here. `find_candidates(job, extracted, issues)` takes the fields the AI
read (after docreview/validation.py checked them) and looks them up with
EXACT matches only:

    what was read                 looked up as
    ----------------------------  ---------------------------------------------
    customer_code  PLSM-C00012    User.customer_number = 12
    customer_email                User.email (same address, any case)
    shipment_numbers PLSM-00012   Package.tracking_number
    carrier_tracking_numbers      PreAlert / CarrierShipment tracking number,
                                  BookingOrder.tracking_code
    invoice_number PLSM20260011   Invoice.reference (or INV-2026-00012 -> id 12)

plus what the document's origin already tells us (a receipt uploaded by a
customer belongs to that customer; a booking attachment belongs to that
booking's order). From each record found we follow the existing relations:
a package tells us its owner, a pre-alert its package and customer, and so on.

The result, per kind of record ("customer", "package", "order", "invoice"):

    [{"id": 12, "label": "PLSM-00012 · 2 boxes · Ana Silva",
      "reasons": ["Shipment number PLSM-00012 is printed on the document"],
      "strong": True}]

`strong` means: found through an identifier that passed every check
(right format AND really present in the document text), or through the
document's origin. Only strong candidates may ever be linked automatically
(docreview/pipeline.py decides). Weak ones are shown to a person.

Records a person has rejected for this job are never proposed again.
"""

import re

from django.contrib.auth import get_user_model
from django.db.models import Q

from accounts.models import Package
from bookings.models import BookingOrder
from invoicing.models import Invoice
from prealerts.models import PreAlert
from tracking.models import CarrierShipment
from tracking.normalize import InvalidTrackingNumber, normalize_tracking_number

from .validation import untrusted_values

User = get_user_model()

ENTITIES = ("customer", "package", "order", "invoice")

OUR_INVOICE_RE = re.compile(r"^(PLSM\d{8,}|INV-\d{4}-(\d{5,}))$", re.IGNORECASE)


# ------------------------------------------------------------ labels & loading


def label_for(entity, obj):
    """A short line a person recognises the record by."""
    if obj is None:
        return ""
    if entity == "customer":
        name = obj.get_full_name().strip() or obj.email or f"#{obj.pk}"
        code = obj.customer_code if obj.customer_number else ""
        return " · ".join(part for part in (name, obj.email, code) if part)
    if entity == "package":
        owner = obj.user.get_full_name().strip() if obj.user_id else ""
        return " · ".join(part for part in (obj.tracking_number, (obj.description or "")[:40], owner) if part)
    if entity == "order":
        who = ""
        if obj.booking.user_id:
            who = obj.booking.user.get_full_name().strip() or obj.booking.user.email
        return f"{obj.shop_name}: {obj.description[:40]} (booking #{obj.booking_id}{', ' + who if who else ''})"
    if entity == "invoice":
        from invoicing.pdf import invoice_number

        return f"{invoice_number(obj)} · {obj.get_status_display()} · {obj.package.tracking_number}"
    return str(obj)


def queryset_for(entity):
    """The records a person may pick from, per kind. Deleted (anonymised)
    customers are left out: a document cannot belong to them any more."""
    if entity == "customer":
        return User.objects.filter(is_active=True, anonymised_at__isnull=True)
    if entity == "package":
        return Package.objects.select_related("user")
    if entity == "order":
        return BookingOrder.objects.select_related("booking", "booking__user")
    if entity == "invoice":
        return Invoice.objects.select_related("package")
    raise ValueError(entity)


def load(entity, pk):
    """The record, or None. Never trusts that an id exists."""
    if pk in (None, ""):
        return None
    try:
        return queryset_for(entity).get(pk=int(pk))
    except (ValueError, TypeError, queryset_for(entity).model.DoesNotExist):
        return None


def owner_of(entity, obj):
    """The customer a record belongs to (its user id), or None."""
    if obj is None:
        return None
    if entity == "customer":
        return obj.pk
    if entity == "package":
        return obj.user_id
    if entity == "order":
        return obj.booking.user_id
    if entity == "invoice":
        return obj.package.user_id
    return None


def search(entity, query, limit=10):
    """For the review screen's "pick a record" box. Staff only (checked by the view)."""
    query = (query or "").strip()
    records = queryset_for(entity)
    if not query:
        return list(records.order_by("-pk")[:limit])
    if entity == "customer":
        match = Q(email__icontains=query) | Q(first_name__icontains=query) | Q(last_name__icontains=query)
        digits = re.sub(r"\D", "", query)
        if query.upper().startswith("PLSM-C") and digits:
            match |= Q(customer_number=int(digits))
        records = records.filter(match)
    elif entity == "package":
        records = records.filter(
            Q(tracking_number__icontains=query) | Q(description__icontains=query) | Q(user__email__icontains=query)
        )
    elif entity == "order":
        records = records.filter(
            Q(shop_name__icontains=query)
            | Q(description__icontains=query)
            | Q(tracking_code__icontains=query)
            | Q(booking__shipping_number__icontains=query)
            | Q(booking__user__email__icontains=query)
        )
    elif entity == "invoice":
        records = records.filter(Q(reference__icontains=query) | Q(package__tracking_number__icontains=query))
    return list(records.order_by("-pk")[:limit])


# ------------------------------------------------------------------ candidates


class Candidates:
    """Collects candidates per kind, merging reasons when one record is found twice."""

    def __init__(self, rejected):
        self.found = {entity: {} for entity in ENTITIES}
        self.rejected = {entity: {int(pk) for pk in rejected.get(entity, [])} for entity in ENTITIES}

    def add(self, entity, obj, reason, strong):
        if obj is None or obj.pk in self.rejected[entity]:
            return
        entry = self.found[entity].setdefault(obj.pk, {"obj": obj, "reasons": [], "strong": False})
        if reason not in entry["reasons"]:
            entry["reasons"].append(reason)
        entry["strong"] = entry["strong"] or strong

    def as_json(self):
        return {
            entity: [
                {
                    "id": pk,
                    "label": label_for(entity, item["obj"]),
                    "reasons": item["reasons"],
                    "strong": item["strong"],
                }
                for pk, item in sorted(items.items(), key=lambda pair: (not pair[1]["strong"], pair[0]))
            ]
            for entity, items in self.found.items()
        }


def _same_tracking(stored, number):
    try:
        return normalize_tracking_number(stored) == number
    except InvalidTrackingNumber:
        return False


def find_candidates(job, extracted, issues):
    """See the module docstring. Returns the proposals dict (JSON-ready)."""
    found = Candidates(job.rejected or {})
    bad = untrusted_values(issues)

    def trusted(field, value=None):
        return (field, value) not in bad and (field, None) not in bad

    # 1. What the document's origin tells us. Trusted: we stored that link ourselves.
    document = job.package_document
    if document is not None:
        found.add("customer", document.customer, "This customer uploaded the document", True)
        if document.package_id:
            found.add("package", document.package, "The customer filed the document on this shipment", True)
    attachment = job.booking_attachment
    if attachment is not None:
        if attachment.order_id:
            found.add("order", attachment.order, "The document was added to this shop order", True)
        if attachment.booking.user_id:
            found.add("customer", attachment.booking.user, "The booking belongs to this customer", True)

    # 2. Identifiers read from the document.
    code = extracted.get("customer_code", "")
    if code:
        digits = re.sub(r"\D", "", code)
        customer = queryset_for("customer").filter(customer_number=int(digits)).first() if digits else None
        found.add("customer", customer, f"Customer number {code} is on the document", trusted("customer_code"))

    email = extracted.get("customer_email", "")
    if email:
        for customer in queryset_for("customer").filter(email__iexact=email)[:2]:
            found.add("customer", customer, f"E-mail address {email} is on the document", trusted("customer_email"))

    for number in extracted.get("shipment_numbers", []):
        package = queryset_for("package").filter(tracking_number__iexact=number).first()
        found.add(
            "package", package, f"Shipment number {number} is on the document", trusted("shipment_numbers", number)
        )

    for number in extracted.get("carrier_tracking_numbers", []):
        ok = trusted("carrier_tracking_numbers", number)
        reason = f"Courier tracking number {number}"
        for prealert in PreAlert.objects.filter(tracking_number__iexact=number).select_related("package", "user"):
            found.add("customer", prealert.user, f"{reason} matches pre-alert {prealert.reference}", ok)
            found.add("package", prealert.package, f"{reason} matches pre-alert {prealert.reference}", ok)
        shipments = CarrierShipment.objects.filter(tracking_number__iexact=number).select_related(
            "owner", "onward_package", "order", "order__booking"
        )
        for shipment in shipments:
            found.add("customer", shipment.owner, f"{reason} is a parcel we are following", ok)
            found.add("package", shipment.onward_package, f"{reason} is a parcel we are following", ok)
            found.add("order", shipment.order, f"{reason} is a parcel we are following", ok)
        for order in queryset_for("order").filter(tracking_code__icontains=number[-8:])[:20]:
            if _same_tracking(order.tracking_code, number):
                found.add("order", order, f"{reason} is the shop order's track-and-trace", ok)

    number = extracted.get("invoice_number", "")
    match = OUR_INVOICE_RE.match(number or "")
    if match:
        invoice = Invoice.objects.filter(reference__iexact=number).select_related("package").first()
        if invoice is None and match.group(2):
            invoice = queryset_for("invoice").filter(pk=int(match.group(2)), reference__isnull=True).first()
        found.add("invoice", invoice, f"Our invoice number {number} is on the document", trusted("invoice_number"))

    # 3. Follow the existing relations from what was found: a shipment tells
    # us its owner, an order its booking's customer, an invoice its shipment.
    for item in list(found.found["invoice"].values()):
        invoice = item["obj"]
        found.add(
            "package",
            invoice.package,
            f"Invoice {label_for('invoice', invoice).split(' · ')[0]} is for this shipment",
            item["strong"],
        )
    for item in list(found.found["package"].values()):
        package = item["obj"]
        if package.user_id:
            found.add("customer", package.user, f"Owner of shipment {package.tracking_number}", item["strong"])
    for item in list(found.found["order"].values()):
        order = item["obj"]
        if order.booking.user_id:
            found.add("customer", order.booking.user, f"The booking for {order.shop_name} is theirs", item["strong"])

    return found.as_json()
