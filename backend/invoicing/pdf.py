"""Drawing an invoice as a PDF.

HOW THIS FILE IS ORGANISED (read top to bottom):

1. Formatting helpers   - money() and number() write figures the Dutch way.
2. InvoiceDocument      - a plain box of values: everything that is printed.
3. document_for()       - fills that box from a saved Invoice.
   document_from_values() - fills it from the editor's form (the preview).
4. The _draw_* functions - put the box on paper, top to bottom.
5. render_document()    - the one function that turns a box into PDF bytes.

Why the box in the middle? Because there are two ways to get an invoice -
a saved row, or an unsaved form being previewed - and one way to draw it.
Both are turned into an InvoiceDocument first, so the preview and the real
PDF come from exactly the same drawing code. If they could differ, the
preview would be worthless.

The layout copies the office's paper FACTUUR (factuur idea.pdf): logo and
company details top right, the shipment in blue-headed columns between yellow
double lines, the charges with amounts on the right, the totals, then payment
instructions, conditions and the small print at the bottom.

The arithmetic is not here. Totals come from invoicing/calculation.py; this
file only prints them. The wording (terms, VAT note, payment instructions)
is not here either: it comes from InvoiceSettings, copied onto each invoice.

ReportLab's low-level canvas rather than its Platypus layout engine: the page
is fixed furniture plus a list of lines, so we draw at coordinates. In
ReportLab, y=0 is the BOTTOM of the page, so "moving down" means making y
smaller - that is why you see `pen.y -= ...` everywhere.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas

from .calculation import calculate_totals, is_credit

# ---- page geometry ---------------------------------------------------------

# A4 in points (1 point = 1/72 inch), and one margin used on all four sides.
PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 18 * mm
# Top and bottom are tighter than the sides, like the paper invoice: the
# height of the page is what decides whether an invoice fits on one sheet.
TOP_MARGIN = 12 * mm
BOTTOM_MARGIN = 10 * mm
RIGHT = PAGE_WIDTH - MARGIN
CONTENT_WIDTH = RIGHT - MARGIN

BODY_SIZE = 9.5
SMALL_SIZE = 7
LINE = 4.2 * mm
# The charge lines sit a little closer together than ordinary text, as on
# the paper invoice - it is what lets thirteen charges fit on one page.
CHARGE_LINE = 3.8 * mm

# The colours of the paper invoice: blue headings, yellow separator lines.
BLUE = HexColor("#2B8FDA")
YELLOW = HexColor("#F2C230")
BLACK = HexColor("#000000")

# JPEG, not the site's PNG: ReportLab reads JPEG by itself, while PNG would
# need the Pillow library installed on the worker just for this one image.
LOGO = Path(__file__).resolve().parent / "assets" / "logo.jpg"

# The small print is pinned to the bottom of the last page, up to here.
FOOTER_TOP = BOTTOM_MARGIN + 13 * mm
# Below this the charges stop and continue on a new page.
LINES_FLOOR = FOOTER_TOP
# White space kept between the last line of the conditions and the small print.
FOOTER_GAP = 3 * mm


def invoice_number(invoice):
    """The number printed on an invoice and used in its file name.

    A composed invoice has its sequential number (PLSM20260011), taken when it
    was saved. Older invoices keep the reference they were issued under,
    INV-<year>-<id>: those are on documents customers already hold, so they
    are never renumbered.
    """
    if invoice.reference:
        return invoice.reference
    return f"INV-{timezone.localtime(invoice.created_at):%Y}-{invoice.pk:05d}"


# ---- 1. formatting ---------------------------------------------------------


def money(amount):
    """€ 1.370,48 and -€ 1.370,48, the Dutch way. A dash for no figure."""
    if amount is None:
        return "—"
    amount = Decimal(amount).quantize(Decimal("0.01"))
    whole, cents = f"{abs(amount):,.2f}".split(".")
    text = f"€ {whole.replace(',', '.')},{cents}"
    return f"-{text}" if amount < 0 else text


def number(value, unit=""):
    """1,55 rather than 1.550: trailing zeros dropped, a comma for the point."""
    if value is None or value == "":
        return ""
    text = f"{Decimal(value).normalize():f}".replace(".", ",")
    return f"{text} {unit}".strip()


def percent(rate):
    """21 -> "21%", 0 -> "0%", 9.5 -> "9,5%"."""
    return f"{number(rate) or '0'}%"


def fill_in(text, *, shipment_number, company_name):
    """Replace the placeholders admins may use in the configurable texts.

    str.replace rather than str.format on purpose: an admin typing a stray
    "{" in a sentence must not crash the PDF.
    """
    return (
        (text or "")
        .replace("{zendingsnummer}", shipment_number or "")
        .replace("{bedrijf}", company_name or "")
    )


# ---- 2. what is printed ----------------------------------------------------


@dataclass
class Line:
    description: str
    amount: Decimal | None


@dataclass
class InvoiceDocument:
    """Everything printed on an invoice, as plain values.

    `charges` are the service lines (insurance included); `adjustments` are
    the contractual adjustments printed under the subtotal.
    """

    number: str
    dated: date
    bill_to: list[str] = field(default_factory=list)
    phone: str = ""
    relation_number: str = ""
    order_number: str = ""
    shipment_number: str = ""
    port_of_loading: str = ""
    port_of_discharge: str = ""
    goods_description: str = ""
    pieces: str = ""
    weight: str = ""
    volume: str = ""
    volume_weight: str = ""
    charges: list[Line] = field(default_factory=list)
    adjustments: list[Line] = field(default_factory=list)
    vat_rate: Decimal = Decimal("0")
    export_verified: bool = False
    texts: dict = field(default_factory=dict)

    def totals(self):
        """The financial summary, or None when a charge has no amount yet.

        (Only an old automatic invoice for a shipment with no value can have a
        missing amount; the editor refuses to save one.)
        """
        lines = self.charges + self.adjustments
        if any(line.amount is None for line in lines):
            return None
        return calculate_totals(
            charges=[line.amount for line in self.charges],
            adjustments=[line.amount for line in self.adjustments],
            vat_rate_percent=self.vat_rate,
        )


def billing_lines(package):
    """Who an invoice is addressed to, as the lines of an address block.

    Prefers delivery_address_text - the address frozen when the package
    shipped - over the live Address row, so the invoice keeps showing where
    the shipment actually went even if the customer later edits or deletes
    that address.
    """
    lines = [str(package.user)]

    if package.delivery_address_text.strip():
        lines += [
            line.strip()
            for line in package.delivery_address_text.splitlines()
            if line.strip()
        ]
    elif package.delivery_address_id and package.delivery_address:
        address = package.delivery_address
        lines += [
            f"{address.street} {address.house_number}".strip(),
            " ".join(part for part in (address.postal_code, address.city) if part),
            address.get_country_display(),
        ]

    return [line for line in lines if line]


# ---- 3. filling the box ----------------------------------------------------


def document_from_values(number_text, dated, values, lines):
    """An InvoiceDocument from plain values - a saved invoice or a form.

    values  a dict with the invoice's fields (bill_to, weight_kg, texts, ...)
            exactly as they are named on the Invoice model.
    lines   a list of (kind, description, amount) tuples.
    """
    from .models import InvoiceLine

    return InvoiceDocument(
        number=number_text,
        dated=dated,
        bill_to=[line for line in (values.get("bill_to") or "").splitlines() if line.strip()],
        phone=values.get("phone") or "",
        relation_number=values.get("relation_number") or "",
        order_number=values.get("order_number") or "",
        shipment_number=values.get("shipment_number") or "",
        port_of_loading=values.get("port_of_loading") or "",
        port_of_discharge=values.get("port_of_discharge") or "",
        goods_description=values.get("goods_description") or "",
        pieces=str(values["pieces"]) if values.get("pieces") is not None else "",
        weight=number(values.get("weight_kg"), "kg"),
        volume=number(values.get("volume_m3"), "m³"),
        volume_weight=number(values.get("volume_weight_kg"), "kg"),
        charges=[
            Line(description, amount)
            for kind, description, amount in lines
            if kind != InvoiceLine.Kind.ADJUSTMENT
        ],
        adjustments=[
            Line(description, amount)
            for kind, description, amount in lines
            if kind == InvoiceLine.Kind.ADJUSTMENT
        ],
        vat_rate=Decimal(values.get("vat_rate") or 0),
        export_verified=bool(values.get("export_verified")),
        texts=values.get("texts") or {},
    )


#: The Invoice fields document_from_values reads.
DOCUMENT_FIELDS = (
    "bill_to", "phone", "relation_number", "order_number", "shipment_number",
    "port_of_loading", "port_of_discharge", "goods_description", "pieces",
    "weight_kg", "volume_m3", "volume_weight_kg", "vat_rate", "export_verified",
    "texts",
)


def document_for(invoice):
    """The InvoiceDocument for a saved invoice.

    A composed invoice prints what was written for it. Any other kind (raised
    automatically when a shipment was paid, from before the editor existed)
    prints the shipment's own details and one line for its value - what those
    invoices have always said - with today's settings for the wording.
    """
    from .models import InvoiceLine, InvoiceSettings

    if invoice.composed:
        return document_from_values(
            invoice_number(invoice),
            invoice.dated_on,
            {name: getattr(invoice, name) for name in DOCUMENT_FIELDS},
            [(line.kind, line.description, line.amount) for line in invoice.lines.all()],
        )

    package = invoice.package
    settings_row = InvoiceSettings.load()
    return document_from_values(
        invoice_number(invoice),
        invoice.dated_on,
        {
            "bill_to": "\n".join(billing_lines(package)),
            "order_number": package.tracking_number,
            "shipment_number": package.tracking_number,
            "port_of_discharge": package.destination_label,
            "goods_description": package.description.strip(),
            "weight_kg": package.weight_kg,
            # These invoices were always 0% export, and have no VAT line to
            # recalculate - keep printing them the way they were issued.
            "vat_rate": settings_row.export_vat_rate,
            "export_verified": True,
            "texts": settings_row.text_snapshot(),
        },
        [
            (
                InvoiceLine.Kind.CHARGE,
                package.description.strip() or "Verzending en afhandeling",
                package.value_eur,
            )
        ],
    )


# ---- 4. drawing ------------------------------------------------------------


class _Pen:
    """A canvas plus a cursor (`y`) that moves down the page as we draw."""

    def __init__(self, pdf, number_text):
        self.pdf = pdf
        self.number = number_text
        self.y = PAGE_HEIGHT - TOP_MARGIN

    def font(self, size=BODY_SIZE, bold=False, italic=False, colour=BLACK):
        name = "Helvetica"
        if bold and italic:
            name = "Helvetica-BoldOblique"
        elif bold:
            name = "Helvetica-Bold"
        elif italic:
            name = "Helvetica-Oblique"
        self.pdf.setFont(name, size)
        self.pdf.setFillColor(colour)

    def new_page(self):
        """A fresh page, headed so a loose sheet still says which invoice it is."""
        self.pdf.showPage()
        self.y = PAGE_HEIGHT - TOP_MARGIN
        self.font(BODY_SIZE, italic=True)
        self.pdf.drawString(MARGIN, self.y, f"Factuur {self.number} (vervolg)")
        self.y -= LINE * 2.5

    def rule(self, y, double=False, left=MARGIN, right=RIGHT, colour=YELLOW):
        """A horizontal line; `double` draws the paper invoice's double rule."""
        self.pdf.setStrokeColor(colour)
        self.pdf.setLineWidth(0.9)
        self.pdf.line(left, y, right, y)
        if double:
            self.pdf.line(left, y - 1.8, right, y - 1.8)


def _fit(text, font, size, width):
    """`text` wrapped to `width`, as a list of lines (at least one)."""
    return simpleSplit(text or "", font, size, width) or [""]


def _draw_header(pen, doc, company):
    """FACTUUR, the logo, the customer and our own details."""
    pdf = pen.pdf
    top = PAGE_HEIGHT - TOP_MARGIN

    pen.font(22, bold=True, colour=BLUE)
    pdf.drawString(MARGIN + 12 * mm, top - 16 * mm, "FACTUUR")

    # The logo, top right. The numbers 173/189 are the image's own height and
    # width in pixels, so it is never stretched.
    logo_width = 34 * mm
    logo_height = logo_width * 173 / 189
    logo_x = RIGHT - logo_width - 12 * mm
    logo_y = top - logo_height
    if LOGO.exists():
        pdf.drawImage(
            ImageReader(str(LOGO)), logo_x, logo_y, logo_width, logo_height,
            preserveAspectRatio=True, mask=None,
        )

    # Our address, right-aligned under the logo.
    y = logo_y - 5 * mm
    pen.font(10.5)
    for text in (company.company_name, company.company_street, company.company_postcode_city):
        pdf.drawRightString(RIGHT, y, text)
        y -= 4.7 * mm
    address_top = logo_y - 5 * mm

    # The customer, on the left, level with our name.
    cursor = address_top
    customer = list(doc.bill_to[:6])
    if doc.phone:
        customer.append(f"Tel: {doc.phone}")
    for index, text in enumerate(customer):
        pen.font(11.5 if index == 0 else BODY_SIZE + 0.5)
        pdf.drawString(MARGIN, cursor, text[:60])
        cursor -= 5.2 * mm if index == 0 else 4.4 * mm

    # KVK, BTW, IBAN and how to reach us: blue labels, black values.
    y -= 2 * mm
    label_x = RIGHT - 62 * mm

    def fact(label, value):
        nonlocal y
        if not value:
            return
        pen.font(8.5, bold=True, colour=BLUE)
        pdf.drawRightString(label_x, y, label)
        pen.font(8.5)
        pdf.drawRightString(RIGHT, y, value)
        y -= 3.6 * mm

    fact("KVK", company.company_kvk)
    fact("BTW", company.company_vat)
    fact("IBAN", company.company_iban)
    y -= 2 * mm
    fact("E-mail", company.company_email)
    fact("Website", company.company_website)
    fact("Telefoonnummer", company.company_phone)

    pen.y = min(y, cursor) - 6 * mm


def _draw_shipment(pen, doc):
    """The blue-headed columns and the measurements between yellow lines."""
    pdf = pen.pdf
    quarter = CONTENT_WIDTH / 4
    # The x position of the middle of each of the four columns.
    centres = [MARGIN + quarter * (i + 0.5) for i in range(4)]

    def row(labels, values, colour=BLUE, size=10.5):
        pen.font(size, bold=True, colour=colour)
        for centre, label in zip(centres, labels):
            if label:
                pdf.drawCentredString(centre, pen.y, label)
        pen.y -= 4.4 * mm
        pen.font(BODY_SIZE - 0.5)
        for centre, value in zip(centres, values):
            if value:
                pdf.drawCentredString(centre, pen.y, value[:34])

    row(
        ("Factuurnummer", "Factuurdatum", "Zendingsnummer", "Relatienummer"),
        (doc.number, f"{doc.dated:%d-%m-%Y}", doc.shipment_number, doc.relation_number),
    )
    pen.y -= 6.5 * mm

    # Laadhaven and Loshaven centred like the row above; the goods get the
    # whole right half, because a description is longer than a port name.
    pen.font(10.5, bold=True, colour=BLUE)
    pdf.drawCentredString(centres[0], pen.y, "Laadhaven")
    pdf.drawCentredString(centres[1], pen.y, "Loshaven")
    goods_x = MARGIN + quarter * 2 + 4 * mm
    pdf.drawString(goods_x, pen.y, "Goederen omschrijving")
    pen.y -= 4.4 * mm
    pen.font(BODY_SIZE - 0.5)
    pdf.drawCentredString(centres[0], pen.y, doc.port_of_loading[:34])
    pdf.drawCentredString(centres[1], pen.y, doc.port_of_discharge[:34])
    goods = _fit(doc.goods_description, "Helvetica", BODY_SIZE - 0.5, RIGHT - goods_x)
    pdf.drawString(goods_x, pen.y, goods[0])
    for extra in goods[1:2]:
        pen.y -= 3.8 * mm
        pdf.drawString(goods_x, pen.y, extra)

    pen.y -= 2.2 * mm
    pen.rule(pen.y, double=True)
    pen.y -= 4.2 * mm

    row(
        ("Stuks", "Gewicht", "Volume", "Ordernummer"),
        (doc.pieces, doc.weight, doc.volume, doc.order_number),
        colour=BLACK,
        size=BODY_SIZE,
    )
    if doc.volume_weight:
        # Under the actual weight, and labelled, so nobody mistakes one for
        # the other: the scale says one thing, the tape measure another.
        pen.y -= 3.6 * mm
        pen.font(SMALL_SIZE + 0.5, italic=True)
        pdf.drawCentredString(centres[1], pen.y, f"Volumegewicht: {doc.volume_weight}")
    pen.y -= 2.2 * mm
    pen.rule(pen.y, double=True)
    pen.y -= 7 * mm


def _draw_lines(pen, doc):
    """The charges, one to a line, continuing on a new page when full."""
    pdf = pen.pdf
    width = CONTENT_WIDTH - 40 * mm

    for line in doc.charges:
        wrapped = _fit(line.description, "Helvetica", BODY_SIZE, width)
        if pen.y - CHARGE_LINE * len(wrapped) < LINES_FLOOR:
            pen.new_page()

        pen.font(BODY_SIZE)
        for index, text in enumerate(wrapped):
            pdf.drawString(MARGIN, pen.y, text)
            if index == 0:
                pdf.drawRightString(RIGHT, pen.y, money(line.amount))
            pen.y -= CHARGE_LINE


def _draw_totals(pen, doc):
    """Subtotal, adjustments, VAT and the amount to pay."""
    pdf = pen.pdf
    totals = doc.totals() or {}

    pen.y -= 4 * mm
    pen.rule(pen.y + 4.6 * mm, left=RIGHT - 52 * mm, colour=BLUE)
    pen.font(BODY_SIZE + 0.5, bold=True)
    pdf.drawString(MARGIN, pen.y - 1 * mm, "Subtotaal dienstverlening")
    pdf.drawRightString(RIGHT, pen.y - 1 * mm, money(totals.get("subtotal")))
    pen.y -= 7 * mm

    for adjustment in doc.adjustments:
        pen.font(BODY_SIZE)
        pdf.drawString(MARGIN, pen.y, adjustment.description[:90])
        pen.font(BODY_SIZE, bold=True)
        pdf.drawRightString(RIGHT, pen.y, money(adjustment.amount))
        pen.y -= 6 * mm

    pen.rule(pen.y + 2 * mm, double=True)
    pen.y -= 4 * mm

    labels_x = RIGHT - 52 * mm
    vat_label = f"Totaal BTW ({percent(doc.vat_rate)}{' Export' if doc.export_verified else ''}):"
    pen.font(BODY_SIZE)
    pdf.drawRightString(labels_x, pen.y, "Totaal excl. BTW:")
    pdf.drawRightString(RIGHT, pen.y, money(totals.get("total_excl")))
    pen.y -= LINE
    pdf.drawRightString(labels_x, pen.y, vat_label)
    pdf.drawRightString(RIGHT, pen.y, money(totals.get("vat")))
    pen.y -= LINE * 1.4

    # A negative total is money we owe the customer. Say so in words, so a
    # minus sign that is easy to miss is not the only clue.
    credit = is_credit(totals.get("total"))
    pen.font(BODY_SIZE + 0.5, bold=True)
    pdf.drawRightString(
        labels_x, pen.y, "Creditbedrag (te ontvangen):" if credit else "Totaal te betalen:"
    )
    pdf.drawRightString(RIGHT, pen.y, money(totals.get("total")))
    pen.y -= LINE * 1.5

    if doc.export_verified and doc.texts.get("export_vat_note"):
        pen.font(6.5, bold=True)
        for text in _fit(doc.texts["export_vat_note"], "Helvetica-Bold", 6.5, CONTENT_WIDTH):
            pdf.drawRightString(RIGHT, pen.y, text)
            pen.y -= 3 * mm
    pen.y -= LINE * 1.1


def _draw_conditions(pen, doc, company):
    """Payment instructions, terms, exclusions and the small print."""
    pdf = pen.pdf
    texts = doc.texts

    def fill(text):
        return fill_in(
            text, shipment_number=doc.shipment_number, company_name=company.company_name
        )

    def items(text):
        return [fill(item).strip() for item in (text or "").splitlines() if item.strip()]

    pen.font(BODY_SIZE + 0.5, bold=True)
    for text in _fit(fill(texts.get("payment_instructions")), "Helvetica-Bold", BODY_SIZE + 0.5, CONTENT_WIDTH):
        pdf.drawString(MARGIN, pen.y, text)
        pen.y -= LINE
    pen.font(BODY_SIZE)
    pdf.drawString(MARGIN, pen.y, fill(texts.get("terms_intro"))[:120])
    for text in items(texts.get("terms_items")):
        pen.y -= LINE * 0.85
        pdf.drawString(MARGIN + 10 * mm, pen.y, f"- {text}"[:120])

    pen.y -= LINE * 1.5
    pen.font(BODY_SIZE, bold=True)
    pdf.drawString(MARGIN, pen.y, fill(texts.get("exclusions_title"))[:120])
    pen.font(BODY_SIZE)
    for text in items(texts.get("exclusions_items")):
        pen.y -= LINE * 0.85
        pdf.drawString(MARGIN + 10 * mm, pen.y, f"- {text}"[:120])

    # The small print, pinned to the bottom of the page.
    pen.font(SMALL_SIZE - 1, italic=True, bold=True)
    y = FOOTER_TOP - 4 * mm
    for paragraph in items(texts.get("footer_text")):
        for text in _fit(paragraph, "Helvetica-BoldOblique", SMALL_SIZE - 1, CONTENT_WIDTH):
            pdf.drawString(MARGIN, y, text)
            y -= 3.2 * mm


# ---- keeping the invoice on one page when it fits ----------------------------


class _InvisibleCanvas:
    """A canvas that draws nothing: every method call is simply ignored.

    Used to MEASURE a block before drawing it. We run the real drawing code
    (_draw_totals, _draw_conditions) on this fake canvas and only look at how
    far the cursor moved down. Because it is the very same code that will draw
    for real, the measurement can never disagree with the drawing - which a
    hand-written estimate ("the totals take about 96 mm") always ends up doing.
    """

    def __getattr__(self, name):
        return lambda *args, **kwargs: None


def _closing_height(doc, company):
    """How tall the totals plus the payment instructions and conditions are."""
    ghost = _Pen(_InvisibleCanvas(), doc.number)
    start = ghost.y
    _draw_totals(ghost, doc)
    _draw_conditions(ghost, doc, company)
    return start - ghost.y


# ---- 5. the PDF ------------------------------------------------------------


def render_document(doc, company):
    """Draw an InvoiceDocument as PDF bytes."""
    buffer = BytesIO()
    # Uncompressed page streams: a few kilobytes of text either way (the logo
    # stays a compressed JPEG), and text that can be found in the file is text
    # a test - or a search through a mailbox - can find.
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=0)
    pdf.setTitle(f"Factuur {doc.number}")
    pdf.setAuthor(settings.DEFAULT_FROM_EMAIL)

    pen = _Pen(pdf, doc.number)
    _draw_header(pen, doc, company)
    _draw_shipment(pen, doc)
    _draw_lines(pen, doc)

    # One page whenever it fits: the totals and conditions stay under the
    # charges unless they would run into the small print at the bottom. Only
    # then - a long list of charges - do they move to a second page (together,
    # so the total and the payment instructions are never split up).
    if pen.y - _closing_height(doc, company) < FOOTER_TOP + FOOTER_GAP:
        pen.new_page()

    _draw_totals(pen, doc)
    _draw_conditions(pen, doc, company)

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def render_invoice_pdf(invoice, company=None):
    """Return a saved invoice as PDF bytes.

    Reads `invoice.package` and `invoice.package.user`, so the caller should
    select_related them if it cares about the number of queries.
    """
    if company is None:
        from accounts.models import SiteSettings

        company = SiteSettings.load()

    return render_document(document_for(invoice), company)
