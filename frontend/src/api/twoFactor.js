// src/api/twoFactor.js
//
// Two-factor sign-in (an authenticator app). Whether it applies at all is the
// admin's choice on the dashboard's Security page; the whole flow is
// explained in backend accounts/twofactor.py.
//
// Two answers carry secrets the server never sends again:
//   startTwoFactorSetup() -> { secret, otpauth_uri }      (shown as a QR code)
//   confirmTwoFactor()    -> { recovery_codes: [...] }   (shown once, to save)

import { request } from './client';

/** { state, mode, enabled, required, recovery_codes_left } */
export function getTwoFactorStatus() {
  return request('/auth/2fa/');
}

/** A new secret for the authenticator app. Refused (409) once it is turned on. */
export function startTwoFactorSetup() {
  return request('/auth/2fa/setup/', { method: 'POST' });
}

/** The first code from the app: turns it on. Answers ten recovery codes. */
export function confirmTwoFactor(code) {
  return request('/auth/2fa/confirm/', { method: 'POST', body: { code } });
}

/** The code from the app, or a recovery code: this session is verified. */
export function verifyTwoFactor(code) {
  return request('/auth/2fa/verify/', { method: 'POST', body: { code } });
}

/** Ten new recovery codes (the old ones stop working). Needs a fresh app code. */
export function newRecoveryCodes(code) {
  return request('/auth/2fa/recovery-codes/', { method: 'POST', body: { code } });
}

/** Turn it off (only when it is not required for this account). Needs both. */
export function disableTwoFactor({ password, code }) {
  return request('/auth/2fa/disable/', { method: 'POST', body: { password, code } });
}

// ---- the admin's Security page (dashboard) --------------------------------

/** The policy, who it affects, and the latest audit events. Admins only. */
export function getTwoFactorPolicy() {
  return request('/staff/security/two-factor/');
}

/** Change the mode; the admin's own password is asked again. Admins only. */
export function setTwoFactorPolicy({ mode, password }) {
  return request('/staff/security/two-factor/', { method: 'PUT', body: { mode, password } });
}
