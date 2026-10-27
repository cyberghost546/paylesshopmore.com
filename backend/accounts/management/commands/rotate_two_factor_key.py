"""python manage.py rotate_two_factor_key

Re-encrypts every stored authenticator secret with the CURRENT key - the first
one in DJANGO_TWO_FACTOR_ENCRYPTION_KEYS. Used when replacing the key:

    1. DJANGO_TWO_FACTOR_ENCRYPTION_KEYS=NEW_KEY,OLD_KEY   (new one first)
    2. python manage.py rotate_two_factor_key
    3. DJANGO_TWO_FACTOR_ENCRYPTION_KEYS=NEW_KEY           (old one removed)

See accounts/twofactor_crypto.py. Safe to run twice.
"""

from django.core.management.base import BaseCommand

from accounts import twofactor_crypto
from accounts.models import TwoFactorDevice


class Command(BaseCommand):
    help = "Re-encrypt the authenticator secrets with the current key."

    def handle(self, *args, **options):
        done = failed = 0
        for device in TwoFactorDevice.objects.all():
            try:
                device.secret_encrypted = twofactor_crypto.reencrypt(device.secret_encrypted)
            except twofactor_crypto.InvalidToken:
                failed += 1
                self.stderr.write(f"Could not decrypt the secret of user {device.user_id}: no key fits.")
                continue
            device.save(update_fields=["secret_encrypted"])
            done += 1
        self.stdout.write(self.style.SUCCESS(f"Re-encrypted {done}; could not read {failed}."))
