"""Startup checks that say out loud when a deployment is missing a setting
security depends on.

Registered from accounts.apps.AccountsConfig.ready(). A Django system check
runs on every manage.py command - including the `migrate` in entrypoint.sh -
so a warning here appears in the deploy log on every start.
"""

from django.conf import settings
from django.core.checks import Warning, register


@register()
def check_num_proxies(app_configs, **kwargs):
    """Warn when the per-IP throttles would trust X-Forwarded-For blindly."""
    if settings.DEBUG or settings.REST_FRAMEWORK.get("NUM_PROXIES") is not None:
        return []

    return [
        Warning(
            "DJANGO_NUM_PROXIES is not set, so every per-address rate limit "
            "(login, signup, password reset, the public forms) reads the client "
            "address from the whole X-Forwarded-For header, which the client "
            "controls. A client that changes it on every request is never "
            "throttled. The site-wide ceilings in config/abuse.py still apply.",
            hint=(
                "Sign in as an admin and open /api/staff/request-origin/ both "
                "through the site and directly on the backend's own domain, then "
                "set DJANGO_NUM_PROXIES to the number of proxies that appended to "
                "X-Forwarded-For. See NUM_PROXIES in config/settings.py. On "
                "DigitalOcean: DJANGO_CLIENT_IP_HEADER=Do-Connecting-Ip and "
                "DJANGO_NUM_PROXIES=1 (config/client_ip.py)."
            ),
            id="plsm.W001",
        )
    ]


@register()
def check_admin_allow_list(app_configs, **kwargs):
    """The admin IP allow-list needs to know the real client address."""
    if not settings.ADMIN_ALLOWED_IPS or settings.REST_FRAMEWORK.get("NUM_PROXIES") is not None:
        return []
    return [
        Warning(
            "DJANGO_ADMIN_ALLOWED_IPS is set but DJANGO_NUM_PROXIES is not, so the real "
            "visitor address cannot be known and /admin/ is refused to everybody.",
            hint="Set DJANGO_NUM_PROXIES (see the plsm.W001 hint), or clear DJANGO_ADMIN_ALLOWED_IPS.",
            id="plsm.W002",
        )
    ]



@register()
def check_two_factor(app_configs, **kwargs):
    """Say it out loud when a two-factor setting is unsafe for production."""
    from accounts.twofactor import STRICTNESS

    problems = []
    if not settings.DEBUG and getattr(settings, "TWO_FACTOR_FORCE_DISABLED", False):
        problems.append(
            Warning(
                "DJANGO_TWO_FACTOR_FORCE_DISABLED is set, but DEBUG is off, so it is IGNORED: "
                "two-factor follows the Security page as normal.",
                hint="Remove DJANGO_TWO_FACTOR_FORCE_DISABLED here; it is for development only.",
                id="plsm.W003",
            )
        )
    if not settings.DEBUG and not settings.TWO_FACTOR_ENCRYPTION_KEYS:
        problems.append(
            Warning(
                "DJANGO_TWO_FACTOR_ENCRYPTION_KEYS is not set, so authenticator secrets are "
                "encrypted with a key derived from DJANGO_SECRET_KEY. Changing the secret key "
                "would then make every authenticator unreadable.",
                hint=(
                    'Set it to the output of: python -c "from cryptography.fernet import Fernet; '
                    'print(Fernet.generate_key().decode())" and keep it with your other secrets.'
                ),
                id="plsm.W004",
            )
        )
    minimum = getattr(settings, "TWO_FACTOR_MINIMUM_MODE", "")
    if not settings.DEBUG and (
        minimum not in STRICTNESS
        or STRICTNESS.index(minimum) < STRICTNESS.index("required_admins")
    ):
        # /admin/ and the dashboard are reachable from the internet. Without a
        # minimum, one click on the Security page switches admin two-factor off.
        problems.append(
            Warning(
                "DJANGO_TWO_FACTOR_MINIMUM_MODE is not at least \"required_admins\", so the "
                "Security page can turn two-factor off for administrators.",
                hint="Set DJANGO_TWO_FACTOR_MINIMUM_MODE=required_admins.",
                id="plsm.W007",
            )
        )
    if minimum and minimum not in STRICTNESS:
        problems.append(
            Warning(
                f"DJANGO_TWO_FACTOR_MINIMUM_MODE={minimum!r} is not a mode, so no minimum applies.",
                hint="Use one of: " + ", ".join(STRICTNESS),
                id="plsm.W005",
            )
        )
    return problems


@register()
def check_media_storage(app_configs, **kwargs):
    """Warn when uploaded files would be forgotten on the next deploy.

    Photos, invoice PDFs and documents go to the local disk unless a bucket is
    set (AWS_STORAGE_BUCKET_NAME). On DigitalOcean App Platform that disk is
    thrown away on every deploy - while the database still lists the files, so
    the site shows broken photos and "missing" documents.
    """
    if settings.DEBUG or getattr(settings, "AWS_STORAGE_BUCKET_NAME", ""):
        return []
    return [
        Warning(
            "Uploaded files (package and damage photos, invoice PDFs, documents) are saved on "
            "this container's own disk, which is replaced on every deploy. They are gone "
            "after the next deploy, while the database still lists them.",
            hint=(
                "Set AWS_STORAGE_BUCKET_NAME and the AWS_* variables for a private S3-compatible "
                "bucket (e.g. a DigitalOcean Space). See DIGITALOCEAN_DEPLOYMENT.md and 'Object storage' in "
                "config/settings.py."
            ),
            id="plsm.W006",
        )
    ]
