"""Answering a contact message from the dashboard.

READ THIS FIRST
---------------
Before this existed, the office pressed "Reply by e-mail", which opened their
own mail program. That worked, but nobody else in the team could see whether
a message had been answered, or what was said.

Now the answer is typed in the dashboard and `send_reply` does three things,
in this order:

    1. Save the reply as a ContactReply row (so it is never lost).
    2. Try to e-mail it to the person who wrote the message.
    3. If the e-mail went out: stamp `emailed_at` on the reply and mark the
       message handled. If it did not: store the reason in `send_error` and
       leave the message unhandled, so it is clearly still open.

The e-mail is sent straight away (not through the Celery worker), because the
person who pressed "Send" is waiting for the answer "sent" or "not sent", and
a reply is one small plain-text e-mail.

The e-mail is plain text on purpose. The original message was typed by a
stranger, so it is quoted below the reply as plain text and never as HTML.
"""

import logging

from django.conf import settings
from django.core.mail import EmailMessage
from django.db import transaction
from django.utils import timezone

from .models import ContactReply, QuoteReply, QuoteRequest

logger = logging.getLogger(__name__)

# The few words around the reply, in the language the visitor wrote in.
# Unknown or empty language -> Dutch, the site's default language.
WORDING = {
    "nl": {"wrote": "Op {date} schreef u:", "your_message": "Uw bericht", "your_quote": "Uw offerteaanvraag"},
    "en": {"wrote": "On {date} you wrote:", "your_message": "Your message", "your_quote": "Your quote request"},
    "pap": {
        "wrote": "Riba {date} bo a skirbi:",
        "your_message": "Bo mensahe",
        "your_quote": "Bo petishon di ofèrta",
    },
}


def _wording(language):
    # "en-GB" -> "en"
    code = (language or "").lower().split("-")[0]
    return WORDING.get(code, WORDING["nl"])


def build_email(message, body):
    """The e-mail for one reply. Split out so a test can read it without sending.

    Example result for a message with subject "Prijs" in Dutch:

        Subject: Re: Prijs
        Body:    <the reply>

                 --
                 PayLesShopMore.com

                 Op 22-10-2026 14:05 schreef u:
                 > Hoeveel kost een doos naar Curaçao?
    """
    words = _wording(message.language)
    sent_on = timezone.localtime(message.created_at).strftime("%d-%m-%Y %H:%M")
    # Every line of the original gets "> " in front, the usual way to quote
    # in a plain-text e-mail.
    quoted = "\n".join(f"> {line}" for line in message.message.splitlines())

    text = (
        f"{body.strip()}\n\n"
        "--\n"
        "PayLesShopMore.com\n\n"
        f"{words['wrote'].format(date=sent_on)}\n"
        f"{quoted}\n"
    )

    return EmailMessage(
        subject=f"Re: {message.subject or words['your_message']}",
        body=text,
        to=[message.email],
        reply_to=[settings.OFFICE_REPLY_TO_EMAIL] if settings.OFFICE_REPLY_TO_EMAIL else None,
    )


def send_reply(message, author, body):
    """Save a reply, e-mail it, and return the ContactReply row.

    Never raises because of the mail server: a failed send is written on the
    row (`send_error`) and the caller shows it. Check `reply.emailed_at` to
    know whether it went out.
    """
    # Step 1: save it. In its own transaction, so the row is stored even if
    # sending fails below.
    with transaction.atomic():
        reply = ContactReply.objects.create(message=message, author=author, body=body.strip())

    # Step 2: send it.
    try:
        build_email(message, body).send(fail_silently=False)
    except Exception as error:  # noqa: BLE001 - any mail failure is reported, not raised
        logger.exception("Reply %s to contact message %s could not be e-mailed.", reply.pk, message.pk)
        reply.send_error = str(error)[:300] or error.__class__.__name__
        reply.save(update_fields=["send_error"])
        return reply

    # Step 3: it went out.
    reply.emailed_at = timezone.now()
    reply.save(update_fields=["emailed_at"])
    if not message.handled:
        message.handled = True
        message.save(update_fields=["handled"])
    return reply


# ---------------------------------------------------------------------------
# Quote requests: the same three steps, for the "request a quote" form.
# ---------------------------------------------------------------------------


def build_quote_email(quote, body):
    """The e-mail answering one quote request, e.g. "Re: Your quote request - Curaçao"."""
    words = _wording(quote.language)
    sent_on = timezone.localtime(quote.created_at).strftime("%d-%m-%Y %H:%M")
    quoted = "\n".join(f"> {line}" for line in (quote.message or "").splitlines())

    text = f"{body.strip()}\n\n--\nPayLesShopMore.com\n"
    # The message box is optional on the quote form: nothing to quote then.
    if quoted:
        text += f"\n{words['wrote'].format(date=sent_on)}\n{quoted}\n"

    return EmailMessage(
        subject=f"Re: {words['your_quote']} - {quote.destination}",
        body=text,
        to=[quote.email],
        reply_to=[settings.OFFICE_REPLY_TO_EMAIL] if settings.OFFICE_REPLY_TO_EMAIL else None,
    )


def send_quote_reply(quote, author, body):
    """Save a reply to a quote request, e-mail it, and return the QuoteReply row.

    Like send_reply: never raises because of the mail server. When the e-mail
    went out, a request that was still "New" becomes "Quote sent" - answering
    it is how the office sends the quote.
    """
    with transaction.atomic():
        reply = QuoteReply.objects.create(quote=quote, author=author, body=body.strip())

    try:
        build_quote_email(quote, body).send(fail_silently=False)
    except Exception as error:  # noqa: BLE001 - any mail failure is reported, not raised
        logger.exception("Reply %s to quote request %s could not be e-mailed.", reply.pk, quote.pk)
        reply.send_error = str(error)[:300] or error.__class__.__name__
        reply.save(update_fields=["send_error"])
        return reply

    reply.emailed_at = timezone.now()
    reply.save(update_fields=["emailed_at"])
    if quote.status == QuoteRequest.Status.NEW:
        quote.status = QuoteRequest.Status.QUOTED
        quote.save(update_fields=["status", "updated_at"])
    return reply
