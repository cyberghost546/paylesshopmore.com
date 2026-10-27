# AI document reading with human review

Incoming documents (receipts, shop invoices, order confirmations, shipping labels, warehouse photos and e-mails) are read by AI and matched to the customer, shipment, shop order and invoice they belong to. When the match is reliable, the link is made automatically. Anything uncertain waits on **Dashboard → Document review** until a person checks it.

Code: `backend/docreview/` (start with `models.py`, then `pipeline.py`). Page: `frontend/src/pages/Dashboard/DocumentReview.jsx` and `DocumentJobPanel.jsx`.

## Where documents come from

| Source | How | Read automatically? |
| --- | --- | --- |
| Customer upload | A customer adds a receipt, invoice or customs form on their profile | Yes, when `DOCUMENT_AI_AUTO` is on |
| Booking attachment | A customer adds an order confirmation, invoice or track-and-trace to a shop order | Yes, when `DOCUMENT_AI_AUTO` is on |
| Staff upload | "Upload and read" on the Document review page | Always |
| Warehouse photo | A warehouse account uploads a photo through `POST /api/staff/document-jobs/` | Always |
| E-mail | A mail service posts the e-mail to `POST /api/integrations/v1/documents/` (API key with the `documents:write` scope) | Always |

Each document gets exactly **one job**. Uploading the same file twice, or a mail service sending the same e-mail twice, returns the existing job.

## What happens to a job

1. **Read.** The document goes to OpenAI (`docreview/ai.py`), which returns a transcription of the text (the OCR result) and a fixed set of fields: shipment numbers, customer number, e-mail address, courier tracking numbers, invoice number, amount, and so on. Every attempt is stored, including failed ones.
2. **Check.** `docreview/validation.py` checks each field's format. It also checks that every identifier **actually appears in the document's text**. An identifier that doesn't appear is never used for an automatic link.
3. **Look up.** `docreview/matching.py` finds records using **exact** database lookups only, and follows existing relations: a shipment leads to its owner, a pre-alert to its parcel, an invoice to its shipment. The AI never sees the database and never chooses an id.
4. **Decide.** The job is linked automatically only when there is no reason to doubt it: exactly one shipment and one customer, found through checked identifiers, all belonging to the same customer, no failed checks, and nothing to do with invoices. Otherwise it goes to review, with the reasons listed.
5. **Link.** Links are saved in one database transaction, after every record is checked again. The website is then updated:
   - a customer's receipt is filed on the matched shipment;
   - an e-mailed or uploaded document is filed in the customer's documents, so it shows on their shipment.

The system **never creates packages or invoices, and never changes an invoice.** It only links to records that already exist.

## In the review screen

The original document is shown next to what was read. A person can:

- **edit fields**, with a reason. The lookups then run again, and values typed by a person are trusted;
- **use** a proposed match, or **search** for any existing record and pick it;
- mark a match as **wrong**, with a reason. It won't be proposed again;
- **confirm and link**. Everything is checked again first, and records belonging to two different customers are refused;
- **read again**: a new OCR + AI attempt;
- **mark resolved**, with a reason (for example "spam" or "not ours").

**Invoices:** only an **admin** can link a document to an invoice, and invoice links are never made automatically.

Every action is written to the history (the audit log) with who did it, when, the value before and after, and the reason.

## Safety

- **Documents and e-mails are untrusted.** The AI is told never to follow instructions inside them. Its answer is forced into a fixed JSON shape, and nothing ever acts on its free text. E-mail text is stored and shown as plain text only.
- **Customers never see the queue.** Every review route requires an office account. Warehouse accounts can only upload. A customer's own upload can never be linked to another customer's shipment, not even by staff.
- **Files** are stored privately. They are served only to staff, and only after the server has checked the file's own first bytes (PDF, PNG, JPEG or WebP).
- **The API key** (`OPENAI_API_KEY`) is kept in environment variables only. It is never stored in the database or sent to the browser.
- **Failed jobs** are kept with every attempt and the error, so they can be investigated. **Read again** works once the cause is fixed.

## Setup

On the web service **and** the Celery worker, set:

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | your key from platform.openai.com |
| `DOCUMENT_AI_MODEL` | optional; default `gpt-5.5` |
| `DOCUMENT_AI_AUTO` | optional; default on when the key is set. Set it to `0` to read only staff uploads and e-mails |

Without a Celery broker, documents are read during the request that uploads them, so the upload takes a few seconds longer. With the worker running, reading happens in the background and the review screen refreshes by itself.

**E-mail:** create an API key with the `documents:write` scope (Dashboard → Integrations). Then point your mail service's inbound webhook at `/api/integrations/v1/documents/`, using this body:

```json
{"id": "<Message-ID>", "from": "shop@example.com", "subject": "...", "text": "...",
 "attachments": [{"filename": "invoice.pdf", "content": "<base64>"}]}
```

**Cost:** each document read is one OpenAI API call. Requests are sent with `store=False`, so OpenAI is asked not to keep them. Turn `DOCUMENT_AI_AUTO` off if you only want documents read on request.
