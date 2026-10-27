"""python manage.py reset_two_factor boss@example.com

The last way back in, for an admin who has lost their phone AND their
recovery codes when there is no other admin to press "Reset 2FA" on the
Workers page.

It only runs on the server itself (Railway: the service's shell), which
already proves you are allowed to run the site - so it is not a "bypass":
there is no public page or route that does this. It removes the account's
authenticator and recovery codes, signs it out everywhere and writes an
audit event. The next sign-in sets the app up again.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from accounts import twofactor
from accounts.models import TwoFactorAuditEvent


class Command(BaseCommand):
    help = "Remove an account's authenticator app and recovery codes (lost phone)."

    def add_arguments(self, parser):
        parser.add_argument("email")

    def handle(self, *args, email, **options):
        user = get_user_model().objects.filter(email__iexact=email.strip()).first()
        if user is None:
            raise CommandError(f"No account with the e-mail address {email}.")
        twofactor.remove(user, TwoFactorAuditEvent.Kind.RESET_FROM_SERVER)
        self.stdout.write(
            self.style.SUCCESS(f"Two-factor reset for {user.email}. They set it up again at their next sign-in.")
        )
