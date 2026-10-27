# Two-factor sign-in (2FA): how it works

Two-factor sign-in means: after the password, the site asks for a 6-digit
code from an authenticator app on the phone (Google Authenticator, Microsoft
Authenticator, ...). A stolen password alone is then not enough to get in.

**The admin decides when it applies**, on the dashboard page **Security**
(`/dashboard/security`). It starts as **Disabled**, so nothing changes until
an admin switches it on.

---

## 1. The four modes

| Mode | What happens |
|---|---|
| **Disabled** (default) | Nobody is asked. Signing in works exactly as before. |
| **Optional** | People may turn it on from their profile (`/profile#two-factor`). Only they are asked for a code. |
| **Required for administrators** | Every admin (role "admin", and superusers) must use it. Everybody else: optional. |
| **Required for everyone** | Everybody who signs in with a password must use it. Warehouse sign-ins with an e-mailed code or a PIN on a floor device are not asked: they already prove something the worker has. |

Changing the mode needs the admin's password again, shows a confirmation with
who is affected, and is written to the history on the same page.

**Lockout protection:** an admin cannot make 2FA required before setting it up
on their own account. People who are affected but have not set it up are not
locked out: right after their password, at their next sign-in, they are
guided through the setup.

## 2. How a sign-in goes when a code is needed

1. Password, as always (`POST /api/auth/login/`). The answer says
   `two_factor: "code_required"` or `"setup_required"`.
2. The session is now signed in **but not verified**.
   `TwoFactorMiddleware` refuses almost everything (403,
   `code: "two_factor_required"`) - the dashboard API and Django's `/admin/`
   alike. The browser goes to `/two-factor`.
3. The code from the app (or a recovery code) -> `POST /api/auth/2fa/verify/`
   -> verified, everything works.
   First time: scan the QR code, type the first code
   (`/api/auth/2fa/setup/`, `/api/auth/2fa/confirm/`), save the ten recovery
   codes that are shown once.

## 3. Lost phone

In this order:
1. **A recovery code** instead of the app code. Each works once.
2. **Another admin** presses **Reset 2FA** on the Workers page. The person is
   signed out everywhere and sets the app up again at the next sign-in.
3. **The last admin** (no recovery codes, no other admin): on the server
   (DigitalOcean -> the api component -> Console):
   `python manage.py reset_two_factor their@email.com`

There is no public bypass, master password or unauthenticated recovery route.

## 4. Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `DJANGO_TWO_FACTOR_ENCRYPTION_KEYS` | derived from `DJANGO_SECRET_KEY` | Encrypts the authenticator secrets in the database. **Set it in production and never lose it.** Make one: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `DJANGO_TWO_FACTOR_MINIMUM_MODE` | (none) | The least strict mode allowed, e.g. `required_admins` in production. The Security page cannot go below it. |
| `DJANGO_TWO_FACTOR_FORCE_DISABLED` | `false` | **Development only.** Switches 2FA off on your own computer. Ignored when `DJANGO_DEBUG` is off, with a warning in the deploy log - it can never weaken the live site. |

Replacing the encryption key without breaking anything:
1. `DJANGO_TWO_FACTOR_ENCRYPTION_KEYS=NEW_KEY,OLD_KEY` (new one first)
2. `python manage.py rotate_two_factor_key`
3. `DJANGO_TWO_FACTOR_ENCRYPTION_KEYS=NEW_KEY`

## 5. What is stored, and how

| Table | Holds | Protection |
|---|---|---|
| `TwoFactorPolicy` | the mode (one row) | changed only through the admin page, audited |
| `TwoFactorDevice` | the authenticator secret, per person | encrypted (Fernet, `accounts/twofactor_crypto.py`) |
| `TwoFactorRecoveryCode` | ten one-time codes | slow salted hashes (Django's `make_password`), shown once |
| `TwoFactorAuditEvent` | who changed what, when | never a code, secret or password |

Migration: `accounts/migrations/0029_two_factor.py` (runs by itself on deploy).

## 6. Where the code is

| Part | File |
|---|---|
| Everything about the rules and the codes | `backend/accounts/twofactor.py` (read its top comment first) |
| Encryption of the secrets | `backend/accounts/twofactor_crypto.py` |
| A person's own routes (`/api/auth/2fa/...`) | `backend/accounts/twofactor_views.py` |
| Enforcement | `backend/accounts/middleware.py` -> `TwoFactorMiddleware` |
| The admin's page (`/api/staff/security/two-factor/`) | `backend/staff/security.py` |
| Admin reset of a colleague | `backend/staff/views.py` -> `CustomerViewSet.reset_two_factor` |
| Lost-phone and key commands | `backend/accounts/management/commands/` |
| Tests | `backend/accounts/test_twofactor.py`, `frontend/src/pages/**/` `*.test.jsx` |
| The code screen and setup | `frontend/src/pages/TwoFactor/TwoFactorPage.jsx` |
| The Security page | `frontend/src/pages/Dashboard/Security.jsx` |
| The profile card | `frontend/src/pages/Profile/TwoFactorCard.jsx` |
