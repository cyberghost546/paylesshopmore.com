"""Signing in with an API key, and the throttle that goes with it.

IMPORTANT - why this is NOT in REST_FRAMEWORK's DEFAULT_AUTHENTICATION_CLASSES:
an API key must only open the integration routes. If it were a default, a key
would also be tried on every other route, and anything that only checks "is
somebody signed in?" would let it in. So only the views in this app list it
(views.py), and the rest of the API keeps accepting browser sessions only.

How a request is checked:
    1. Read "Authorization: Bearer plsm_xxxxxxxx_secret".
    2. Find the key's row by its prefix.
    3. Compare hashes; refuse if revoked or expired.
    4. request.user = an IntegrationUser (not a person, never staff),
       request.auth = the ApiKey row (permissions.py reads its scopes).
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication, exceptions
from rest_framework.throttling import SimpleRateThrottle

from . import keys
from .models import ApiKey

# One generic answer for every kind of bad key, so the reply never tells a
# guesser which part was wrong (unknown prefix, wrong secret, revoked...).
INVALID = "Invalid or expired API key."


class IntegrationUser:
    """Stands in for request.user when an outside program calls us.

    Deliberately not a User: it has no id, no role and is never staff, so no
    other part of the site can mistake it for a person with access.
    """

    is_authenticated = True
    is_anonymous = False
    is_active = True
    is_staff = False
    is_superuser = False
    is_warehouse = False
    pk = None
    id = None

    def __init__(self, api_key):
        self.api_key = api_key

    def __str__(self):
        return f"API key {self.api_key.prefix}"


class ApiKeyAuthentication(authentication.BaseAuthentication):
    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("latin-1")
        if not header:
            return None  # no key sent: DRF answers 401 (see authenticate_header)

        word, _, raw_key = header.partition(" ")
        if word != self.keyword or not raw_key.strip():
            raise exceptions.AuthenticationFailed(INVALID)
        raw_key = raw_key.strip()

        prefix = keys.split_prefix(raw_key)
        api_key = ApiKey.objects.filter(prefix=prefix).first() if prefix else None
        if api_key is None or not keys.matches(raw_key, api_key.key_hash) or not api_key.is_usable:
            raise exceptions.AuthenticationFailed(INVALID)

        # "Last used" helps an admin spot keys nobody needs any more. Written
        # at most once a minute, as a plain UPDATE (no other fields touched).
        now = timezone.now()
        if api_key.last_used_at is None or now - api_key.last_used_at > timedelta(minutes=1):
            ApiKey.objects.filter(pk=api_key.pk).update(last_used_at=now)
            api_key.last_used_at = now

        return IntegrationUser(api_key), api_key

    def authenticate_header(self, request):
        # Having this makes DRF answer 401 (not 403) when the key is missing.
        return self.keyword


class ApiKeyThrottle(SimpleRateThrottle):
    """Requests are counted per key (rate "integration" in settings.py)."""

    scope = "integration"

    def get_cache_key(self, request, view):
        if isinstance(request.auth, ApiKey):
            ident = f"key-{request.auth.pk}"
        else:
            ident = self.get_ident(request)  # no valid key: counted by address
        return self.cache_format % {"scope": self.scope, "ident": ident}
