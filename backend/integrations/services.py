"""Creating keys and endpoints: the one place that does it.

Used by the dashboard's Integrations page (staff_api.py), Django's admin
(admin.py) and the create_api_key command, so all three make them the same
way.
"""

from . import keys
from .models import ApiKey, WebhookEndpoint


def create_api_key(*, name, scopes, created_by=None, expires_at=None):
    """Make a key. Returns (api_key_row, raw_key).

    raw_key is the only copy of the key that will ever exist: show it to the
    person once and do not store or log it anywhere.
    """
    raw_key, prefix, key_hash = keys.new_key()
    api_key = ApiKey.objects.create(
        name=name,
        prefix=prefix,
        key_hash=key_hash,
        scopes=list(scopes),
        created_by=created_by,
        expires_at=expires_at,
    )
    return api_key, raw_key


def create_webhook_endpoint(*, name, url, events, is_active=True):
    """Make an endpoint with a fresh signing secret. Returns the row.

    The caller checks the URL first (webhooks.check_url).
    """
    return WebhookEndpoint.objects.create(
        name=name,
        url=url,
        events=list(events),
        is_active=is_active,
        secret=keys.new_webhook_secret(),
    )
