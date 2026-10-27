# Connecting other software to PayLesShopMore

For whoever connects an outside program (accounting, a carrier, a payment
provider) to this website. The code is in `backend/integrations/`.

Two directions:

| Direction | How | You need |
|---|---|---|
| Your program → us | Call our API with an **API key** | A key from a PayLesShopMore admin |
| Us → your program | We POST **webhooks** to your URL | Give us an https URL; we give you a signing secret |

---

## 1. Getting access (done by a PayLesShopMore admin)

Everything below is done on the dashboard page **Integrations**
(`/dashboard/integrations`, in the sidebar under Website, admins only). The
same can be done in Django's `/admin/` → Integrations.

**An API key:** Integrations → "New API key". Tick only the scopes the
program needs. The key is shown **once**; copy it, then press "I have copied it".
From a shell instead: `python manage.py create_api_key "Moneybird" invoices:read`.

| Scope | Allows |
|---|---|
| `shipments:read` | `GET /shipments/` |
| `invoices:read` | `GET /invoices/` and `GET /invoices/<id>/pdf/` |
| `events:write` | `POST /events/` |
| `documents:write` | `POST /documents/` - an e-mail with documents to read by AI (see [DOCUMENT_REVIEW.md](DOCUMENT_REVIEW.md)) |

To stop a key: "Revoke" on its row. It stops working immediately.

**A webhook endpoint:** Integrations → "New webhook". The URL must be
`https://` and public. Tick the events to send. The signing secret is shown
**once**. Then press "Send test" and check the Deliveries list for the result.

---

## 2. Calling our API

Base URL: `https://<site>/api/integrations/v1/`. Send the key in a header:

```
Authorization: Bearer plsm_a1b2c3d4_...
```

| Call | Answer |
|---|---|
| `GET ping/` | `{"ok": true, "key": "Moneybird", "scopes": [...]}` - check your key |
| `GET shipments/?updated_since=2026-10-01T00:00:00Z` | Shipments changed after that time, oldest first, 25 a page (`?page=2`, `?page_size=` up to the limit) |
| `GET invoices/?updated_since=...&status=sent` | Issued invoices (`approved` or `sent`) only |
| `GET invoices/<id>/pdf/` | The invoice PDF |
| `POST events/` | Push an event to us (below) |

Money is always a string with two decimals (`"1370.48"`), in EUR.

To keep in sync, remember the newest `updated_at` you received and pass it as
`updated_since` next time.

**Pushing events to us** (e.g. a carrier's tracking update or a payment):

```json
POST /api/integrations/v1/events/
{"type": "shipment.tracking_updated", "id": "your-unique-id-123", "data": {"tracking_number": "PLSM-0007", "carrier_code": "JD0001"}}
```

- `202` = stored. Sending the same `id` again answers `200` and stores
  nothing new, so retrying after a timeout is safe.
- `type`: lowercase letters, digits and `. _ : -`. `data`: a JSON object, max 64 KB.
- Stored events are visible in `/admin/` → Inbound events. **Nothing acts on
  them yet**: each type gets its handler once we agree what it should do.

**Errors:** `401` no key / wrong / revoked / expired · `403` key lacks the
scope · `400` bad input (the body says which field) · `429` too many requests
(3,000 an hour per key).

---

## 3. Receiving our webhooks

We POST JSON to your URL:

```json
{"id": "6f1c2a90-...", "type": "invoice.sent", "created_at": "2026-10-16T09:12:00+00:00", "data": {...}}
```

| `type` | `data` |
|---|---|
| `shipment.status_changed` | the shipment (same shape as `GET shipments/`) + `from_status`, `to_status` |
| `invoice.approved` | the invoice (same shape as `GET invoices/`) |
| `invoice.sent` | the invoice, now with its PDF available |
| `ping` | a test message |

Headers: `X-PLSM-Event` (the type), `X-PLSM-Delivery` (same as `id`),
`X-PLSM-Signature: t=<unix seconds>,v1=<hex>`.

**Check the signature** before trusting a message:

```python
import hashlib, hmac, time

def is_genuine(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(item.split("=", 1) for item in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300:      # older than 5 minutes: refuse
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

Use the **raw** request body, before any JSON parsing.

**Answer quickly with any 2xx.** Anything else (or no answer within 10
seconds) is retried after 1 min, 5 min, 30 min, 2 h and 6 h, then given up.
The same `id` can arrive more than once - ignore ones you have already handled.
We do not follow redirects.

---

## 4. For developers of this site

- Keys only open `/api/integrations/v1/`: `ApiKeyAuthentication` is set on
  those views only, never as a default (see `integrations/authentication.py`).
  `config/test_access_matrix.py` and `integrations/tests.py` check this.
- Webhooks are emitted from `accounts/events.py` `record_event`, so any new
  order-history event can be forwarded by adding it to
  `integrations/webhooks.py` `emit_for_package_event`.
- Without a Celery worker (local development) failed webhooks are not retried
  automatically: run `python manage.py send_webhooks`.
- Adding a handler for an inbound event type: read unprocessed
  `InboundEvent` rows of that type, act, set `processed_at`.
