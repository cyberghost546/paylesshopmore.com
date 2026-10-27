"""Encrypting the authenticator secrets kept in the database.

READ THIS FIRST
---------------
A two-factor secret is the thing that makes the 6-digit codes. Anybody who
has it can make the codes too, so it must not sit in the database as plain
text: a stolen backup of the database would hand over every account's second
factor.

So it is encrypted with Fernet (from the `cryptography` library: AES plus a
check that the text was not tampered with) before it is saved, and decrypted
only at the moment a code is checked.

THE KEY: TWO_FACTOR_ENCRYPTION_KEYS in settings.py, from the environment
variable DJANGO_TWO_FACTOR_ENCRYPTION_KEYS. Make one with:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Several keys, comma-separated, are allowed: the FIRST encrypts, ALL of them
can decrypt. That is how a key is replaced without breaking anything:

    1. put the new key in front:      NEW,OLD
    2. run: python manage.py rotate_two_factor_key   (re-encrypts with NEW)
    3. remove OLD.

!! Never lose or change the key in production without that rotation: every
!! authenticator secret becomes unreadable and everybody with two-factor has
!! to be reset. Keep it with the other secrets (like DJANGO_SECRET_KEY).

When no key is set (local development) one is derived from SECRET_KEY, so the
site works out of the box. A startup check warns if that happens in
production (config/checks.py).
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings


def _derived_key():
    """A Fernet key made from SECRET_KEY: the development fallback."""
    digest = hashlib.sha256(f"two-factor-secrets:{settings.SECRET_KEY}".encode()).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet():
    keys = [key.strip() for key in settings.TWO_FACTOR_ENCRYPTION_KEYS if key.strip()]
    if not keys:
        keys = [_derived_key()]
    return MultiFernet([Fernet(key) for key in keys])


def encrypt(secret):
    """Plain secret ("JBSWY3DP...") -> encrypted text for the database."""
    return _fernet().encrypt(secret.encode()).decode()


def decrypt(token):
    """Encrypted text from the database -> plain secret.

    Raises InvalidToken when none of the keys fits (the key was lost or
    changed without the rotation described above).
    """
    return _fernet().decrypt(token.encode()).decode()


def reencrypt(token):
    """Encrypted text -> the same secret, encrypted with the CURRENT (first) key."""
    return _fernet().rotate(token.encode()).decode()


__all__ = ["encrypt", "decrypt", "reencrypt", "InvalidToken"]
