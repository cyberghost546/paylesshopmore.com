# Deploying PayLesShopMore

Two things are deployed, and they are independent of each other:

- **The API.** Django, run under gunicorn. It owns the database, the invoice
  PDFs and the customer uploads.
- **The site.** The React build in `frontend/dist`, which is static files and
  can be served by anything.

They must end up on the same origin, with `/api` reaching Django and
everything else reaching the static files. That is what makes the session
cookie first-party, and it is the reason `connect-src 'self'` in the content
security policy is enough. It is also no longer optional: Safari blocks
third-party cookies and Firefox partitions them, so a session cookie on a
different origin from the site is discarded before it is ever sent back.

**Deploying the site to Vercel?** See `VERCEL_DEPLOYMENT.md`, which is this
document with the static half on Vercel and a rewrite in front of Django.

## Before the first deploy

Set the environment variables. `backend/.env.example` lists every one of them
with what it does; these are the ones without which the site does not work:

| Variable | Why |
| --- | --- |
| `DJANGO_SECRET_KEY` | Signs sessions and password-reset tokens. Django refuses to start without it when `DJANGO_DEBUG` is off. |
| `DJANGO_ALLOWED_HOSTS` | The hostnames Django will answer for. |
| `DJANGO_CORS_ORIGINS`, `DJANGO_CSRF_ORIGINS` | The origin the React app is served from. |
| `DATABASE_URL` | The whole connection in one string, which is what a hosted PostgreSQL hands you. The separate `POSTGRES_*` variables still work. Without either, and with `DJANGO_DEBUG` off, Django refuses to start rather than quietly falling back to SQLite. |
| `AWS_STORAGE_BUCKET_NAME` | Where invoice PDFs, quote attachments, customer documents and warehouse damage photos are kept. Without it they go to the local disk, which is only safe on a host with a persistent volume and exactly one web process. The bucket must be private: the files are streamed by views that check who is asking. |
| `EMAIL_*`, `DJANGO_FROM_EMAIL` | Password-reset mail, account invitations and warehouse sign-in codes. Unset means none of them arrive. Warehouse sign-in codes are then shown on the Workers page for the admin to pass on in person (see `WAREHOUSE_CODE_ON_SCREEN` below). |
| `DJANGO_FRONTEND_URL` | The absolute URL used to build that reset link. |
| `CELERY_BROKER_URL` | Where invoice rendering is queued. Unset means it happens inside the approval request. |
| `REDIS_URL` | The shared cache, which holds rate limits and sign-in lockouts. Unset, a deployed site keeps the cache in Postgres instead (the `django_cache` table, made on start) - correct, just slower than Redis. |
| `SENTRY_DSN` | Optional, and the difference between knowing an invoice failed to render and not. |
| `DJANGO_ORIGIN_SECRET`, `DJANGO_ORIGIN_SECRET_ENFORCE` | Makes the backend answer only requests that came through the website. Set `ORIGIN_SHARED_SECRET` on Vercel first, then the same value as `DJANGO_ORIGIN_SECRET` on Railway, check the log for "arrived without the right X-Origin-Auth header", and only then set `DJANGO_ORIGIN_SECRET_ENFORCE=1`. In the wrong order the site stops working. See `backend/config/origin_guard.py`. |
| `DJANGO_TWO_FACTOR_MINIMUM_MODE` | Set to `required_admins`, so two-factor for administrators cannot be switched off from the Security page. |
| `SEVENTEEN_TRACK_API_KEY` | Courier tracking: follows the webshop's courier (PostNL, DHL, ...) automatically. Unset, customers can still enter a courier and number, and staff update the status by hand. Also set up the webhook and the scheduled job - see [docs/TRACKING.md](docs/TRACKING.md). |

### Warehouse sign-in codes

An admin can e-mail a warehouse worker a four-digit code to sign in with
(Workers page). It needs working e-mail (the `EMAIL_*` row above) and run
`python manage.py migrate` for the table that records them. Nothing else is
required, and there is nothing to set to turn it on or off.

| Variable | Default | What it does |
| --- | --- | --- |
| `WAREHOUSE_CODE_MINUTES` | `15` | How long a code works. Keep it short: four digits is only as safe as the time anybody has to guess it in. |
| `WAREHOUSE_CODE_ON_SCREEN` | `auto` | Whether a new code is shown to the admin who sent it instead of being e-mailed. `auto` shows it only while the site cannot send real mail (no `EMAIL_HOST`, or the console/dummy mail backend), and goes back to e-mail by itself once `EMAIL_HOST` is set. `1` always shows it, `0` never does. While a code is shown, the admin can see it and so could sign in as that worker. Each such code is marked `shown_on_screen` in the Django admin. |
| `WAREHOUSE_SESSION_IDLE_MINUTES` | `30` | How long a worker who signed in with a code can sit idle before being signed out. The floor shares devices, so this stops a forgotten log-out leaving the next person working as somebody else. It slides, so nobody who is working is interrupted. Values under 1 count as 1 (Django reads 0 as "until the browser closes"). Other accounts keep the normal two-week session. |

On a shared floor device, the handover works like this:

- Customers never see the warehouse code. The public login page shows only
  the password form. The code form opens from the link in the e-mail an admin
  sends, on a registered floor device, or on a device that already signs in
  with codes. A warehouse worker who signs in with a password lands on the
  normal profile page. A password alone does not open the warehouse:
  *Go to the warehouse* asks for their e-mail address and PIN first. That
  check is enforced on the server (`IsWarehouseOrStaff`), counts toward the
  PIN's five-try lockout, and starts the same 30-minute idle session as any
  floor sign-in. It works on any device, because the password has already
  been given. A PIN on its own still only works on a registered device.
  A worker with no PIN yet, or a locked one, gets a different form in the same
  place: the sign-in code an admin gives them, plus a new PIN twice. That
  sets the PIN and opens the warehouse in one step. The code must be the
  worker's own, and a PIN that is too easy is refused without spending the
  code.

- A worker who is finished taps **Log out** in the warehouse top bar. Only
  floor accounts (warehouse role, not office) have it. It leads straight to
  the code form, not the public home page.
- The login page remembers, on that device, that it signs in with codes. It
  stores the method only, never an e-mail address, and the e-mail field has
  browser autofill off in code mode. The fourth digit signs in without a
  button press, and Enter in the e-mail field moves to the code.
- "Idle" means nobody has done anything. Requests the app makes on a timer,
  such as the warehouse home page refreshing its board every minute, carry an
  `X-Background-Refresh: 1` header and do not count
  (`accounts.middleware.WarehouseIdleMiddleware`). Without that, a device left
  on the home page would never time out. If the frontend is served from a
  different origin than the API, that header must pass CORS. It is in
  `CORS_ALLOW_HEADERS` in `config/settings.py`, so keep it there if that
  setting is ever changed.
- When the idle time runs out, the device goes back to the code form on its
  own. The browser counts the same idle time down, then checks with the
  server using a background request, which does not extend the session.

Two rate limits go with it, set in `config/settings.py` (`DEFAULT_THROTTLE_RATES`):
`code_login` (240 an hour per IP address, deliberately loose because a whole
warehouse shares one) and `warehouse_code_send` (60 an hour per admin). They
are counted in the shared cache (Redis, or Postgres without `REDIS_URL`).
That does not weaken the protection that matters: a code is
dead after five attempts, and that count lives in the database.

### Floor devices and PINs

On a device an admin has registered, the login page shows **Who is
working?**: the warehouse workers by first name and last initial. A worker
taps their name and types a four-digit PIN. Run `python manage.py migrate`
for the tables. There are no settings to change.

- **Register a device** (admin): open *Dashboard → Floor devices* on the
  phone or scanner itself, give it a name, press *Register this device*, then
  sign out. The device is recognised by a long random token in an HttpOnly
  cookie (`plsm_floor_device`, about 400 days, renewed on each PIN sign-in).
  Only its SHA-256 digest is stored. Clearing that browser's data unregisters
  the device; register it again.
- **Revoke a device** on the same page. It stops working at once.
- **Setting a PIN.** An admin e-mails the worker a sign-in code (Workers
  page). The worker signs in with it and is asked to choose a PIN. A forgotten
  or locked PIN is replaced the same way. A PIN can only be set straight after
  an e-mailed code, never from a PIN session. Easy PINs (`0000`, `1234`,
  `1212`, `1122` and the like) are refused.
- **Lockout.** Five wrong PINs in a row lock that worker's PIN until they set
  a new one after an e-mailed code, or an admin resets it (*Reset PIN* on the
  Workers page). A device with ten wrong PINs in 15 minutes, for anybody, is
  refused for the rest of that window.
- **Audit trail.** *Floor devices* lists the latest 200 events: PIN and code
  sign-ins with their device, wrong PINs, locks, PINs set and reset. The
  Django admin has all of them.
- The PIN endpoints and the worker list refuse any request without a
  registered device. They are rate-limited per device (`floor_roster`
  600/hour, `pin_login` 300/hour) rather than per IP address, because a whole
  warehouse shares one address.
- If the API is on a different site than the frontend
  (`DJANGO_CROSS_SITE_COOKIES=1`), the device cookie uses the same `SameSite`
  setting as the session cookie, and has the same Safari caveat.

**Residual risk:** a PIN that does not change can be watched as it is typed.
On a busy shared device, a colleague who sees a PIN can sign in as that
worker on any registered device, and their scans will be recorded under that
worker's name. Guessing is a small risk: five tries out of 10,000 is about 1
in 2,000 per lock. Reset a PIN that may have been seen.

Never set `DJANGO_DEBUG` in production. It is off unless something turns it
on, and turning it on serves the source of any page that raises.

## The API

```sh
cd backend
pip install -r requirements-prod.txt      # plus gunicorn, psycopg, redis, sentry, django-storages
python manage.py migrate
python manage.py collectstatic --noinput  # the admin's own CSS, served by WhiteNoise
gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3
```

Run the Celery worker beside it, as its own process:

```sh
celery -A config worker --loglevel=info
```

Without a worker and with `CELERY_BROKER_URL` set, an approved invoice is
queued and never rendered. Without `CELERY_BROKER_URL` at all, tasks run
inline instead, which works and makes the reviewer wait for the PDF.

Check the deployment's own configuration before trusting it:

```sh
python manage.py check --deploy
```

## The site

```sh
cd frontend
npm ci
npm run build
```

`dist` is what gets served. The build writes a directory with an `index.html`
in it for each public route, so `/destinations/curacao` is a real file with its
own title, description and link preview. Serve those files directly and fall
back to `dist/index.html` for anything unmatched, which is what a static host
does by default.

`dist/sitemap.xml` is generated from `frontend/scripts/routes.js`. Adding a
public page means adding it there, not editing the XML.

The photographs are generated separately and committed:

```sh
npm run images     # only after changing a source photograph in src/images
```

## Health checks

| Path | Question | Use it for |
| --- | --- | --- |
| `/api/health/` | Is the process alive? | The orchestrator's liveness probe. Touches nothing, so a database outage cannot make it restart healthy web processes. |
| `/api/ready/` | Can it serve a request? | The load balancer. Checks the database and the cache, and answers `503` when either is unreachable. |

Both are public and deliberately say nothing about the deployment.

## Watching it run

Everything is logged to stdout as one line per event, which is what a
container platform collects. `DJANGO_LOG_LEVEL` sets the volume. `django.request`
logs every 4xx and 5xx with its traceback.

With `SENTRY_DSN` set, unhandled exceptions are reported. Personally
identifying data is deliberately not sent: an invoice error does not need the
customer's address to be actionable.

## What runs on every push

`.github/workflows/ci.yml` runs three independent jobs. It does not deploy
anything.

**Django** — `ruff check` (configured in `backend/ruff.toml`), the system
checks, the deployment checks, a check for models changed without a migration,
then the test suite.

**React** — eslint, a check that the committed image output still matches its
sources, the tests with coverage, then the build.

**Origins** — `scripts/check-origins.mjs`, which compares the canonical origin
in the route table against its copies in `usePageMeta.js`, the social card tags
in `index.html`, the `/api` rewrite in `vercel.json` and `DJANGO_FRONTEND_URL`
in `render.yaml`. These five files have to agree and nothing else makes them
move together; when they disagree the build is green and a form POST comes back
as a CSRF failure days later.

## What runs on a schedule

`.github/workflows/smoke.yml` asks the deployed site the questions a browser
would: the API answered through the site's own origin rather than the API
host's, a prerendered page with real metadata in it, a deep link opened cold, the
security headers `vercel.json` promises, and a `robots.txt` that does not
disallow the world. Every request is a GET, so it is safe to point at
production — which is the point, since a check that only runs against staging
tells you nothing about the site customers are using.

It runs twice a day and from the Actions tab, where it takes an origin as an
input. Run it by hand after a deploy: neither Vercel nor Railway reports back
to GitHub, so nothing else triggers it at the moment that matters.

## Before you push

```sh
git config core.hooksPath .githooks
```

Once per clone. `.githooks/pre-push` then runs the parts of CI that apply to
what you are pushing — the Django suite only if `backend/` changed, eslint and
vitest only if `frontend/` did — so the answer arrives before the push rather
than a minute after it. `git push --no-verify` skips it.

## Keeping dependencies current

Every version in this repository is pinned exactly, which is what makes a build
reproducible and also what makes it go stale in silence.
`.github/dependabot.yml` opens grouped pull requests on Monday mornings for
pip, npm and the GitHub Actions themselves, with Django and React majors held
back — those want reading the release notes, not a merge button.
