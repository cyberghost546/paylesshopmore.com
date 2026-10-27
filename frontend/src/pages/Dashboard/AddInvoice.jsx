// src/pages/Dashboard/AddInvoice.jsx
//
// The Add invoice form: pick a customer, pick one of that customer's
// shipments, attach the PDF, save.
//
// Its own file rather than another block inside Invoices.jsx, which is already
// a table with three row actions and a reject form. This has its own three
// requests, its own two-step selection and its own success screen, and shares
// nothing with the queue but the page it opens over.
//
// The shipment list is narrowed to the chosen customer, and that narrowing is
// a convenience and nothing more. What actually prevents an invoice landing on
// the wrong customer's shipment is the check the server makes on the way back
// in — see InvoiceCreateSerializer. This form is built so the mistake is hard
// to make; the server is what makes it impossible.

import { useEffect, useMemo, useState } from 'react';
import {
  CREATABLE_INVOICE_STATUSES,
  createInvoice,
  listCustomers,
  listPackages,
} from '../../api/staff';
import { formatDate, formatMoney } from './format';
import styles from './Dashboard.module.css';
import { labelFor, translatedOptions, usePageText } from './usePageText';

// How long to wait after a keystroke before searching. Typing a name is then
// one request rather than one per letter. It deliberately does not apply to an
// empty box: that is the list the form opens with, nobody is typing, and a
// quarter of a second of "Searching…" before anyone has touched it is a delay
// invented for its own sake.
const TYPING_PAUSE = 250;

// Matches InvoiceDocumentSerializer.MAX_BYTES on the server. Checked here so
// somebody picking a 40 MB scan is told before it is uploaded rather than
// after; the server checks it again, which is the check that counts.
const MAX_BYTES = 10 * 1024 * 1024;

/** "1.4 MB", so the size is readable at the moment the file is chosen. */
function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Today, as the value a <input type="date"> wants. */
function today() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * A search box with a list of results under it, used for both pickers.
 *
 * One component for customers and shipments because the interaction is the
 * same one twice: type, look at what came back, press the row you meant. What
 * differs is only what a row says, which is why `renderRow` is a prop rather
 * than a branch inside here.
 */
function Picker({
  label,
  hint,
  placeholder,
  value,
  rows,
  state,
  search,
  onSearch,
  onPick,
  renderRow,
  emptyLabel,
  disabled = false,
}) {
  const d = usePageText('addInvoice');
  return (
    <div className={styles.pickerBlock}>
      <label className={styles.officeField}>
        <span className={styles.pickerLabel}>{label}</span>
        {hint && <span className={styles.pickerHint}>{hint}</span>}
        <input
          type="search"
          className={styles.officeInput}
          value={search}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>

      {/* The chosen row stays on screen after the list closes. Without it the
          form shows a search box holding whatever was typed, which is not the
          same thing as the record that was picked — and picking the right
          customer is the whole job here. */}
      {value ? (
        <div className={styles.pickerChosen}>
          <div>{renderRow(value)}</div>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => onPick(null)}
          >
            {d('change')}
          </button>
        </div>
      ) : (
        <div className={styles.pickerResults} role="listbox" aria-label={label}>
          {state === 'loading' && (
            <p className={styles.pickerMessage}>{d('searching')}</p>
          )}
          {state === 'error' && (
            <p className={styles.pickerMessage}>{d('listFailed')}</p>
          )}
          {state === 'ready' && rows.length === 0 && (
            <p className={styles.pickerMessage}>{emptyLabel}</p>
          )}
          {state === 'ready' &&
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={styles.pickerRow}
                onClick={() => onPick(row)}
              >
                {renderRow(row)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function CustomerRow({ customer }) {
  const d = usePageText('addInvoice');
  return (
    <>
      <span className={styles.pickerPrimary}>
        {customer.name || customer.username}
      </span>
      <span className={styles.pickerMeta}>{customer.email}</span>
      <span className={styles.pickerMeta}>
        {d('customerId', { id: customer.id })}
        {customer.phone_number ? ` · ${customer.phone_number}` : ''}
        {` · ${customer.package_count === 1 ? d('oneShipment') : d('shipments', { count: customer.package_count })}`}
      </span>
    </>
  );
}

function ShipmentRow({ shipment }) {
  const d = usePageText('addInvoice');
  const c = usePageText('common');
  return (
    <>
      <span className={styles.pickerPrimary}>{shipment.tracking_number}</span>
      <span className={styles.pickerMeta}>
        {labelFor(c, 'packageStatus', shipment.status, shipment.status_display)}
        {shipment.destination ? ` · ${shipment.destination}` : ''}
        {` · ${d('added', { date: formatDate(shipment.created_at) })}`}
        {shipment.shipped_at ? ` · ${d('shipped', { date: formatDate(shipment.shipped_at) })}` : ''}
      </span>
      <span className={styles.pickerMeta}>
        {shipment.description || d('noDescription')}
        {shipment.value_eur ? ` · ${formatMoney(shipment.value_eur)}` : ''}
        {shipment.invoice ? ` · ${d('hasInvoice')}` : ''}
      </span>
    </>
  );
}

/**
 * @param {{ onClose: () => void, onCreated: (invoice: object) => void,
 *           onOpenExisting: (id: number) => void }} props
 */
export default function AddInvoice({ onClose, onCreated, onOpenExisting }) {
  const d = usePageText('addInvoice');
  const c = usePageText('common');
  const [customer, setCustomer] = useState(null);
  const [shipment, setShipment] = useState(null);
  const [file, setFile] = useState(null);
  const [invoiceStatus, setInvoiceStatus] = useState('sent');
  const [invoiceDate, setInvoiceDate] = useState(today());

  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customerState, setCustomerState] = useState('loading');

  const [shipmentSearch, setShipmentSearch] = useState('');
  const [shipments, setShipments] = useState([]);
  // 'ready' rather than 'loading' to begin with: nothing is being fetched
  // until a customer has been chosen, and an empty list under a spinner reads
  // as a request that never came back.
  const [shipmentState, setShipmentState] = useState('ready');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Set when the shipment already has an invoice, together with its id, so
  // the refusal comes with a way to open the one that exists.
  const [duplicate, setDuplicate] = useState(null);
  // The created invoice. While this is set the form is replaced by the
  // confirmation, which is what makes "Add another" a real choice rather than
  // a guess about whether the first one worked.
  const [created, setCreated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setCustomerState('loading');
      listCustomers({ search: customerSearch, erased: 'false', page_size: 20 })
        .then((page) => {
          if (cancelled) return;
          setCustomers(page.results);
          setCustomerState('ready');
        })
        .catch(() => {
          if (!cancelled) setCustomerState('error');
        });
    }, customerSearch ? TYPING_PAUSE : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerSearch]);

  // Only the chosen customer's shipments, and only once there is one. The
  // `user` parameter is what narrows it; the server re-checks the pairing on
  // save regardless of what this list happened to show.
  useEffect(() => {
    // Nothing to fetch, and nothing to clear either: the list is emptied when
    // the customer is changed, which is where that belongs. Clearing it from
    // in here would be state chasing state.
    if (!customer) return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      setShipmentState('loading');
      listPackages({ user: customer.id, search: shipmentSearch, page_size: 50 })
        .then((page) => {
          if (cancelled) return;
          setShipments(page.results);
          setShipmentState('ready');
        })
        .catch(() => {
          if (!cancelled) setShipmentState('error');
        });
    }, shipmentSearch ? TYPING_PAUSE : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customer, shipmentSearch]);

  /** What is missing, if anything, in the order the form asks for it. */
  const missing = useMemo(() => {
    if (!customer) return d('missingCustomer');
    if (!shipment) return d('missingShipment');
    if (!file) return d('missingFile');
    return '';
  }, [customer, shipment, file, d]);

  function pickFile(chosen) {
    setError('');
    setDuplicate(null);

    if (!chosen) return;

    // Both checks are repeated on the server, where they are the ones that
    // hold. These exist so a wrong file is caught before it is uploaded.
    const looksPdf =
      chosen.type === 'application/pdf' ||
      chosen.name.toLowerCase().endsWith('.pdf');

    if (!looksPdf) {
      setError(d('notPdf'));
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setError(d('tooBig', { size: formatSize(chosen.size) }));
      return;
    }

    setFile(chosen);
  }

  async function submit(event) {
    event.preventDefault();
    if (missing || busy) return;

    setBusy(true);
    setError('');
    setDuplicate(null);

    try {
      const invoice = await createInvoice({
        customerId: customer.id,
        packageId: shipment.id,
        file,
        status: invoiceStatus,
        invoiceDate,
      });
      setCreated(invoice);
    } catch (failure) {
      // 409 with an id: the shipment already has an invoice, which is not a
      // mistake in the form so much as a question already answered. The id
      // comes back with it so the answer can be opened.
      if (failure.status === 409 && failure.fields?.existing_invoice) {
        setDuplicate({
          id: Number(failure.fields.existing_invoice),
          tracking: String(failure.fields.tracking_number ?? ''),
        });
      } else {
        // The server's own words when it has any. "That shipment does not
        // belong to John Smith" and "that file is not a PDF" are both whole
        // answers, and no wording here improves on either.
        const said =
          failure.fields?.package ??
          failure.fields?.pdf ??
          failure.fields?.customer ??
          failure.fields?.invoice_date ??
          failure.fields?.detail;

        setError(
          said
            ? String(Array.isArray(said) ? said[0] : said)
            : d('createFailed'),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function startAnother() {
    setCreated(null);
    setShipment(null);
    setFile(null);
    setShipmentSearch('');
    setInvoiceDate(today());
    // The customer is kept. Raising two invoices for one customer is the
    // common second use, and clearing it would mean finding them again.
  }

  if (created) {
    return (
      <section className={styles.modalCard} aria-labelledby="add-invoice-done">
        <h2 className={styles.modalTitle} id="add-invoice-done">
          {d('createdTitle')}
        </h2>

        <dl className={styles.summary}>
          <div>
            <dt>{d('customer')}</dt>
            <dd>{created.customer}</dd>
          </div>
          <div>
            <dt>{d('invoiceNumber')}</dt>
            <dd>{created.number}</dd>
          </div>
          <div>
            <dt>{d('trackingNumber')}</dt>
            <dd>{created.tracking_number}</dd>
          </div>
          <div>
            <dt>{c('status')}</dt>
            <dd>{labelFor(c, 'invoiceStatus', created.status, created.status_display)}</dd>
          </div>
        </dl>

        {created.status === 'sent' && (
          <p className={styles.modalNote}>
            {d('onProfile', { customer: created.customer })}
          </p>
        )}

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onCreated(created)}
          >
            {d('viewInvoice')}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={startAnother}
          >
            {d('addAnother')}
          </button>
          <button type="button" className={styles.linkButton} onClick={onClose}>
            {c('close')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      className={styles.modalCard}
      onSubmit={submit}
      aria-labelledby="add-invoice-title"
    >
      <h2 className={styles.modalTitle} id="add-invoice-title">
        {d('title')}
      </h2>
      <p className={styles.modalIntro}>{d('intro')}</p>

      <Picker
        label={d('stepCustomer')}
        hint={d('customerHint')}
        placeholder={d('customerPlaceholder')}
        value={customer}
        rows={customers}
        state={customerState}
        search={customerSearch}
        onSearch={setCustomerSearch}
        onPick={(picked) => {
          setCustomer(picked);
          // The shipment and the list it came from both belonged to the
          // previous customer, so neither survives the change. Leaving either
          // is exactly how an invoice ends up on the wrong person's parcel.
          setShipment(null);
          setShipments([]);
          setShipmentSearch('');
          setDuplicate(null);
          setError('');
        }}
        renderRow={(row) => <CustomerRow customer={row} />}
        emptyLabel={d('noCustomer')}
      />

      <Picker
        label={d('stepShipment')}
        hint={
          customer
            ? d('onlyTheirs', { name: customer.name || customer.username })
            : d('customerFirst')
        }
        placeholder={d('shipmentPlaceholder')}
        value={shipment}
        rows={shipments}
        state={shipmentState}
        search={shipmentSearch}
        onSearch={setShipmentSearch}
        onPick={(picked) => {
          setShipment(picked);
          setDuplicate(null);
          setError('');
        }}
        renderRow={(row) => <ShipmentRow shipment={row} />}
        emptyLabel={
          customer
            ? d('noShipment')
            : d('customerFirst')
        }
        disabled={!customer}
      />

      <div className={styles.pickerBlock}>
        <span className={styles.pickerLabel}>{d('stepNumber')}</span>
        <p className={styles.pickerHint}>{d('numberHint', { year: new Date().getFullYear() })}</p>
      </div>

      <label className={styles.pickerBlock}>
        <span className={styles.pickerLabel}>{d('stepPdf')}</span>
        <span className={styles.pickerHint}>{d('pdfHint')}</span>
        <input
          type="file"
          className={styles.fileInput}
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(event) => {
            const [chosen] = event.target.files ?? [];
            // Reset first, or picking the same file twice in a row fires no
            // change event the second time and nothing appears to happen.
            event.target.value = '';
            pickFile(chosen);
          }}
        />
        {file && (
          <span className={styles.chosenFile}>
            {file.name} · {formatSize(file.size)}
          </span>
        )}
      </label>

      <div className={styles.formRow}>
        <label className={styles.officeField}>
          <span className={styles.pickerLabel}>{d('stepNext')}</span>
          <select
            className={styles.officeInput}
            value={invoiceStatus}
            disabled={busy}
            onChange={(event) => setInvoiceStatus(event.target.value)}
          >
            {translatedOptions(CREATABLE_INVOICE_STATUSES, c, 'invoiceCreate').map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className={styles.pickerHint}>
            {labelFor(
              d,
              'hint',
              invoiceStatus,
              CREATABLE_INVOICE_STATUSES.find((option) => option.value === invoiceStatus)?.hint,
            )}
          </span>
        </label>

        <label className={styles.officeField}>
          <span className={styles.pickerLabel}>{d('stepDate')}</span>
          <input
            type="date"
            className={styles.officeInput}
            value={invoiceDate}
            max={today()}
            disabled={busy}
            onChange={(event) => setInvoiceDate(event.target.value)}
          />
          <span className={styles.pickerHint}>{d('dateHint')}</span>
        </label>
      </div>

      {duplicate && (
        <div className={styles.modalWarning} role="alert">
          <p className={styles.modalWarningTitle}>
            {d('duplicateTitle')}
          </p>
          <p>{d('duplicateBody', { tracking: duplicate.tracking })}</p>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => onOpenExisting(duplicate.id)}
          >
            {d('viewExisting')}
          </button>
        </div>
      )}

      {error && (
        <p className={styles.modalError} role="alert">
          {error}
        </p>
      )}

      {busy && (
        <p className={styles.modalNote} role="status">
          {d('working')}
        </p>
      )}

      <div className={styles.modalActions}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={Boolean(missing) || busy}
          // The reason it is disabled, so a disabled button is not a puzzle.
          title={missing || undefined}
        >
          {busy ? d('creating') : d('create')}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onClose}
          disabled={busy}
        >
          {d('cancel')}
        </button>
        {missing && <span className={styles.pickerHint}>{missing}</span>}
      </div>
    </form>
  );
}
