"""The dashboard's Security page: the admin's two-factor policy.

    GET /api/staff/security/two-factor/
        The mode the admin chose, the mode actually enforced (an environment
        minimum may make it stricter), who would be affected by each mode and
        whether they have set it up, and the latest audit events.

    PUT /api/staff/security/two-factor/   {"mode": "...", "password": "..."}
        Change the mode. ADMINS ONLY, and only with the admin's own password
        typed again: a session left open on somebody's desk must not be enough
        to switch the protection off.

How the modes behave, and every safety net: accounts/twofactor.py.
"""

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import reauth, twofactor
from accounts.models import TwoFactorAuditEvent

from .permissions import IsAdmin

MODES = twofactor.STRICTNESS
RECENT_EVENTS = 25


def person(user):
    return {"id": user.pk, "name": str(user), "email": user.email} if user else None


class TwoFactorPolicyView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(self._state(request))

    def put(self, request):
        new_mode = str(request.data.get("mode") or "")
        if new_mode not in MODES:
            return Response({"mode": ["Choose one of: " + ", ".join(MODES)]}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.check_password(str(request.data.get("password") or "")):
            return Response(
                {"password": ["Your password is not right."]}, status=status.HTTP_400_BAD_REQUEST
            )
        reauth.mark(request)
        try:
            twofactor.change_policy(new_mode, request.user, request)
        except ValueError as refusal:
            return Response({"detail": str(refusal), "code": "would_lock_you_out"}, status=status.HTTP_409_CONFLICT)
        return Response(self._state(request))

    @staticmethod
    def _state(request):
        affected = {}
        for mode in (twofactor.Mode.REQUIRED_ADMINS, twofactor.Mode.REQUIRED_ALL):
            rows = twofactor.accounts_affected(mode)
            affected[mode] = {
                "total": len(rows),
                "set_up": sum(1 for _, has in rows if has),
                # Names only for the administrators: a short list worth reading.
                # For "everyone" the counts say enough.
                "without": [person(user) for user, has in rows if not has]
                if mode == twofactor.Mode.REQUIRED_ADMINS
                else [],
            }
        events = TwoFactorAuditEvent.objects.select_related("user", "actor")[:RECENT_EVENTS]
        return {
            "mode": twofactor.stored_mode(),
            "effective_mode": twofactor.effective_mode(),
            "minimum_mode": twofactor.minimum_mode(),
            "force_disabled": twofactor.force_disabled(),
            "debug": settings.DEBUG,
            "you_have_it": twofactor.confirmed_device(request.user) is not None,
            "affected": affected,
            "events": [
                {
                    "id": event.pk,
                    "kind": event.kind,
                    "kind_display": event.get_kind_display(),
                    "user": person(event.user),
                    "actor": person(event.actor),
                    "detail": event.detail,
                    "created_at": event.created_at,
                }
                for event in events
            ],
        }
