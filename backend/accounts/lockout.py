"""A ceiling on failed sign-ins per account, wherever they come from.

The DRF throttles count per client address, and an address is whatever the
proxies in front say it is: somebody spreading guesses over many addresses,
or able to vary the header that names them, is never slowed down by those.
This counts against the account being guessed at instead, so the number of
passwords anybody can try against one account is bounded however the
requests arrive.

Shared by the API login and Django's /admin/ login, so the two are one
budget: alternating between them buys nothing.

Only failures count. A person who types their password right is never
refused because of somebody else's successful sign-ins.

Two counters, so the ceiling is not a way to lock somebody else out: one per
account and visitor address (LOGIN_FAILURE_LIMIT, 10 by default), which is the
one a stranger guessing at an account meets, while the owner signing in from
their own address is unaffected; and one per account from all addresses
together (LOGIN_FAILURE_ACCOUNT_LIMIT, 50), the ceiling on guessing spread
over many addresses. Only that second one can lock the owner out, and it takes
someone with many addresses to reach it.

The same per-target counting also caps password-reset mails per address
(reset_mail_allowed), so the reset form cannot be used to flood an inbox.
"""

import hashlib

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q


def _limit():
    return getattr(settings, "LOGIN_FAILURE_LIMIT", 10)


def _window():
    return getattr(settings, "LOGIN_FAILURE_WINDOW_SECONDS", 60 * 60)


def account_key(identifier):
    """One key per account, whether it was named by username or by e-mail.

    An identifier that matches no account still gets a key of its own, so a
    lock looks the same for an address that is registered and one that is
    not, and this cannot be used to find out which is which.
    """
    identifier = (identifier or "").strip()
    user = (
        get_user_model()
        .objects.filter(Q(email__iexact=identifier) | Q(username__iexact=identifier))
        .order_by("pk")
        .first()
        if identifier
        else None
    )
    if user is not None:
        ident = f"user-{user.pk}"
    else:
        ident = "name-" + hashlib.sha256(identifier.lower().encode()).hexdigest()
    return f"login-failures:{ident}"


def _account_limit():
    # Never below the per-address limit, or that one would stop mattering.
    return max(getattr(settings, "LOGIN_FAILURE_ACCOUNT_LIMIT", 50), _limit())


def _address_key(key, request):
    """The counter for this account from this visitor's address.

    The address comes from config/admin_access.client_ip, which only trusts
    the part of X-Forwarded-For our own proxies wrote. When it cannot be known,
    every visitor counts as the same one ("unknown"), which makes this the old
    per-account counter rather than something a made-up header could reset.
    """
    from config.admin_access import client_ip

    address = (client_ip(request) if request is not None else None) or "unknown"
    return f"{key}:addr-" + hashlib.sha256(address.encode()).hexdigest()


def is_locked(key, request=None):
    """Whether sign-ins to this account are refused right now, for this visitor.

    Locked from this address after LOGIN_FAILURE_LIMIT failures from it, so a
    stranger guessing at somebody's account does not lock the owner out; and
    from every address after LOGIN_FAILURE_ACCOUNT_LIMIT failures in total, so
    spreading guesses over many addresses still meets a ceiling.
    """
    return (
        cache.get(_address_key(key, request), 0) >= _limit()
        or cache.get(key, 0) >= _account_limit()
    )


def record_failure(key, request=None):
    _bump(_address_key(key, request), _window())
    _bump(key, _window())


def _bump(key, window):
    """Add one to a counter whose window starts at its first count."""
    # add() only writes when the key is absent, so the window is not pushed
    # back by the counts after the first.
    if cache.add(key, 1, window):
        return 1
    try:
        return cache.incr(key)
    except ValueError:
        # Expired between the add() and the incr().
        cache.set(key, 1, window)
        return 1


def reset_mail_allowed(email):
    """Whether another password-reset mail may go to this address now.

    Per address rather than per client, for the same reason as the sign-in
    ceiling: an attacker changing addresses could otherwise have this site
    send a stranger as many reset mails as they liked. Counted whether or not
    the address has an account, so the caller's answer never depends on it.
    """
    digest = hashlib.sha256((email or "").strip().lower().encode()).hexdigest()
    limit = getattr(settings, "PASSWORD_RESET_MAILS_PER_ADDRESS", 3)
    window = getattr(settings, "PASSWORD_RESET_MAIL_WINDOW_SECONDS", 60 * 60)
    return _bump(f"reset-mails:{digest}", window) <= limit
