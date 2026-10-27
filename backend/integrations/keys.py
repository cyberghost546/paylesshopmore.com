"""Making and checking API keys.

A key looks like:   plsm_a1b2c3d4_Xy9...43 random characters...
                    ^^^^ ^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                    brand  prefix  secret

- The prefix is stored as it is, so we can find the key's row quickly.
- The whole key is stored only as a SHA-256 hash. SHA-256 (not a slow
  password hash like PBKDF2) is fine here because the key is 32 random bytes:
  nobody can guess it, so there is nothing for a slow hash to slow down.
"""

import hashlib
import hmac
import secrets

BRAND = "plsm"


def hash_key(raw_key):
    """The hex SHA-256 of a key. Example: hash_key("plsm_x_y") -> "3f1c...", 64 chars."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def new_key():
    """Make a fresh key. Returns (raw_key, prefix, key_hash).

    raw_key is shown to the admin ONCE and then forgotten.
    """
    prefix = f"{BRAND}_{secrets.token_hex(4)}"  # e.g. "plsm_a1b2c3d4"
    raw_key = f"{prefix}_{secrets.token_urlsafe(32)}"
    return raw_key, prefix, hash_key(raw_key)


def split_prefix(raw_key):
    """The prefix part of a key, or None if it is not shaped like one of ours.

    "plsm_a1b2c3d4_secret" -> "plsm_a1b2c3d4"
    "something-else"       -> None
    """
    parts = raw_key.split("_", 2)
    if len(parts) != 3 or parts[0] != BRAND or not parts[1] or not parts[2]:
        return None
    return f"{parts[0]}_{parts[1]}"


def matches(raw_key, key_hash):
    """Compare in constant time, so the answer's speed gives nothing away."""
    return hmac.compare_digest(hash_key(raw_key), key_hash)


def new_webhook_secret():
    """The shared secret for signing webhooks, e.g. "whsec_Ab3...". """
    return f"whsec_{secrets.token_urlsafe(32)}"
