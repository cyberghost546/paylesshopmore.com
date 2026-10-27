// src/pages/Dashboard/Invoices.jsx
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/invoices
//   Who can open: office staff
//   Links to:     /dashboard/customers, /dashboard/packages (InvoiceDetail.jsx shows the PDF in
//                 place)
//   Linked from:  the dashboard sidebar, Overview, Packages
//   Backend:      api/staff.js

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import {
  INVOICE_STATUSES,
  approveInvoice,
  listCustomers,
  listInvoices,
  rejectInvoice,
  sendInvoice,
  uploadInvoiceDocument,
} from '../../api/staff';
import { useCollection } from './useCollection';
import { formatDate, formatDateTime, formatMoney } from './format';
import AddInvoice from './AddInvoice';
import InvoiceDetail from './InvoiceDetail';
import {
  Banner,
  Empty,
  FilterSelect,
  Pagination,
  SearchInput,
  StatusBadge,
  Toolbar,
} from './ui';
import styles from './Dashboard.module.css';
import { labelFor, translatedOptions, usePageText } from './usePageText';
import { canOpenInEditor } from './invoiceEditable';
import { downloadUrl, printPdf } from './printPdf';

const TONES = {
  draft: 'off',
  pending_review: 'attention',
  approved: 'progress',
  rejected: 'off',
  sent: 'done',
};

// The reject form asks for a reason, and the model refuses a blank one. This
// is only so the refusal arrives as a disabled button rather than as a 400
// from the server.
const MIN_REASON_LENGTH = 3;

// Which invoices accept a document.
//
//   pending_review — uploading approves it in your name and sends it, in one
//       step. The decision is not skipped, it is recorded: you are the
//       reviewer on the row afterwards.
//   approved — reviewed already, waiting for a document.
//   sent — the customer has one and it is wrong.
//
// Draft and rejected are refused by the server; this only decides whether to
// draw the control.
const ACCEPTS_DOCUMENT = ['pending_review', 'approved', 'sent'];

/**
 * "Upload PDF", as a real file input dressed as a button.
 *
 * A hidden input inside a <label> rather than a button that clicks a hidden
 * input by ref: the label already opens the picker, keyboard and screen
 * reader included, so the ref version would be re-implementing what the
 * browser does correctly for free.
 */
function UploadButton({ invoice, busy, onPick }) {
  // Named for what pressing it does, not for what it takes. From the queue
  // the upload also approves and sends, and a button labelled "Upload PDF"
  // would not have said so. The labels are `upload.<status>` in
  // i18n/pages/invoices.js.
  const d = usePageText('invoices');

  return (
    <label className={styles.uploadButton}>
      <input
        type="file"
        className={styles.uploadInput}
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(event) => {
          const [file] = event.target.files ?? [];
          // Reset first, or picking the same file twice in a row fires no
          // change event the second time and the upload silently does not
          // happen.
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      {busy ? d('uploading') : labelFor(d, 'upload', invoice.status, d('uploadPdf'))}
    </label>
  );
}

/**
 * The reject box, opened from a row. Deliberately a form rather than a
 * window.prompt: the reason is shown to whoever corrects the invoice, so it is
 * worth typing properly and worth being able to reread before sending.
 */
function RejectForm({ busy, onCancel, onSubmit }) {
  const d = usePageText('invoices');
  const [reason, setReason] = useState('');
  const tooShort = reason.trim().length < MIN_REASON_LENGTH;

  return (
    <form
      className={styles.officeBox}
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooShort) onSubmit(reason.trim());
      }}
    >
      <p className={styles.officeHead}>{d('rejectInvoice')}</p>

      <label className={styles.officeField}>
        <span className={styles.officeLabel}>{d('whatIsWrong')}</span>
        <textarea
          className={styles.officeInput}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={d('rejectPlaceholder')}
        />
      </label>

      <div className={styles.rowActions}>
        <button type="submit" className={styles.rowButton} disabled={tooShort || busy}>
          {busy ? d('rejecting') : d('rejectThis')}
        </button>
        <button
          type="button"
          className={styles.linkButton}
          onClick={onCancel}
          disabled={busy}
        >
          {d('cancel')}
        </button>
      </div>
    </form>
  );
}

export default function Invoices() {
  const [params] = useSearchParams();
  const d = usePageText('invoices');
  const c = usePageText('common');

  const list = useCollection(
    listInvoices,
    // Opens on every status ("Any status", the blank option). A link can
    // still ask for one status with ?status=…; `all` is the old spelling of
    // "every status" and is read as blank so the dropdown shows Any status.
    {
      status: params.get('status') === 'all' ? '' : (params.get('status') ?? ''),
      customer: params.get('customer') ?? '',
    },
    params.get('search') ?? '',
  );

  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  // The Add invoice form, and the details panel, both open over the table.
  const [adding, setAdding] = useState(false);
  const [viewingId, setViewingId] = useState(null);

  // Every customer, for the Customer filter. Loaded once rather than per
  // keystroke: this is a dropdown of who exists, not a search.
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    let cancelled = false;

    listCustomers({ erased: 'false', page_size: 200, ordering: 'last_name' })
      .then((page) => {
        if (!cancelled) setCustomers(page.results);
      })
      // Not fatal, and deliberately silent: the invoices still list, the
      // Customer dropdown just has nothing to offer. A banner about it would
      // be an error message for a filter nobody has tried to use yet.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const viewing = list.rows.find((invoice) => invoice.id === viewingId) ?? null;

  /** The sentence to put in the banner for a failed call. */
  function fault(failure) {
    // A 400 from the upload validator already says exactly what is wrong with
    // the file — "that file is not a PDF" — and no wording here improves on
    // it. The server is the only thing that knows.
    const field = failure.fields?.pdf;
    if (field) return Array.isArray(field) ? field.join(' ') : String(field);

    // 409 is the state machine refusing, which is a different thing from the
    // request having failed: somebody moved this invoice between the page
    // loading and the button being pressed.
    if (failure.status === 409) {
      return d('movedElsewhere');
    }

    return d('saveFailed');
  }

  async function run(invoice, call, success) {
    setBusyId(invoice.id);
    setError('');
    setDone('');

    try {
      list.replaceRow(await call());
      setRejectingId(null);
      setDone(success);
    } catch (failure) {
      setError(fault(failure));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {/* data-tour hooks: the Invoices tour ("dashboardInvoices" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.headWithAction} data-tour="db-inv-intro">
        <div>
          <h1 className={styles.title}>{d('title')}</h1>
          <p className={styles.subtitle}>
            {d('subtitleBefore')} <strong>{d('newInvoice')}</strong> {d('subtitleMiddle')}{' '}
            <strong>{d('uploadPdf')}</strong> {d('subtitleAfter')}
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
          <Link
            className={styles.primaryButton}
            to="/dashboard/invoices/new"
            data-tour="db-inv-new"
          >
            + {d('newInvoice')}
          </Link>
          <button
            type="button"
            className={styles.secondaryButton}
            data-tour="db-inv-upload"
            onClick={() => {
              setAdding(true);
              setViewingId(null);
              setError('');
              setDone('');
            }}
          >
            {d('uploadPdf')}
          </button>
          <Link
            className={styles.secondaryButton}
            to="/dashboard/invoices/settings"
            data-tour="db-inv-settings"
          >
            {d('settings')}
          </Link>
        </div>
      </header>

      {adding && (
        <AddInvoice
          onClose={() => setAdding(false)}
          onCreated={(invoice) => {
            setAdding(false);
            setDone(
              d('created', { number: invoice.number, customer: invoice.customer, tracking: invoice.tracking_number }),
            );
            // Back to every status, so the new invoice is on screen whichever
            // state it was created in. Reloading the queue would hide an
            // invoice that was sent straight away, which reads as it having
            // failed.
            list.setFilter('status', '');
            setViewingId(invoice.id);
          }}
          onOpenExisting={(id) => {
            setAdding(false);
            list.setFilter('status', '');
            setViewingId(id);
          }}
        />
      )}

      {viewing && (
        <InvoiceDetail invoice={viewing} onClose={() => setViewingId(null)} />
      )}

      <Toolbar tour="db-inv-filters">
        <SearchInput
          value={list.searchInput}
          onChange={list.setSearchInput}
          label={d('searchLabel')}
          placeholder={d('searchPlaceholder')}
        />
        <FilterSelect
          label={c('status')}
          value={list.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={translatedOptions(INVOICE_STATUSES, c, 'invoiceStatus')}
          allLabel={c('anyStatus')}
        />
        <FilterSelect
          label={d('customer')}
          value={list.filters.customer}
          onChange={(value) => list.setFilter('customer', value)}
          options={customers.map((row) => ({
            value: String(row.id),
            label: row.name || row.username,
          }))}
          allLabel={d('anyCustomer')}
        />
      </Toolbar>

      <Banner tone="error">{error}</Banner>
      <Banner tone="success">{done}</Banner>

      {list.state === 'loading' && <Loading inline />}
      {list.state === 'error' && <ConnectionError inline onRetry={list.reload} />}

      {list.state === 'ready' &&
        (list.rows.length === 0 ? (
          <Empty>
            {list.filters.status === 'pending_review' ? (
              <>
                {d('nothingWaiting')}
                <br />
                {/* An empty queue has two very different causes, and the
                    same sentence for both is what makes this page look
                    broken: either everything is dealt with, or no invoice
                    has ever been raised and there is nothing here to
                    approve or upload a document to. The second is fixed on
                    the Packages page, so this says so. */}
                <span className={styles.mutedCell}>
                  {d('expectingBefore')}{' '}
                  <Link className={styles.link} to="/dashboard/invoices?status=all">
                    {d('everyStatus')}
                  </Link>{' '}
                  {d('expectingMiddle')}{' '}
                  <Link className={styles.link} to="/dashboard/packages">
                    {d('packages')}
                  </Link>{' '}
                  {d('expectingOr')} <strong>{d('newInvoice')}</strong> {d('or')}{' '}
                  <strong>{d('uploadPdf')}</strong> {d('above')}
                </span>
              </>
            ) : (
              d('noMatch')
            )}
          </Empty>
        ) : (
          <div className={styles.tableWrap} data-tour="db-inv-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colInvoice')}</th>
                  <th scope="col">{d('customer')}</th>
                  <th scope="col">{d('colTracking')}</th>
                  <th scope="col">{d('colDate')}</th>
                  <th scope="col">{d('colAmount')}</th>
                  <th scope="col">{c('status')}</th>
                  <th scope="col">{d('colCreated')}</th>
                  <th scope="col">{d('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className={
                      invoice.status === 'pending_review'
                        ? styles.rowUnhandled
                        : undefined
                    }
                  >
                    <td>
                      <div className={styles.primaryCell}>{invoice.number}</div>
                    </td>

                    {/* The customer's name opens their record, which is the
                        question somebody asking "is this the right John
                        Smith" actually wants answered. Searched by e-mail
                        rather than by name for the same reason: two people
                        can share a name and nobody shares an address. */}
                    <td>
                      <Link
                        className={styles.link}
                        to={`/dashboard/customers?search=${encodeURIComponent(
                          invoice.customer_email ?? invoice.customer,
                        )}`}
                      >
                        {invoice.customer}
                      </Link>
                      <div className={styles.mutedCell}>
                        {d('customerId', { id: invoice.customer_id })}
                      </div>
                    </td>

                    <td>
                      <Link
                        className={styles.link}
                        to={`/dashboard/packages?search=${encodeURIComponent(
                          invoice.tracking_number,
                        )}`}
                      >
                        {invoice.tracking_number}
                      </Link>
                      <div className={styles.mutedCell}>
                        {invoice.shipment_status}
                      </div>
                    </td>

                    <td className={styles.dateCell}>
                      {formatDate(invoice.dated_on)}
                    </td>

                    <td className={styles.numberCell}>
                      {formatMoney(invoice.value_eur)}
                    </td>

                    <td>
                      <StatusBadge tone={TONES[invoice.status]}>
                        {labelFor(c, 'invoiceStatus', invoice.status, invoice.status_display)}
                      </StatusBadge>

                      {/* Who decided, and why, shown where the decision is. */}
                      {invoice.reviewed_by_name && (
                        <div className={styles.mutedCell}>
                          {invoice.reviewed_by_name} ·{' '}
                          {formatDateTime(invoice.reviewed_at)}
                        </div>
                      )}
                      {invoice.rejection_reason && (
                        <div className={styles.mutedCell}>
                          {invoice.rejection_reason}
                        </div>
                      )}
                      {invoice.status === 'sent' && (
                        <div className={styles.mutedCell}>
                          {d('onProfileSince', { date: formatDateTime(invoice.sent_at) })}
                        </div>
                      )}
                      {/* Approved with nothing rendered is a stuck job rather
                          than a state anybody chose, so it is worth naming. */}
                      {invoice.status === 'approved' && !invoice.pdf_url && (
                        <div className={styles.mutedCell}>
                          {d('waitingForDocument')}
                        </div>
                      )}
                      {/* Approved *with* a document is a state somebody did
                          choose, on the Add invoice form. Named so it does not
                          read as the stuck one above. */}
                      {invoice.status === 'approved' && invoice.pdf_url && (
                        <div className={styles.mutedCell}>
                          {d('readyToSend')}
                        </div>
                      )}
                    </td>

                    <td className={styles.dateCell}>
                      {formatDateTime(invoice.created_at)}
                      <div className={styles.mutedCell}>
                        {/* Null on an automatically raised invoice, and that
                            null is information: nobody raised it, a shipment
                            being marked paid did. */}
                        {invoice.created_by_name ?? d('raisedAutomatically')}
                      </div>
                    </td>

                    <td>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.rowButton}
                          onClick={() => {
                            setAdding(false);
                            setViewingId(
                              viewingId === invoice.id ? null : invoice.id,
                            );
                          }}
                        >
                          {viewingId === invoice.id ? d('hide') : d('view')}
                        </button>

                        {/* Fill it in and add its charges in the editor -
                            also one raised automatically, before it has a
                            document. */}
                        {canOpenInEditor(invoice) && (
                          <Link className={styles.rowButton} to={`/dashboard/invoices/${invoice.id}/edit`}>
                            {d('edit')}
                          </Link>
                        )}

                        {invoice.status === 'pending_review' ? (
                          <>
                            <button
                              type="button"
                              className={styles.rowButton}
                              disabled={busyId === invoice.id}
                              onClick={() =>
                                run(
                                  invoice,
                                  () => approveInvoice(invoice.id),
                                  d('approved', { tracking: invoice.tracking_number }),
                                )
                              }
                            >
                              {busyId === invoice.id ? d('working') : d('approve')}
                            </button>
                            <button
                              type="button"
                              className={styles.linkButton}
                              disabled={busyId === invoice.id}
                              onClick={() =>
                                setRejectingId(
                                  rejectingId === invoice.id ? null : invoice.id,
                                )
                              }
                            >
                              {rejectingId === invoice.id ? d('cancel') : d('reject')}
                            </button>
                          </>
                        ) : null}

                        {invoice.status === 'approved' && invoice.pdf_url && (
                          <button
                            type="button"
                            className={styles.rowButton}
                            disabled={busyId === invoice.id}
                            onClick={() =>
                              run(
                                invoice,
                                () => sendInvoice(invoice.id),
                                d('sent', { number: invoice.number, customer: invoice.customer }),
                              )
                            }
                          >
                            {busyId === invoice.id ? d('sending') : d('sendToCustomer')}
                          </button>
                        )}

                        {ACCEPTS_DOCUMENT.includes(invoice.status) ? (
                          <UploadButton
                            invoice={invoice}
                            busy={busyId === invoice.id}
                            onPick={(file) =>
                              run(
                                invoice,
                                () => uploadInvoiceDocument(invoice.id, file),
                                invoice.status === 'sent'
                                  ? d('replaced', { tracking: invoice.tracking_number })
                                  : invoice.status === 'pending_review'
                                    ? d('approvedAndSent', { tracking: invoice.tracking_number })
                                    : d('uploadedAndSent', { tracking: invoice.tracking_number }),
                              )
                            }
                          />
                        ) : (
                          <span className={styles.mutedCell}>—</span>
                        )}

                        {/* On every invoice. print_url is the stored document
                            (what the customer gets) or, before there is one,
                            the invoice drawn as it stands now. Download saves
                            the file (?download=1); Print sends it straight to
                            the printer (printPdf.js). */}
                        <a
                          className={styles.link}
                          href={downloadUrl(invoice.print_url)}
                          download
                        >
                          {d('download')}
                        </a>
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => {
                            setError('');
                            printPdf(invoice.print_url).catch(() => setError(d('printFailed')));
                          }}
                        >
                          {d('print')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* Below the table rather than inside a cell: a textarea in a table row
          squeezes every other column. */}
      {rejectingId !== null &&
        list.rows
          .filter((invoice) => invoice.id === rejectingId)
          .map((invoice) => (
            <section key={invoice.id} className={styles.detail}>
              <h2 className={styles.detailTitle}>
                {d('invoiceFor', { tracking: invoice.tracking_number })}
              </h2>

              <RejectForm
                busy={busyId === invoice.id}
                onCancel={() => setRejectingId(null)}
                onSubmit={(reason) =>
                  run(
                    invoice,
                    () => rejectInvoice(invoice.id, reason),
                    d('rejected', { tracking: invoice.tracking_number }),
                  )
                }
              />
            </section>
          ))}

      <Pagination
        page={list.page}
        count={list.count}
        hasNext={list.hasNext}
        hasPrevious={list.hasPrevious}
        onChange={list.setPage}
      />
    </>
  );
}
