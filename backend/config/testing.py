"""Test helpers shared across the apps."""

import time

from django.core.cache import cache
from rest_framework.test import APIClient, APITestCase

from accounts.floor import WAREHOUSE_UNLOCKED_KEY
from accounts.reauth import REAUTH_AT_KEY


class ReauthenticatedAPIClient(APIClient):
    """An APIClient whose force_authenticate also counts as "just confirmed
    the password" (accounts/reauth.py).

    force_authenticate skips signing in, and signing in is what normally
    opens that window. Without this, every test of a sensitive admin action
    (roles, deleting accounts, API keys) would be stopped at the "confirm it's
    you" step - testing that step instead of the action.
    accounts/test_reauth.py tests the step itself, with a plain APIClient.
    """

    def force_authenticate(self, user=None, token=None):
        super().force_authenticate(user, token)
        if user is not None:
            session = self.session
            session[REAUTH_AT_KEY] = time.time()
            session.save()


class ThrottleFreeAPITestCase(APITestCase):
    """An APITestCase that starts each test with the throttle counters empty.

    DRF keeps those counters in the cache, which is not part of the database
    and so is not rolled back between tests — it is shared by the whole run.
    Without this, adding one more test to a throttled endpoint makes some
    other test fail with a 429 for reasons that have nothing to do with what
    it is checking.
    """

    client_class = ReauthenticatedAPIClient

    def setUp(self):
        super().setUp()
        cache.clear()


class FloorAPIClient(ReauthenticatedAPIClient):
    """An APIClient whose force_authenticate opens the warehouse for a floor
    account, the way a real sign-in with a code or a PIN does.

    A warehouse account only reaches the warehouse in a session that has shown
    it is them for the floor (staff.permissions.IsWarehouseOrStaff, and
    accounts/floor.py). force_authenticate skips signing in altogether, so on
    its own it would leave every warehouse test refused at the door - testing
    the door rather than the room. accounts/test_floor.py tests the door.
    """

    def force_authenticate(self, user=None, token=None):
        super().force_authenticate(user, token)
        if user is not None and getattr(user, "is_warehouse", False):
            session = self.session
            session[WAREHOUSE_UNLOCKED_KEY] = True
            session.save()


class WarehouseAPITestCase(APITestCase):
    """For tests of what a warehouse account does once it is in."""

    client_class = FloorAPIClient
