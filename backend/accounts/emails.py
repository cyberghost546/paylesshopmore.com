"""The password-reset e-mail.

Plain text, in the language the visitor was reading when they asked. Kept in a
dict here rather than in template files because it is one short message per
language and the three read better side by side, where a change to one is an
obvious prompt to change the others.

Nothing here is ever rendered as HTML, so the name — which the account holder
chose, and which nobody else can influence — needs no escaping.
"""

import threading
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

# Falls back to Dutch, which is what the site defaults to.
DEFAULT_LANGUAGE = "nl"

MESSAGES = {
    "nl": {
        "subject": "Uw wachtwoord opnieuw instellen",
        "body": (
            "Hallo {name},\n\n"
            "U heeft gevraagd om uw wachtwoord opnieuw in te stellen. "
            "Open de onderstaande link om een nieuw wachtwoord te kiezen:\n\n"
            "{link}\n\n"
            "Deze link is {hours} uur geldig en kan één keer worden gebruikt.\n\n"
            "Heeft u dit niet zelf aangevraagd? Dan hoeft u niets te doen — "
            "uw wachtwoord blijft ongewijzigd.\n\n"
            "Met vriendelijke groet,\n"
            "PayLesShopMore.com"
        ),
    },
    "en": {
        "subject": "Reset your password",
        "body": (
            "Hello {name},\n\n"
            "You asked to reset your password. Open the link below to choose "
            "a new one:\n\n"
            "{link}\n\n"
            "This link is valid for {hours} hour(s) and can be used once.\n\n"
            "If this was not you, there is nothing to do — your password stays "
            "as it is.\n\n"
            "Kind regards,\n"
            "PayLesShopMore.com"
        ),
    },
    "pap": {
        "subject": "Pone bo kontraseña di nobo",
        "body": (
            "Kon ta {name},\n\n"
            "Bo a pidi pa pone bo kontraseña di nobo. Habri e link akibou pa "
            "skohe un kontraseña nobo:\n\n"
            "{link}\n\n"
            "E link aki ta bálido pa {hours} ora i por wòrdu usá un biaha.\n\n"
            "Si no ta bo a pidi esaki, no tin nada pa hasi — bo kontraseña ta "
            "keda meskos.\n\n"
            "Saludo,\n"
            "PayLesShopMore.com"
        ),
    },
}


# The e-mail that a staff member creating an account sends.
#
# The same link as the reset above, and the same token, which is what keeps
# this to one mechanism rather than two: an account created in the back office
# has no usable password, so choosing a first one and replacing a forgotten one
# are the same act. Only the words differ, and they have to - "you asked to
# reset your password", sent to somebody who asked for nothing, reads as a
# break-in.
#
# The link is as short-lived as a reset link, which is short for something that
# travels by e-mail and gets read hours later. That is a deliberate trade
# rather than an oversight: a second, longer-lived token would be a second
# thing to get right and to keep safe, and the cost of not having one is small
# because the account exists from the moment it is created. So every message
# below says what to do when the link has expired, and the answer is the
# ordinary forgot-password form.
INVITE_MESSAGES = {
    "nl": {
        "subject": "Uw account bij PayLesShopMore.com",
        "body": (
            "Hallo {name},\n\n"
            "Er is een account voor u aangemaakt bij PayLesShopMore.com. "
            "Kies hieronder uw wachtwoord om het in gebruik te nemen:\n\n"
            "{link}\n\n"
            "Deze link is {hours} uur geldig en kan één keer worden gebruikt. "
            "Is de link verlopen? Kies dan 'Wachtwoord vergeten' op de "
            "inlogpagina, dan ontvangt u een nieuwe.\n\n"
            "U logt in met dit e-mailadres: {username}\n\n"
            "Met vriendelijke groet,\n"
            "PayLesShopMore.com"
        ),
    },
    "en": {
        "subject": "Your PayLesShopMore.com account",
        "body": (
            "Hello {name},\n\n"
            "An account has been created for you at PayLesShopMore.com. "
            "Choose your password below to start using it:\n\n"
            "{link}\n\n"
            "This link is valid for {hours} hour(s) and can be used once. If "
            "it has expired, choose 'Forgot password' on the sign-in page and "
            "a new one will be sent.\n\n"
            "You sign in with this e-mail address: {username}\n\n"
            "Kind regards,\n"
            "PayLesShopMore.com"
        ),
    },
    "pap": {
        "subject": "Bo kuenta na PayLesShopMore.com",
        "body": (
            "Kon ta {name},\n\n"
            "Nos a traha un kuenta pa bo na PayLesShopMore.com. Skohe bo "
            "kontraseña akibou pa kuminsá us'e:\n\n"
            "{link}\n\n"
            "E link aki ta bálido pa {hours} ora i por wòrdu usá un biaha. Si "
            "e link a vense, skohe 'Wachtwoord vergeten' riba e página di "
            "login pa haña un nobo.\n\n"
            "Bo ta drenta ku e email aki: {username}\n\n"
            "Saludo,\n"
            "PayLesShopMore.com"
        ),
    },
}


def reset_link(user):
    """The URL in the e-mail.

    The token is Django's own. Two properties matter: it is derived from the
    account's current password hash and last-login time, so using it once (or
    changing the password any other way) makes it stop working; and it is
    signed, so it cannot be forged without the secret key.
    """
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)

    return f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}"


def _valid_hours():
    """How long a link lasts, in whole hours.

    Rounded up, so a 90-minute timeout does not advertise itself as one hour,
    and floored at one so a short one does not promise zero.
    """
    return max(1, -(-settings.PASSWORD_RESET_TIMEOUT // 3600))


def send_account_invite(user, language=""):
    """Tell somebody an account has been made for them, and let them into it.

    Sent by the back office when it creates an account, which is the only way
    an account comes into being without its owner choosing a password. The
    account is left with no usable password until this link is followed, so
    nobody - not the office, not the person who pressed the button - ever
    knows what it becomes.

    fail_silently, like the reset below: the account has been created and
    committed by the time this runs, and a mail server having a bad afternoon
    must not turn a created account into a 500. The dashboard says plainly
    that the invitation may not have arrived, and the office can send it again
    from the forgot-password form.
    """
    copy = INVITE_MESSAGES.get(language) or INVITE_MESSAGES[DEFAULT_LANGUAGE]

    send_mail(
        subject=copy["subject"],
        message=copy["body"].format(
            name=user.first_name or user.get_username(),
            link=reset_link(user),
            hours=_valid_hours(),
            username=user.get_username(),
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


def send_password_reset(user, language=""):
    """Send the reset mail. Returns nothing; failures are not the caller's
    business to report, for the reason described in the view."""
    copy = MESSAGES.get(language) or MESSAGES[DEFAULT_LANGUAGE]

    hours = _valid_hours()

    message = {
        "subject": copy["subject"],
        "message": copy["body"].format(
            name=user.first_name or user.get_username(),
            link=reset_link(user),
            hours=hours,
        ),
        "from_email": settings.DEFAULT_FROM_EMAIL,
        "recipient_list": [user.email],
        # The view answers the same way whether or not the mail went out, so a
        # broken mail server must not turn into a 500 that says "this address
        # exists, and something went wrong for it".
        "fail_silently": True,
    }

    # Sent after the answer, not before it. Talking to the mail server takes a
    # noticeable moment, and only happens for an address that has an account,
    # so sending inline made a registered address answer more slowly - a way
    # to find out who has an account despite the identical 204.
    _send_in_background(lambda: send_mail(**message))


def _send_in_background(send):
    """Run `send` on a thread of its own, so the request does not wait for it.

    Inline with the in-memory mail backend the tests use, so they can read the
    outbox straight after the request. A daemon thread: a mail still being
    sent when the process stops is lost, like any other fail_silently mail.
    """
    if settings.EMAIL_BACKEND == "django.core.mail.backends.locmem.EmailBackend":
        send()
        return
    threading.Thread(target=send, name="password-reset-mail", daemon=True).start()


# The e-mail an admin triggers to give a warehouse worker a four-digit code.
#
# The code sits alone on its own line, which is what makes it readable at a
# glance on a phone and what the tests look for. It is not in the subject line:
# subjects show on lock screens and in notification previews, the body does
# not until the message is opened.
#
# The link only opens the sign-in page already switched to the code form with
# the address filled in. It deliberately does not carry the code: a link that
# signed somebody in would be spent by any mail scanner that follows links, and
# would turn "something they know" into "something anybody holding the e-mail
# can click".
SIGN_IN_CODE_MESSAGES = {
    "nl": {
        "subject": "Uw inlogcode voor PayLesShopMore.com",
        "body": (
            "Hallo {name},\n\n"
            "Een beheerder heeft een inlogcode voor u gestuurd. Uw code is:\n\n"
            "{code}\n\n"
            "Open de onderstaande link, of kies 'Magazijncode' op de "
            "inlogpagina, en vul uw e-mailadres en deze code in:\n\n"
            "{link}\n\n"
            "De code is {minutes} minuten geldig en kan één keer worden "
            "gebruikt. Na vijf foute pogingen werkt hij niet meer; vraag dan "
            "een nieuwe aan.\n\n"
            "Deel deze code met niemand. Verwachtte u dit bericht niet? Dan "
            "hoeft u niets te doen.\n\n"
            "Met vriendelijke groet,\n"
            "PayLesShopMore.com"
        ),
    },
    "en": {
        "subject": "Your sign-in code for PayLesShopMore.com",
        "body": (
            "Hello {name},\n\n"
            "An admin has sent you a sign-in code. Your code is:\n\n"
            "{code}\n\n"
            "Open the link below, or choose 'Warehouse code' on the sign-in "
            "page, and enter your e-mail address and this code:\n\n"
            "{link}\n\n"
            "The code is valid for {minutes} minutes and can be used once. "
            "After five wrong attempts it stops working; ask for a new one "
            "then.\n\n"
            "Do not share this code. If you were not expecting this message, "
            "there is nothing to do.\n\n"
            "Kind regards,\n"
            "PayLesShopMore.com"
        ),
    },
    "pap": {
        "subject": "Bo kódigo di login pa PayLesShopMore.com",
        "body": (
            "Kon ta {name},\n\n"
            "Un administrador a manda bo un kódigo di login. Bo kódigo ta:\n\n"
            "{code}\n\n"
            "Habri e link akibou, of skohe 'Kódigo di warehouse' riba e página "
            "di login, i yena bo direkshon di e-mail ku e kódigo aki:\n\n"
            "{link}\n\n"
            "E kódigo ta bálido pa {minutes} minut i por wòrdu usá un biaha. "
            "Despues di sinku purbamentu robes e no ta traha mas; pidi un nobo "
            "anto.\n\n"
            "No kompartí e kódigo aki ku niun hende. Si bo no tabata spera e "
            "mensahe aki, no tin nada pa hasi.\n\n"
            "Saludo,\n"
            "PayLesShopMore.com"
        ),
    },
}


def sign_in_code_link(user):
    """The sign-in page with the code form open and the address filled in.

    The address is the worker's own, going to a page they are about to type it
    into anyway. The code is never part of the URL - see the note above.
    """
    query = urlencode({"method": "code", "email": user.email})
    return f"{settings.FRONTEND_URL}/login?{query}"


def send_sign_in_code(user, code, language=""):
    """E-mail a warehouse worker their sign-in code.

    Unlike the invitation and the reset mail this is *not* fail_silently. Those
    are sent from a request whose answer must not depend on the mail going out;
    this one is an admin pressing "Send code" and watching the screen, and
    "sent" when nothing was sent leaves a worker standing at a scanner waiting
    for an e-mail that is not coming. A failure raises, and the view tells the
    admin to try again.
    """
    copy = SIGN_IN_CODE_MESSAGES.get(language) or SIGN_IN_CODE_MESSAGES[DEFAULT_LANGUAGE]

    send_mail(
        subject=copy["subject"],
        message=copy["body"].format(
            name=user.first_name or user.get_username(),
            code=code,
            minutes=settings.WAREHOUSE_CODE_MINUTES,
            link=sign_in_code_link(user),
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )


# Sent to the OLD address when the office changes a customer's e-mail address.
# Dutch and English together: the account holds no language preference, and a
# security notice that arrives in a language the reader cannot follow is one
# they will ignore.
EMAIL_CHANGED_MESSAGE = {
    "subject": "Uw e-mailadres is gewijzigd / Your e-mail address was changed",
    "body": (
        "Hallo {name},\n\n"
        "Het e-mailadres van uw PayLesShopMore-account is door ons kantoor "
        "gewijzigd naar {new_email}. Wachtwoordherstel en berichten gaan vanaf "
        "nu naar dat adres.\n\n"
        "Heeft u hier niet om gevraagd? Neem dan direct contact met ons op.\n\n"
        "---\n\n"
        "Hello {name},\n\n"
        "The e-mail address on your PayLesShopMore account was changed by our "
        "office to {new_email}. Password resets and messages now go to that "
        "address.\n\n"
        "If you did not ask for this, contact us straight away.\n"
    ),
}


def send_email_changed_notice(user, old_email):
    """Warn the previous address that the office changed it.

    Changing the address is changing where a password-reset link goes, so it
    is in effect handing the account to whoever reads the new inbox. A staff
    member doing that for a customer is normal support work; this mail is what
    makes it impossible to do quietly - the person who owned the account hears
    about it at the address they still control.

    fail_silently, like the other mails here: the change has been saved, and a
    mail server failing must not turn it into a 500.
    """
    if not old_email:
        return
    send_mail(
        subject=EMAIL_CHANGED_MESSAGE["subject"],
        message=EMAIL_CHANGED_MESSAGE["body"].format(
            name=user.first_name or user.get_username(),
            new_email=user.email,
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[old_email],
        fail_silently=True,
    )


# ---- the customer changed how they receive a shipment ----------------------

# The words for the two choices, per language (Package.Handover).
HANDOVER_WORDS = {
    "nl": {"delivery": "bezorgen", "pickup": "zelf ophalen"},
    "en": {"delivery": "delivery", "pickup": "pick it up myself"},
    "pap": {"delivery": "entrega", "pickup": "bin buska mi mes"},
}

HANDOVER_CUSTOMER_MESSAGE = {
    "nl": {
        "subject": "Uw keuze voor zending {tracking} is gewijzigd",
        "body": (
            "Hallo {name},\n\n"
            "U heeft gekozen hoe u zending {tracking} wilt ontvangen: {choice}.\n"
            "Wij hebben dit doorgegeven aan ons kantoor.\n\n"
            "Heeft u dit niet zelf gedaan? Neem dan contact met ons op.\n\n"
            "Met vriendelijke groet,\nPay Less Shop More"
        ),
    },
    "en": {
        "subject": "Your choice for shipment {tracking} has changed",
        "body": (
            "Hello {name},\n\n"
            "You chose how you would like to receive shipment {tracking}: {choice}.\n"
            "We have passed this on to our office.\n\n"
            "Did you not make this change? Please contact us.\n\n"
            "Kind regards,\nPay Less Shop More"
        ),
    },
    "pap": {
        "subject": "Bo eskoho pa envio {tracking} a kambia",
        "body": (
            "Halo {name},\n\n"
            "Bo a skohe kon bo kier risibí envio {tracking}: {choice}.\n"
            "Nos a pasa esaki pa nos ofisina.\n\n"
            "Bo no a hasi e kambio aki? Por fabor tuma kontakto ku nos.\n\n"
            "Saludo kordial,\nPay Less Shop More"
        ),
    },
}


def send_handover_changed(package, previous):
    """The customer changed "Delivery" / "Pick it up myself" on a shipment.

    Two mails, both fail_silently (the choice is saved either way):

    * the office (warehouse/recipients.py office_recipients) is told, because
      a parcel that was going to be driven out now waits at the counter, or
      the other way round, and somebody has to plan for it;
    * the customer gets a confirmation in their own language, which is also
      how they hear of a change they did not make themselves.
    """
    from warehouse.recipients import office_recipients

    user = package.user
    words = HANDOVER_WORDS["en"]
    office = office_recipients()
    if office:
        name = (user.get_full_name() or user.get_username()) if user else "-"
        send_mail(
            subject=f"Customer changed delivery choice: {package.tracking_number} - {words[package.handover]}",
            message=(
                "A customer changed how they want to receive their shipment.\n\n"
                f"Shipment:     {package.tracking_number}\n"
                f"Customer:     {name} ({user.email if user else '-'})\n"
                f"Now:          {words[package.handover]}\n"
                f"Was:          {words.get(previous, previous or '-')}\n"
                f"Address:      {(package.delivery_address_text or '-').replace(chr(10), ', ')}\n"
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=office,
            fail_silently=True,
        )

    if user is not None and user.email:
        language = user.language if user.language in HANDOVER_CUSTOMER_MESSAGE else DEFAULT_LANGUAGE
        copy = HANDOVER_CUSTOMER_MESSAGE[language]
        send_mail(
            subject=copy["subject"].format(tracking=package.tracking_number),
            message=copy["body"].format(
                name=user.first_name or user.get_username(),
                tracking=package.tracking_number,
                choice=HANDOVER_WORDS[language][package.handover],
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=True,
        )
