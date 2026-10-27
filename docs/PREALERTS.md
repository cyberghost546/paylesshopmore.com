# Pre-alerts

A pre-alert is a customer telling us that a parcel is on its way to our
warehouse: the courier and its tracking number, the shop, what is inside, who
receives it, its value, and the shop's invoice. We use it to recognise the
parcel when it arrives and to process it quickly.

A pre-alert is **not** a received package. It only says "arrived" once the
warehouse has scanned the parcel, and it only becomes part of one of our
shipments (PLSM-...) when the office adds it.

## The flow

| Step | Who | Where | What is recorded |
| --- | --- | --- | --- |
| 1. Pre-alert | Customer | Profile → My bookings or My shipments → **Pre-alert a package** (`/prealert`) | Reference `PA-2026-000123`, status *Pre-alert submitted*, courier tracking starts, a notification |
| 2. On its way | The courier (17TRACK) or our staff | Automatic, or Dashboard → Courier tracking | Courier updates, marked "Courier" or "Our team" |
| 3. Arrival | Warehouse | Warehouse → Scan Package → scan the courier barcode → **Confirm arrival** | Status *Arrived at our warehouse*, the time and who scanned it - once |
| 4. Into a shipment | Office | Dashboard → **Pre-alerts** → open → **Add to shipment** (PLSM number) | Status *Added to a shipment*; only a shipment of the same customer |

The customer sees all of it under **My shipments → On the way to our
warehouse**, and can cancel a pre-alert while the parcel is not with us yet.

## Rules

- **One live pre-alert per tracking number**, and not a number already on a
  booking. A second one - a double-click, or another customer typing the same
  number - is refused with the same sentence for everybody, so it says nothing
  about whose it is. (Enforced in the database too.)
- **Only the customer's own**: every customer route is narrowed to the signed-in
  customer; somebody else's pre-alert answers 404. The receiver's address must
  be one of the customer's own addresses.
- **Invoice optional**, PDF / JPG / PNG / WebP, 10 MB each, at most 5 files -
  the same check as the booking form, which looks at the file's contents, not
  only its name. Files are never public: they are streamed by a view that
  checks who is asking.
- **Restricted items**: the box must be ticked; the time it was ticked is stored.
- **Walk-in** is not offered: a pre-alert is for a parcel sent by a courier.
- **Who can do what**: customers send, read and cancel their own; floor workers
  scan and confirm arrival (they see the customer's name, shop and contents,
  not their e-mail or address); the warehouse manager reads the Pre-alerts
  page; the office also adds to a shipment and cancels.

## What is automatic and what is not

| | Automatic | Needs a person |
| --- | --- | --- |
| Courier updates on the way | With `SEVENTEEN_TRACK_API_KEY` set (see [TRACKING.md](TRACKING.md)) | Without it: staff on Dashboard → Courier tracking |
| Arrival | - | The warehouse scan |
| Into a shipment | - | The office |
| "Pre-alert registered" notification | Yes (bell, and e-mail if the customer allows shipping e-mails) | - |

## Database changes

- New app `prealerts`: tables `PreAlert` and `PreAlertDocument`
  (migration `prealerts/0001_initial`).
- `tracking.CarrierShipment` can now belong to a pre-alert as well as a booking
  order (exactly one of the two), and remembers whose parcel it is (`owner`).
  Migration `tracking/0004_prealerts_and_owner` fills `owner` for every existing
  row from its booking; nothing is deleted.

Both run with `python manage.py migrate`, which the deploy already does.

## No new settings

Nothing new to configure. Automatic courier updates use the existing
`SEVENTEEN_TRACK_API_KEY` (optional).
