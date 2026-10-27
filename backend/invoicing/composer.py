"""Turning the invoice editor's form into an invoice.

The editor (frontend/src/pages/Dashboard/invoice/) sends what the employee
typed. Before anything is saved or drawn, this module:

1. works out the figures the server is responsible for - volume from the
   measured boxes, the insurance premium, the VAT rate - so a browser cannot
   simply send a total of its choosing;
2. produces the final list of fields and lines.

The preview, the "Bereken factuur" button and saving all go through
`prepare()`, so what you preview is exactly what gets saved.

It also answers the opposite question, `shipment_defaults()`: what should
the form say before anybody has typed, for a given shipment?
"""

from decimal import Decimal

from .calculation import calculate_totals, insurance_fee, measure_packages
from .models import ChargeType, FreightScope, InvoiceLine, InvoiceSettings, Port
from .pdf import billing_lines, invoice_number, money

ADJUSTMENT_LABEL = "Contractuele verrekening conform overeenkomst"


# ---- what the form starts with ---------------------------------------------


def _port(freight, *, loading, destination_code=""):
    """The port the editor should pre-select, by name ("" when none fits).

    In order of preference: a port for this freight whose destination code
    matches the booking (CW -> Willemstad), then the port marked as default
    for this freight.
    """
    ports = Port.objects.filter(active=True, freight__in=[freight, FreightScope.BOTH])
    ports = ports.filter(for_loading=True) if loading else ports.filter(for_discharge=True)

    if destination_code:
        match = ports.filter(destination_code=destination_code).first()
        if match:
            return match.name

    default = ports.filter(is_default=True).first() or ports.first()
    return default.name if default else ""


def warehouse_measurements(package):
    """What the warehouse measured for this shipment, for the invoice.

    Returns {"measurements": [...], "pieces": int, "weight_kg": Decimal|None,
    "source": "intake"|"scanner"} or None when it has not been measured.

    The intake sheet first - one line per kind of box, with how many - taken
    from the newest released sheet of the shipment or its booking, else the
    newest draft. Only lines with all three sizes become measured boxes; the
    weight is filled in only when every line has one, because a total that
    silently leaves boxes out is worse than an empty box to type into.

    Otherwise the scanner's newest weighing of the shipment, as one box.
    """
    booking = getattr(package, "booking", None)
    sheets = {sheet.pk: sheet for sheet in package.intake_sheets.all()}
    if booking is not None:
        for sheet in booking.intake_sheets.all():
            sheets.setdefault(sheet.pk, sheet)
    ordered = sorted(
        sheets.values(),
        key=lambda sheet: (sheet.status == sheet.Status.RELEASED, sheet.created_at),
        reverse=True,
    )
    for sheet in ordered:
        lines = [
            line for line in sheet.measurements.all()
            if None not in (line.length_cm, line.width_cm, line.height_cm)
        ]
        if not lines:
            continue
        weighed = all(line.weight_kg is not None for line in lines)
        return {
            "source": "intake",
            "measurements": [
                {
                    "length_cm": line.length_cm,
                    "width_cm": line.width_cm,
                    "height_cm": line.height_cm,
                    "count": line.quantity,
                }
                for line in lines
            ],
            "pieces": sum(line.quantity for line in lines),
            "weight_kg": sum(line.quantity * line.weight_kg for line in lines) if weighed else None,
        }

    scan = package.warehouse_measurements.order_by("-measured_at").first()
    if scan is not None:
        return {
            "source": "scanner",
            "measurements": [
                {
                    "length_cm": scan.length_cm,
                    "width_cm": scan.width_cm,
                    "height_cm": scan.height_cm,
                    "count": 1,
                }
            ],
            "pieces": 1,
            "weight_kg": scan.weight_kg,
        }
    return None


def shipment_defaults(package):
    """Everything the editor fills in for a shipment before anybody types.

    Read from the shipment and, when it came in through the booking form, from
    the booking - that is where the office's shipping number, the counted
    pieces and the measured volume live. Every value is a suggestion the
    employee can change.

    Numbers are returned as strings ("199.00") or None, never floats, so they
    reach the browser exactly.
    """
    booking = getattr(package, "booking", None)

    freight = package.freight or (booking.freight if booking else "") or FreightScope.SEA
    weight = package.weight_kg if package.weight_kg is not None else (
        booking.weight_kg if booking else None
    )
    existing = getattr(package, "invoice", None)
    # The warehouse's own measurements beat what the booking declared: the
    # invoice is made after the goods have been measured.
    measured = warehouse_measurements(package)
    if measured and measured["weight_kg"] is not None:
        weight = measured["weight_kg"]

    def text(value):
        return None if value is None else str(value)

    return {
        "customer": {"id": package.user_id, "name": str(package.user)},
        "package": package.pk,
        "bill_to": "\n".join(billing_lines(package)),
        "phone": package.user.phone_number or "",
        # The office numbers relations as PLSM + four digits. The customer's
        # account number is the nearest thing the website has; the employee
        # can overwrite it.
        "relation_number": f"PLSM{package.user_id:04d}",
        "order_number": package.tracking_number,
        "shipment_number": (booking.shipping_number if booking else "") or package.tracking_number,
        "freight": freight,
        "port_of_loading": _port(freight, loading=True),
        "port_of_discharge": _port(
            freight, loading=False, destination_code=booking.destination if booking else ""
        ),
        "goods_description": (
            package.description or (booking.contents if booking else "")
        ).strip().replace("\n", " ")[:300],
        "pieces": (
            measured["pieces"] if measured
            else booking.quantity if booking and booking.quantity else None
        ),
        # The boxes the warehouse measured, for the editor's measurements
        # table (volume and volume weight are worked out from them), and
        # where they came from, for the editor to say so.
        "measurements": [
            {key: (text(value) if key != "count" else value) for key, value in row.items()}
            for row in (measured["measurements"] if measured else [])
        ],
        "measured_by_warehouse": measured["source"] if measured else None,
        "weight_kg": text(weight),
        "volume_m3": text(booking.volume_m3 if booking else None),
        "insured_value": text(
            booking.insured_value_eur if booking and booking.insured else None
        ),
        # When the shipment already has an invoice, the editor offers to open
        # it instead of starting a second one.
        "existing_invoice": (
            {"id": existing.pk, "number": invoice_number(existing), "status": existing.status}
            if existing is not None
            else None
        ),
    }


# ---- from form to invoice --------------------------------------------------


def insurance_description(insured_value, own_risk):
    """"Verzekering (verzekerde waarde € 8.390,00 - eigen risico € 250,00)"."""
    parts = [f"verzekerde waarde {money(insured_value)}"]
    if own_risk is not None:
        parts.append(f"eigen risico {money(own_risk)}")
    return f"Verzekering ({' - '.join(parts)})"


def prepare(data, *, settings_row=None, texts=None):
    """Work out the final fields and lines from the editor's validated data.

    data          InvoiceEditorSerializer.validated_data.
    settings_row  InvoiceSettings; loaded when not given.
    texts         the wording to print. A new invoice takes a copy of the
                  current settings; an invoice being edited keeps its own.

    Returns (fields, lines, totals):
        fields  dict of Invoice model fields, ready for Invoice(**fields)
        lines   list of (kind, description, amount) tuples, in print order
        totals  calculation.calculate_totals() of those lines
    """
    settings_row = settings_row or InvoiceSettings.load()

    # -- volume: measured boxes beat a typed number --
    measurements = data.get("measurements") or []
    volume_m3 = data.get("volume_m3")
    volume_weight_kg = None
    pieces = data.get("pieces")
    if measurements:
        measured = measure_packages(measurements)
        volume_m3 = measured["volume_m3"]
        volume_weight_kg = measured["volume_weight_kg"]
        if pieces is None:
            pieces = measured["pieces"]

    # -- insurance: the configured rule beats a typed premium --
    insured_value = data.get("insured_value")
    own_risk = data.get("own_risk")
    premium = insurance_fee(
        insured_value, settings_row.insurance_rate_percent, settings_row.insurance_minimum
    )
    if premium is None:
        # No rate configured: the employee typed the premium by hand.
        premium = data.get("insurance_fee")

    # -- the lines, in the order the employee put them --
    lines = []
    for line in data["lines"]:
        kind = line["kind"]
        if kind == InvoiceLine.Kind.INSURANCE:
            # The insurance row's wording and amount are always worked out
            # here, from the insurance fields. Whatever the browser sent for
            # them is ignored.
            lines.append(
                (kind, insurance_description(insured_value, own_risk), premium)
            )
        elif kind == InvoiceLine.Kind.ADJUSTMENT:
            lines.append((kind, line["description"].strip() or ADJUSTMENT_LABEL, line["amount"]))
        else:
            lines.append((kind, line["description"].strip(), line["amount"]))

    export_verified = data.get("export_verified", False)
    vat_rate = settings_row.vat_rate_for(export_verified)

    fields = {
        "composed": True,
        "bill_to": data.get("bill_to", ""),
        "phone": data.get("phone", ""),
        "relation_number": data.get("relation_number", ""),
        "order_number": data.get("order_number", ""),
        "shipment_number": data.get("shipment_number", ""),
        "freight": data.get("freight", ""),
        "port_of_loading": data.get("port_of_loading", ""),
        "port_of_discharge": data.get("port_of_discharge", ""),
        "goods_description": data.get("goods_description", ""),
        "pieces": pieces,
        "weight_kg": data.get("weight_kg"),
        "volume_m3": volume_m3,
        "volume_weight_kg": volume_weight_kg,
        "measurements": [
            {key: str(value) for key, value in row.items()} for row in measurements
        ],
        "insured_value": insured_value,
        "own_risk": own_risk,
        "export_verified": export_verified,
        "vat_rate": vat_rate,
        "texts": texts if texts is not None else settings_row.text_snapshot(),
    }

    totals = calculate_totals(
        charges=[amount for kind, _, amount in lines if kind != InvoiceLine.Kind.ADJUSTMENT],
        adjustments=[amount for kind, _, amount in lines if kind == InvoiceLine.Kind.ADJUSTMENT],
        vat_rate_percent=vat_rate,
    )
    return fields, lines, totals


def totals_as_json(totals):
    """The totals as strings, the way the API sends every decimal."""
    return {key: str(value) for key, value in totals.items()}


def snapshot(invoice):
    """The whole invoice as plain JSON, for InvoiceHistory."""
    def plain(value):
        if isinstance(value, Decimal):
            return str(value)
        if hasattr(value, "isoformat"):
            return value.isoformat()
        return value

    fields = [
        "reference", "status", "invoice_date", "bill_to", "phone", "relation_number",
        "order_number", "shipment_number", "freight", "port_of_loading",
        "port_of_discharge", "goods_description", "pieces", "weight_kg", "volume_m3",
        "volume_weight_kg", "measurements", "insured_value", "own_risk",
        "export_verified", "vat_rate",
    ]
    data = {name: plain(getattr(invoice, name)) for name in fields}
    data["package"] = invoice.package_id
    data["lines"] = [
        {"kind": line.kind, "description": line.description, "amount": str(line.amount)}
        for line in invoice.lines.all()
    ]
    data["totals"] = totals_as_json(invoice.totals())
    return data


def charge_types_for(freight):
    """The active charge types the editor offers for a shipping method."""
    return ChargeType.objects.filter(active=True, freight__in=[freight, FreightScope.BOTH])


