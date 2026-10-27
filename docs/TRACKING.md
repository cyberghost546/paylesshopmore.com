# Shipment tracking

A parcel's journey has two legs, and the site tracks both.

| Leg | From → to | Tracking number | Who updates it | Code |
| --- | --- | --- | --- | --- |
| 1. Courier | Webshop → our warehouse | The courier's number (PostNL `3SABC1234567`, DHL, Amazon, ...) | **The courier, automatically** (17TRACK). Staff can add lines by hand. | `backend/tracking/` |
| 2. Our shipping | Warehouse → island → customer | Ours: `PLSM-00001` | **Our staff and warehouse.** This was already here. | `backend/accounts/` (`Package`, `PackageEvent`) |

Leg 1 ends by itself: when the warehouse receives the booking's package, every
courier shipment on that booking gets the line "Received at our warehouse"
(`tracking/sync.py`, `mark_received_at_warehouse`).

## What works automatically, and what needs a person

| 
| Automatic | Manual 
|
| --- | --- | --- |

| Courier updates (in transit, out for delivery, delivered, problems) | Yes, with `SEVENTEEN_TRACK_API_KEY` set: by webhook within minutes, and the scheduled job as a backup | Without the key, staff add them on **Dashboard → Courier tracking** |
| Courier detection | 17TRACK detects it when the customer picks "Amazon" or "Other" | The customer picks the courier from the list; staff can change it |
| "Received at our warehouse" | Yes, when the warehouse receives the package | – |
| Our own statuses (packed, in transit to the island, delivered) | – | Staff and warehouse, as before |
| Customer notifications | Yes, for delivered / failed delivery / delay / returned / problem | – |

Nothing is ever made up. If the courier has no news, the parcel does not move.
Every line on the customer's page says where it came from: **Courier**
(verified, from the courier) or **Our team** (typed by staff or added by our
system).

## How the customer uses it

1. **Profile → My bookings → an order → + Add document → Track-and-trace.**
2. Choose the **Courier company** and paste the tracking number or the courier's link.
3. Under the order they now see the status, the last location, the expected
   delivery, when it was last updated and every update.
4. They can also type the courier's number in the **Track & Trace** box on
   their profile.

Only signed-in customers see tracking, and only for their own orders. A
tracking number is an identifier, not proof of who you are: someone else's
number answers exactly like a number that does not exist.

## How staff use it

**Dashboard → Courier tracking** (office and warehouse manager):

- Search by courier number, customer, e-mail, shop or our PLSM number;
  filter by status, or show only problems.
- Open a shipment to see exactly what the customer sees.
- **Add an update**: a line marked "Our team". *Delivered* asks how it was
  confirmed (proof of delivery, scan, signature).
- **Correct** (office only): hides a wrong line from the customer, keeping it
  on record with who corrected it, when and why. Nothing is deleted.
- **Courier**, **expected delivery** and **Check now** (office only).

The courier list itself (add a courier, change its 17TRACK code, switch one
off) is in Django's admin: **/admin/ → Courier tracking → Carriers**.

## The warehouse scanning a courier's barcode

A parcel arrives with the courier's label on it. That barcode is the number
the customer entered on their order, so scanning it identifies the parcel:

1. **Warehouse → Scan Package**, scan the courier barcode (camera, handheld
   scanner, or type it).
   
2. The scanner shows **whose parcel it is**: customer, shop and what was
   bought, the courier and number, and our booking or shipment number.

3. **Confirm arrival** 
   records "Received at our warehouse" on that one order,
   with the time and who scanned it. The customer sees it straight away.
   Scanning the same box again records nothing new and says when and by whom
   it was first recorded.
4. Carry on as before: start the intake sheet, or open the shipment.

Matching is exact on the whole number only. Part of a number, a name, or a
number entered on two different orders matches nothing: the box is then
handled by hand ("Nothing on file" → start a sheet), never guessed.

Each order's courier leg closes on its own scan. Receiving the whole shipment
on the floor still closes all of them at once, as before.

## Links to the courier's own page

Customers and staff get a **Follow at the courier ↗** link next to the
number. DHL, DPD, GLS, UPS, FedEx and USPS link to their own page; PostNL
(whose page also asks for the delivery postcode), Amazon and "Other" link to
17TRACK's page, which works for every courier. The links are set per courier
in **/admin/ → Courier tracking → Carriers** ("Tracking url template", with
`{number}` where the number goes) - check them once, and change one there if a
courier moves its page. The number is URL-encoded, so whatever was typed
cannot change where the link points.

## Why there is no Bol.com connection

Customers buy at Bol.com (or any shop) themselves and have it sent to our
warehouse. Bol.com's official Retailer API is for **sellers** on Bol.com: it
needs a seller account, and its "orders" are orders customers placed with that
seller. It has nothing for a shopper's own purchases or their tracking
numbers, so there is nothing official to connect to. The courier's number is
entered by the customer instead, and followed through 17TRACK.

## Manual fallback

When there is no API key, or a courier is not covered, or a number was
rejected:

1. The customer still enters the courier and number on their order.
2. Staff add updates on **Dashboard → Courier tracking** ("Add an update").
   They show to the customer as "Our team".
3. The warehouse scan and "Confirm arrival" work exactly the same.
4. A wrong line is corrected with **Correct**, never deleted.

## Statuses

Defined once in `backend/tracking/statuses.py` (with how 17TRACK's statuses map
onto them) and translated in `frontend/src/i18n/translations.js` under
`courier.status`:

Order registered · Awaiting package arrival · Received at warehouse ·
Processing at warehouse · Ready for shipment · Dispatched · In transit ·
Arrived at destination country · Customs clearance · Out for delivery ·
Delivered · Delivery attempt failed · Delayed · Returned to sender ·
Exception or problem.

To add one: add it to `TrackingStatus`, map it in the 17TRACK tables if a
courier can produce it, and add the wording in the three languages. Never
rename a value that is already stored.

## Setting it up

### 1. Get a 17TRACK key

1. Create an account at <https://api.17track.net>. Each registered number
   uses quota; check their pricing page for the current free allowance.
2. Copy the **security key** from the dashboard's settings.

### 2. Environment variables (Railway, the web service)

| Variable | Required | What it does |
| --- | --- | --- |
| `SEVENTEEN_TRACK_API_KEY` | For automatic updates | The security key. Server side only: it is never sent to the browser. |
| `SEVENTEEN_TRACK_API_URL` | No | Default `https://api.17track.net/track/v2.2`. |
| `TRACKING_POLL_HOURS` | No | Hours between scheduled checks of one shipment. Default 6. |

### 3. The webhook (updates within minutes)

In 17TRACK's dashboard → **Webhook**, set the URL to the **website's**
address, not Railway's:

```
https://<your site>/api/tracking/webhooks/17track/
```

Through the website, the request passes the origin check
(`config/origin_guard.py`). Every push is checked against its `sign` header
(SHA-256 of the body + "/" + your key); a push with a wrong signature is
refused with 401 and changes nothing.

### 4. The scheduled job (the safety net)

Create a Railway cron service like the warehouse report: **New → GitHub Repo
→ this repository**, Root Directory `backend`, Config-as-code path
`railway.tracking-cron.json`. It runs `python manage.py sync_carrier_tracking`
every two hours and only asks about shipments that are due. It needs the same
variables as the web service (`DATABASE_URL`, `DJANGO_SECRET_KEY`,
`SEVENTEEN_TRACK_API_KEY`, `EMAIL_*`).

### 5. Deploy

`python manage.py migrate` (run on every deploy by `entrypoint.sh`) creates
the four tables and the courier list. The migration only adds tables: nothing
existing changes.

## Keeping requests and costs down

- Numbers go to 17TRACK in batches of 40.
- A shipment is only checked when its `next_sync_at` is due.
- Delivered, returned or received shipments are never checked again, and
  nothing is checked more than 60 days after it was entered.
- After a failure the wait doubles (15 min, 30, 1 h ... up to a day). A wrong
  key stops the scheduled job with an error instead of retrying.
- "Check now" on the dashboard is limited to 60 per hour per staff member.

Every call is written to **/admin/ → Courier tracking → Tracking sync logs**,
which answers "why has this parcel not updated?".

## Local development

```bash
cd backend
python manage.py migrate
python manage.py test tracking          # no key or network needed: 17TRACK is mocked
# Optional, with a real key in backend/.env:
python manage.py sync_carrier_tracking
```

Without a key everything works except the automatic part: customers save a
courier and number, staff add updates by hand.

## Security

- Tracking numbers are cleaned up and checked on the server (`tracking/normalize.py`).
- All database access goes through the ORM; nothing builds SQL by hand.
- Customers reach only their own orders; staff endpoints are office (and
  warehouse manager for reading and adding) only. Floor workers have no access:
  the pages show customers' names and e-mail addresses.
- Customers never see staff names, corrected lines or error messages.
- The webhook needs a valid signature; the key stays on the server.
- Every staff change is stored with the person who made it and logged.
