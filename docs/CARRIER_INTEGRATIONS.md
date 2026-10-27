# Carrier integrations

How PayLessShopMore gets tracking updates from PostNL, DHL, DPD, Amazon and
FedEx, what is built, and what is still needed for each carrier. This file
covers the carrier-ready parts. [TRACKING.md](TRACKING.md) covers the
tracking basics: 17TRACK, the webhook and the scheduled job.

## Status at a glance

| Source | Code | Built? | Live? |
|---|---|---|---|
| 17TRACK (every courier) | `adapters/seventeen_track.py` | Yes | Once `SEVENTEEN_TRACK_API_KEY` is set on the api component |
| DHL (Shipment Tracking – Unified) | `adapters/dhl.py` | Yes, from DHL's documentation | **No.** Not tested with a real key yet |
| PostNL | `adapters/postnl.py` | Prepared only | No |
| DPD Netherlands | `adapters/dpd.py` | Prepared only | No |
| Amazon Shipping | `adapters/amazon.py` | Prepared only | No |
| FedEx | `adapters/fedex.py` | Prepared only | No |
| Mock provider (test data) | `adapters/mock.py` | Yes | Never. Development only |

No carrier is "connected" until **Test connection** has succeeded with
authorized credentials. (The dashboard page for this, "Tracking integrations",
was removed on 2026-10-23; the API behind it, `/api/staff/tracking-integrations/`,
still exists.) The page shows the
real state: it does not call a carrier connected because a key is present.

## How it fits together

```
Customer / staff enter a number
        │
        ▼
CarrierShipment (stage: incoming | outgoing)
        │  sync.start_tracking → adapters.choose_adapter(shipment)
        ▼
  1. mock provider   (number starts with MOCK, and TRACKING_MOCK_PROVIDER on)
  2. carrier's own API (built + keys set + tested + enabled by an admin)
  3. 17TRACK         (SEVENTEEN_TRACK_API_KEY set)
  4. nobody          (staff add updates by hand)
        │
        ▼
TrackingEvent rows (source: carrier_api | webhook | mock | staff | system)
        │
        ▼
Customer: Profile → Track & Trace, booking orders, pre-alerts
Staff:    Dashboard → Courier tracking
```

### Two stages

- **Incoming**: from the webshop to our warehouse in the Netherlands. The
  shipment hangs off a booking order (`order`) or a pre-alert (`prealert`).
  An order can have several incoming shipments when it arrives in more than
  one parcel.
- **Outgoing**: from our warehouse to Aruba, Bonaire or Curaçao, when one of
  our shipments (`onward_package`) travels with an outside courier.

A database constraint makes sure every shipment has exactly one parent and
the stage that matches it.

### What the customer sees

- Incoming shipments are shown on each order, and the Track & Trace box shows
  all of them. Outgoing shipments are shown under the shipment ("How your
  shipment reaches you").
- For each shipment: the carrier, the tracking number with a **Copy** button,
  the timeline, the history and the courier's own tracking link.
- Each line in the history shows where it came from. **Courier** means
  carrier data. **Our team** means a line added by staff or our system, for
  example the warehouse receiving the parcel. **Test data** means a line made
  up by the mock provider.
- The customer can only change the number they entered themselves. Numbers
  that staff registered, corrections and warehouse confirmations are
  read-only for them.

### What staff can do (Dashboard → Courier tracking)

- **Register a number.** Office staff only. Find the customer by name,
  e-mail or PLSM-C number. Pick the order, the pre-alert or (for outgoing)
  our shipment. Then pick the courier and enter the number. The server checks
  that everything belongs to that customer.
- **Add an update.** A line typed by staff, always marked "Our team".
  "Delivered" asks how the delivery was confirmed.
- **Correct a line.** The line is hidden from the customer and kept on
  record, with the reason.
- **Correct the number.** Office staff only, and a reason is required. Three
  things happen:
  - a `TrackingNumberChange` row records the old and new number and courier,
    who made the change and why;
  - courier lines for the old number are hidden, but not deleted;
  - tracking starts again for the new number.
- **Filter.** By stage, by status, or only shipments with a problem.

### Integration settings (admins only; the dashboard page was removed on 2026-10-23, see above)

Each source has one card with:

- **Status:** Not configured, Awaiting credentials, Configured but untested,
  Connected and verified, Connection failed, Disabled, or "Prepared – not
  built yet".
- **Settings:** the names of the environment variables it needs, and whether
  each one is **set**. The values are never shown.
- **Environment:** sandbox or production. Changing it switches the
  integration off until it is tested again.
- **History:** last test, last sync and last error.
- **Buttons:** Test connection, then Switch on or Switch off. The server
  refuses to switch an integration on before a successful test.

## Credentials and security

- Credentials are **environment variables on the server only** (DigitalOcean, the api component).
  They are never stored in the database or in frontend code, never sent to
  the browser, and never written to logs or error messages. Error messages
  say which setting is missing, never its value.
- The `CarrierIntegration` table only holds safe data: enabled, environment,
  test results, last sync and last error.
- All staff endpoints check permissions on the server:
  - `/api/staff/carrier-tracking/`: office staff, plus the warehouse manager
    for reading and adding lines.
  - `/api/staff/tracking-integrations/`: admins only.
  - `config/test_access_matrix.py` tries every route as every other role.
- Customers only ever see their own shipments (`owner` filter), and an
  unknown number gives the same 404 as somebody else's.

## The mock provider (development and testing)

You can try the whole customer and warehouse flow without any courier account:

1. Locally, set `DJANGO_DEBUG=1` and `TRACKING_MOCK_PROVIDER=1`. The setting
   is **ignored unless DEBUG is on**, so it can never be active on the live
   site.
2. Use a tracking number that starts with `MOCK`. A word in the number picks
   the scenario:

   | Number | Scenario |
   |---|---|
   | `MOCK-REG-1` | Registered with the carrier |
   | `MOCK-TRANSIT-1` | In transit to the warehouse |
   | `MOCK-WAREHOUSE-1` | Delivered at the warehouse address |
   | `MOCK-DISPATCH-1` | Outgoing: dispatched to the island |
   | `MOCK-DELIVERED-1` | Delivered at the destination |
   | `MOCK-DELAYED-1` | Delayed |
   | `MOCK-UNKNOWN-1` | "Carrier does not know this number" |
   | `MOCK-DOWN-1` | "Carrier API unavailable" (retried later) |

3. Run `python manage.py sync_carrier_tracking`, or use "Check now" on the
   dashboard.

The mock provider labels its data as test data at every level, so it can
never pass for real carrier data:

- Each event's description starts with "TEST DATA".
- Events are stored with `source = mock` and count as not verified.
- The customer sees a "Test data" note on the card and a "Test data" label
  on every line.

Real numbers (anything not starting with MOCK) never get mock data, even with
the setting on. A MOCK number is never sent to a real API.

## Per carrier

### 17TRACK (recommended first step)

- **What it does:** tracks every courier we list, including parcels someone
  else sent, which is exactly the incoming case. Updates arrive by webhook,
  and the scheduled job is a safety net.
- **Account:** an API account at https://api.17track.net, paid per registered
  number.
- **Credentials:** `SEVENTEEN_TRACK_API_KEY`. Optional: `SEVENTEEN_TRACK_API_URL`.
- **Docs:** https://api.17track.net/en/doc
- **Remaining steps:**
  1. Set the key on the api component.
  2. Set the webhook URL in 17TRACK to
     `https://<backend>/api/tracking/webhooks/17track/`.
  3. Switch on the `carrier-tracking` job in `.do/app.yaml`.
  4. Run Test connection on the integrations page.

### DHL: Shipment Tracking – Unified (built, not yet verified)

- **What it does:** tracks any DHL number (Parcel NL, eCommerce, Express) for
  anyone who has the number, recipients included. This suits incoming
  parcels.
- **Account:** a free account at https://developer.dhl.com. Create an app,
  add "Shipment Tracking – Unified" to it, and wait for DHL to approve it.
- **Credentials:** `DHL_API_KEY` (the app's Consumer Key).
- **Limits:** a new app gets 250 calls per day and at most 1 call every
  5 seconds. Ask for more with "Request Upgrade" on the app page before using
  it for every DHL parcel.
- **Docs:** https://developer.dhl.com/api-reference/shipment-tracking
- **Built:** `GET https://api-eu.dhl.com/track/shipments?trackingNumber=…`
  with the `DHL-API-Key` header. It reads the status, events, estimated
  delivery and location, and maps `pre-transit`, `transit`, `delivered` and
  `failure`. Unknown codes stay unknown. A time without a time zone is not
  guessed.
- **Remaining steps:**
  1. Get the key.
  2. Set `DHL_API_KEY` on the api component.
  3. Run Test connection.
  4. Check a few real DHL numbers against DHL's own tracking page.
  5. Switch it on.
  6. Request a higher rate limit.

### PostNL (prepared)

- **Restriction:** PostNL's Shipping Status API only answers for parcels sent
  under **your own** PostNL contract (customer number and code). It does
  **not** track parcels a webshop sent to us. For incoming parcels, use
  17TRACK.
- **Useful when:** we ship outgoing parcels with our own PostNL contract.
- **Account:** a PostNL business contract, with API access requested at
  https://developer.postnl.nl
- **Credentials:** `POSTNL_API_KEY`, `POSTNL_CUSTOMER_NUMBER`,
  `POSTNL_CUSTOMER_CODE`.
- **Remaining steps:**
  1. Get the contract and the API key.
  2. Write `fetch` and `test_connection` in `adapters/postnl.py` from the
     Shipping Status documentation.
  3. Set `implemented = True`.
  4. Add tests with documented sample answers.
  5. Test the connection, then switch it on.

### DPD Netherlands (prepared)

- **Restriction:** DPD's web services are for **business customers**. Their
  tracking only covers parcels where you are the sender or a known recipient
  customer, not any parcel a webshop sent.
- **Account:** a DPD business account. Ask DPD for web service (DELIS)
  credentials.
- **Credentials:** `DPD_DELIS_ID`, `DPD_PASSWORD`, `DPD_API_URL`.
- **Remaining steps:**
  1. Get the credentials and DPD's documentation for your account.
  2. Write the calls in `adapters/dpd.py`.
  3. Add tests, test the connection, then switch it on.

### Amazon Shipping (prepared)

- **Restriction:** the Amazon Shipping API tracks shipments **booked through
  Amazon Shipping by the account holder**. It does not track ordinary
  amazon.nl or amazon.de orders that a customer bought. 17TRACK covers those
  (Amazon Logistics numbers).
- **Account:** an Amazon Shipping account, plus a Selling Partner API
  application.
- **Credentials:** `AMAZON_SHIPPING_CLIENT_ID`,
  `AMAZON_SHIPPING_CLIENT_SECRET`, `AMAZON_SHIPPING_REFRESH_TOKEN`.
- **Remaining steps:** only worth doing if we book shipments with Amazon
  Shipping ourselves. If so:
  1. Write the token exchange and tracking call in `adapters/amazon.py`.
  2. Add tests, test the connection, then switch it on.

### FedEx (prepared)

- **What it can do:** the FedEx Track API tracks FedEx numbers for the
  account's projects.
- **Account:** a FedEx Developer account at https://developer.fedex.com, with
  a project that has the Track API added.
- **Credentials:** `FEDEX_API_KEY`, `FEDEX_SECRET_KEY` (exchanged for an
  OAuth token).
- **Remaining steps:**
  1. Create the project.
  2. Write the OAuth and track calls in `adapters/fedex.py`, starting in the
     sandbox.
  3. Add tests, test the connection, switch it on, then repeat with
     production keys.

## Adding or finishing a carrier

1. Open `backend/tracking/adapters/<carrier>.py`. The class already has the
   environment variable names, the docs link and the carrier codes.
2. Implement these from the **official** documentation only, never an
   undocumented endpoint:
   - `fetch(items)`: return `ProviderResult` with `TrackResult` objects, and
     statuses mapped to `TrackingStatus` through `normalize_status`;
   - `test_connection()`: one harmless real request; returns `(ok, message)`.
   - Use `self.get_json(...)`. It turns 401/403 into `CredentialsError` and
     429/5xx into a temporary error, which is retried with back-off.
3. Set `implemented = True`.
4. Add tests with sample answers taken from the documentation. See
   `DhlAdapterTests` in `tracking/test_carrier_ready.py`.
5. Deploy, then set the keys on the api component.
6. On the integrations page: Test connection, then Switch on.
7. Check a few real numbers before relying on it.

## Webhooks and polling

- **Polling:** `python manage.py sync_carrier_tracking` asks each adapter
  about the shipments that are due. It batches by adapter, backs off after
  errors, and stops polling finished or two-month-old shipments. It does
  nothing while no source is active. Run it as the `carrier-tracking`
  scheduled job in `.do/app.yaml`.
- **Webhooks:** 17TRACK's webhook is built and checks its signature (see
  TRACKING.md). For a carrier with its own webhooks, add a view next to
  `SeventeenTrackWebhookView` that checks the carrier's signature and passes
  the data to `sync.apply_result(..., TrackingEvent.Source.WEBHOOK)`. Do not
  register a webhook URL with a carrier until that view exists and has been
  tested.

## Environment variables

All of these are listed in `backend/.env.example`. All are optional; without
any of them, staff update shipments by hand.

```
SEVENTEEN_TRACK_API_KEY=
TRACKING_POLL_HOURS=6
TRACKING_MOCK_PROVIDER=1        # development only, needs DJANGO_DEBUG=1
DHL_API_KEY=
POSTNL_API_KEY=
POSTNL_CUSTOMER_NUMBER=
POSTNL_CUSTOMER_CODE=
DPD_DELIS_ID=
DPD_PASSWORD=
DPD_API_URL=
AMAZON_SHIPPING_CLIENT_ID=
AMAZON_SHIPPING_CLIENT_SECRET=
AMAZON_SHIPPING_REFRESH_TOKEN=
FEDEX_API_KEY=
FEDEX_SECRET_KEY=
```

## Deployment

1. Deploy as usual. `entrypoint.sh` runs migrations, and migration `0007`
   only adds tables and columns. Existing shipments become stage
   "incoming" and nothing is deleted.
2. Set the keys you have on the api component (start with `SEVENTEEN_TRACK_API_KEY`).
3. Run Test connection and switch on what passed, through
   `/api/staff/tracking-integrations/` (the dashboard page was removed).
4. Make sure the cron service is running `sync_carrier_tracking`.
