"""Connecting other software to this website.

READ THIS FIRST
---------------
Two directions, two tools:

1. Their software -> this website (INBOUND)
   The other program sends requests to /api/integrations/v1/... with an API
   key in the Authorization header. The key decides what it may do ("scopes").
   Files: keys.py, authentication.py, permissions.py, views.py, urls.py.

2. This website -> their software (OUTBOUND, "webhooks")
   When something happens here (an invoice is sent, a shipment changes
   status) we POST a small JSON message to a URL they gave us, signed with a
   shared secret so they can check it really came from us.
   Files: webhooks.py (build, sign, queue), tasks.py (send and retry).

Both are managed by an admin in Django's /admin/ (admin.py). The guide for
whoever builds the other side is docs/INTEGRATIONS.md.
"""
