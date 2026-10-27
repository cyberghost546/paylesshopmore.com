"""Checking a key's scopes.

Each view says which scope it needs, e.g. `required_scope = Scope.INVOICES_READ`.
A key without it gets 403. A view with no required_scope (the ping) only needs
a valid key.
"""

from rest_framework.permissions import BasePermission

from .models import ApiKey


class HasApiKeyScope(BasePermission):
    message = "This API key does not have the scope this route needs."

    def has_permission(self, request, view):
        api_key = request.auth
        if not isinstance(api_key, ApiKey):
            return False  # signed in some other way (a browser session): no
        needed = getattr(view, "required_scope", None)
        return needed is None or api_key.has_scope(needed)
