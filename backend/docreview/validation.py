"""Checking what the AI read, before anything is looked up with it.

READ THIS FIRST
---------------
`clean(fields, document_text)` takes the AI's answer and returns:

    extracted - the same fields, tidied up (trimmed, upper-cased codes,
                cleaned tracking numbers, only the fields we know about)
    issues    - a list of problems, each {"field", "code", "message"}

The checks, one by one:

1. Shape: every value must be text (or a list of text for the list fields).
   Anything else is dropped. Lengths are capped.
2. Format, per field:
       customer_email      looks like an e-mail address
       customer_code       PLSM-C followed by at least 5 digits
       shipment_numbers    PLSM-00012 or PLSM-B00003 (optionally -2, -3 ...)
       carrier tracking    accepted by tracking.normalize (digits, length)
       invoice_date        a real date, YYYY-MM-DD
       total_amount        a number with at most 2 decimals
3. "Is it really in the document?": every identifier (codes, numbers, the
   e-mail address) must appear in the document's text. The comparison
   ignores spaces, dashes and case, so "PLSM - 00012" in the text matches
   "PLSM-00012". An identifier that is not found gets the code
   "not_in_text" and is NEVER used to link anything automatically - this is
   the guard against the AI inventing or "correcting" a number.

An issue does not stop the job; it only means a person has to look.
"""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

from tracking.normalize import InvalidTrackingNumber, normalize_tracking_number

TEXT_FIELDS = {
    "document_type": 40,
    "summary": 300,
    "customer_name": 150,
    "customer_email": 254,
    "customer_code": 20,
    "carrier_name": 60,
    "shop_name": 100,
    "order_number": 60,
    "invoice_number": 60,
    "invoice_date": 10,
    "total_amount": 20,
    "currency": 3,
}
LIST_FIELDS = {"shipment_numbers": 10, "carrier_tracking_numbers": 10}

# The fields staff may edit in the review screen (everything except the
# transcription and the summary, which are for reading).
EDITABLE_FIELDS = set(TEXT_FIELDS) - {"summary"} | set(LIST_FIELDS)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
CUSTOMER_CODE_RE = re.compile(r"^PLSM-C\d{5,}$")
SHIPMENT_NUMBER_RE = re.compile(r"^PLSM-B?\d{5,}(-\d+)?$")
AMOUNT_RE = re.compile(r"^-?\d+(\.\d{1,2})?$")
DOCUMENT_TYPES = {
    "shop_invoice",
    "receipt",
    "order_confirmation",
    "shipping_label",
    "customs_form",
    "our_invoice",
    "email",
    "photo",
    "other",
}


def squash(value):
    """Only letters and digits, upper case: 'plsm - 000 12' -> 'PLSM00012'."""
    return re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()


def in_text(value, squashed_text):
    return bool(value) and squash(value) in squashed_text


def clean(fields, document_text):
    """See the module docstring. `document_text` is all text we have for the
    document (the AI's transcription plus a PDF's own text layer)."""
    fields = fields if isinstance(fields, dict) else {}
    extracted, issues = {}, []

    def issue(field, code, message, value=None):
        # `value` is set for a list field, so we know WHICH number failed.
        issues.append({"field": field, "code": code, "message": message, "value": value})

    # 1. Shape
    for name, limit in TEXT_FIELDS.items():
        value = fields.get(name, "")
        extracted[name] = value.strip()[:limit] if isinstance(value, str) else ""
    for name, limit in LIST_FIELDS.items():
        values = fields.get(name, [])
        values = values if isinstance(values, list) else []
        seen, kept = set(), []
        for value in values:
            if isinstance(value, str) and value.strip() and value.strip() not in seen:
                seen.add(value.strip())
                kept.append(value.strip()[:64])
        extracted[name] = kept[:limit]

    # 2. Format
    if extracted["document_type"] not in DOCUMENT_TYPES:
        extracted["document_type"] = "other"

    extracted["customer_email"] = extracted["customer_email"].lower()
    if extracted["customer_email"] and not EMAIL_RE.match(extracted["customer_email"]):
        issue("customer_email", "invalid", "This does not look like an e-mail address.")

    extracted["customer_code"] = extracted["customer_code"].upper().replace(" ", "")
    if extracted["customer_code"] and not CUSTOMER_CODE_RE.match(extracted["customer_code"]):
        issue("customer_code", "invalid", "A customer number looks like PLSM-C00012.")

    numbers = []
    for number in extracted["shipment_numbers"]:
        number = number.upper().replace(" ", "")
        numbers.append(number)
        if not SHIPMENT_NUMBER_RE.match(number):
            issue("shipment_numbers", "invalid", f"{number} does not look like one of our shipment numbers.", number)
    extracted["shipment_numbers"] = numbers

    tracking = []
    for number in extracted["carrier_tracking_numbers"]:
        try:
            tracking.append(normalize_tracking_number(number))
        except InvalidTrackingNumber as error:
            issue("carrier_tracking_numbers", "invalid", f"{number}: {error}", number)
    extracted["carrier_tracking_numbers"] = tracking

    if extracted["invoice_date"]:
        try:
            date.fromisoformat(extracted["invoice_date"])
        except ValueError:
            issue("invoice_date", "invalid", "The invoice date is not a real date (YYYY-MM-DD).")

    if extracted["total_amount"]:
        amount = extracted["total_amount"].replace(",", ".").replace(" ", "")
        try:
            if not AMOUNT_RE.match(amount):
                raise InvalidOperation
            extracted["total_amount"] = str(Decimal(amount))
        except InvalidOperation:
            issue("total_amount", "invalid", "The amount is not a number with at most two decimals.")

    extracted["currency"] = extracted["currency"].upper()

    # 3. Really in the document?
    squashed = squash(document_text)
    if squashed:
        for name in ("customer_code", "customer_email", "invoice_number", "order_number"):
            if extracted[name] and not in_text(extracted[name], squashed):
                issue(name, "not_in_text", "Not found in the document's text, so it is not trusted.")
        for name in LIST_FIELDS:
            for value in extracted[name]:
                if not in_text(value, squashed):
                    issue(
                        name,
                        "not_in_text",
                        f"{value} was not found in the document's text, so it is not trusted.",
                        value,
                    )
    else:
        issue("text", "no_text", "No readable text was found in the document.")

    return extracted, issues


def untrusted_values(issues):
    """{(field, value-or-None)} that failed a check. Matching uses this to
    keep failed identifiers out of automatic linking."""
    return {(item["field"], item.get("value")) for item in issues if item["code"] in ("invalid", "not_in_text")}
