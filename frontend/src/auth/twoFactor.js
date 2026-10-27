// src/auth/twoFactor.js
//
// Whether a signed-in user still has to type the code from their
// authenticator app - or set it up first, when the admin requires it
// (backend accounts/twofactor.py).
// The guards use it to send them to /two-factor first. Presentation only: the
// server refuses the session's requests until the code is in, whatever the
// browser shows.

export const TWO_FACTOR_PATH = '/two-factor';

export function needsTwoFactor(user) {
  return user?.twoFactor === 'code_required' || user?.twoFactor === 'setup_required';
}
