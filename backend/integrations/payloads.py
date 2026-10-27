"""What a shipment or an invoice looks like to outside software.

One shape, used both by the inbound API (GET .../shipments/) and by the
webhooks we send, so the other side only has to understand it once.

Rules for these dictionaries:
- Plain JSON types only. Money is a string with two decimals ("149.95"), never
  a float, so no cents get lost to rounding on either side.
- Only what an accounting or shipping program needs. No internal notes, no
  warehouse locations, no staff names. Add a field only when a real
  integration needs it.
"""

from decimal import Decimal

from invoicing.pdf import invoice_number


def _money(value):
    """Decimal("149.9") -> "149.90"; "149.9" -> "149.90"; None -> None.

    Through Decimal(str(...)) because a row that has just been created may
    still hold the string it was given rather than a Decimal.
    """
    if value is None:
        return None
    return str(Decimal(str(value)).quantize(Decimal("0.01")))


def _date(value):
    return value.isoformat() if value else None


def customer_data(user):
    """The customer as an outside program sees them. None for a shipment
    with no account (it can happen for old rows)."""
    if user is None:
        return None
    return {"id": user.pk, "name": str(user), "email": user.email or None}


def shipment_data(package):
    """Example:
    {"id": 7, "tracking_number": "PLSM-0007", "status": "in_transit", ...}
    """
    return {
        "id": package.pk,
        "tracking_number": package.tracking_number,
        "package_number": package.package_number,
        "status": package.status,
        "status_display": package.get_status_display(),
        "freight": package.freight or None,
        "description": package.description,
        "value_eur": _money(package.value_eur),
        "customer": customer_data(package.user),
        "created_at": _date(package.created_at),
        "updated_at": _date(package.updated_at),
    }


def invoice_data(invoice):
    """Example:
    {"id": 3, "number": "INV-2026-00003-PLSM-0007", "status": "sent",
     "amount_due": "1370.48", "currency": "EUR", "totals": {...}, ...}

    `totals` is only filled for invoices written in the invoice editor
    ("composed"); older invoices only have amount_due.
    """
    totals = None
    if invoice.composed:
        totals = {key: _money(value) for key, value in invoice.totals().items()}

    package = invoice.package
    return {
        "id": invoice.pk,
        "number": invoice_number(invoice),
        "status": invoice.status,
        "dated_on": _date(invoice.dated_on),
        "currency": "EUR",
        "amount_due": _money(invoice.amount_due),
        "totals": totals,
        "shipment": {"id": package.pk, "tracking_number": package.tracking_number},
        "customer": customer_data(package.user),
        "pdf_available": bool(invoice.pdf),
        "sent_at": _date(invoice.sent_at),
        "updated_at": _date(invoice.updated_at),
    }
