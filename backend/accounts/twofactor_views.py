"""A person's own two-factor routes, under /api/auth/2fa/.

How it all fits together: accounts/twofactor.py. In short:

    GET  /api/auth/2fa/                  where this account and session stand
    POST /api/auth/2fa/setup/            start: a new secret + the QR text
    POST /api/auth/2fa/confirm/          {code} -> turned on; answers 10 recovery codes ONCE
    POST /api/auth/2fa/verify/           {code} -> this session is verified
    POST /api/auth/2fa/recovery-codes/   {code} -> 10 new recovery codes (old ones stop)
    POST /api/auth/2fa/disable/          {password, code} -> turned off (only when not required)

Every route needs a signed-in account and answers 404 while the admin has
two-factor "disabled". TwoFactorMiddleware lets these routes through before a
session is verified - otherwise nobody could ever finish signing in.
"""

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import twofactor
from .models import TwoFactorAuditEvent

WRONG = "That code is not right. Check the time on your phone and try the newest code."
LOCKED = "Too many wrong codes. Wait 15 minutes and try again."


class TwoFactorView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "two_factor"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Off for everybody while the admin's mode is "disabled" - except an
        # admin, who must be able to set up their own app BEFORE switching it
        # on: the Security page refuses a required mode to an admin without
        # one (twofactor.change_policy), so without this exception that page
        # sends them to set it up and this refuses it - a dead end. While the
        # mode is disabled, a device set up here is never asked for
        # (twofactor.state answers "off").
        if not twofactor.available() and not twofactor.is_admin_account(request.user):
            self.permission_denied(request, message="Two-factor sign-in is turned off on this site.")

    @staticmethod
    def code_of(request):
        return str(request.data.get("code") or "")

    @staticmethod
    def refused(result):
        """The answer for a code that was not accepted."""
        if result == "locked":
            return Response({"detail": LOCKED}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        return Response({"detail": WRONG, "code": "wrong_code"}, status=status.HTTP_400_BAD_REQUEST)


class StatusView(TwoFactorView):
    def get(self, request):
        user = request.user
        return Response(
            {
                "state": twofactor.state(request),
                "mode": twofactor.effective_mode(),
                "enabled": twofactor.confirmed_device(user) is not None,
                "required": twofactor.is_required_for(user),
                "recovery_codes_left": twofactor.recovery_codes_left(user),
            }
        )


class SetupView(TwoFactorView):
    def post(self, request):
        started = twofactor.start_setup(request.user)
        if started is None:
            return Response(
                {"detail": "Two-factor is already turned on. Lost your phone? Use a recovery code, "
                           "or ask an admin to reset it."},
                status=status.HTTP_409_CONFLICT,
            )
        _device, secret = started
        # The only answer that ever contains the secret: the QR code is made
        # from it in the browser, then it is gone.
        return Response({"secret": secret, "otpauth_uri": twofactor.otpauth_uri(request.user, secret)})


class ConfirmView(TwoFactorView):
    def post(self, request):
        result = twofactor.confirm_setup(request.user, self.code_of(request), request)
        if result == "no_setup":
            return Response({"detail": "Start the setup first."}, status=status.HTTP_400_BAD_REQUEST)
        if result != "ok":
            return self.refused(result)
        twofactor.mark_verified(request)
        codes = twofactor.new_recovery_codes(request.user, request=request)
        return Response({"state": "verified", "recovery_codes": codes})


class VerifyView(TwoFactorView):
    def post(self, request):
        result = twofactor.verify(request.user, self.code_of(request), request)
        if result != "ok":
            return self.refused(result)
        twofactor.mark_verified(request)
        return Response({"state": "verified", "recovery_codes_left": twofactor.recovery_codes_left(request.user)})


class RecoveryCodesView(TwoFactorView):
    def post(self, request):
        # A verified session AND a fresh code from the app: new recovery codes
        # are as good as the phone, so making them needs the phone.
        if not twofactor.is_verified(request):
            return Response({"detail": "Sign in with your code first."}, status=status.HTTP_403_FORBIDDEN)
        result = twofactor.verify(request.user, self.code_of(request), request)
        if result != "ok":
            return self.refused(result)
        return Response({"recovery_codes": twofactor.new_recovery_codes(request.user, request=request)})


class DisableView(TwoFactorView):
    def post(self, request):
        user = request.user
        if twofactor.is_required_for(user):
            return Response(
                {"detail": "Two-factor sign-in is required for your account, so it cannot be turned off."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if twofactor.confirmed_device(user) is None:
            return Response({"detail": "Two-factor is not turned on."}, status=status.HTTP_400_BAD_REQUEST)
        # Both factors: the password AND a code. A stolen session alone, or a
        # password alone, must not be enough to take the protection away.
        if not user.check_password(str(request.data.get("password") or "")):
            return Response({"detail": "Your password is not right.", "code": "wrong_password"},
                            status=status.HTTP_400_BAD_REQUEST)
        result = twofactor.verify(user, self.code_of(request), request)
        if result != "ok":
            return self.refused(result)
        twofactor.remove(user, TwoFactorAuditEvent.Kind.DISABLED, actor=user, request=request)
        return Response({"state": "off"})
