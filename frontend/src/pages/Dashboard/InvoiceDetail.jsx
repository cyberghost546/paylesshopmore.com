// src/pages/Dashboard/InvoiceDetail.jsx
//
// One invoice, opened from the View button on the table.
//
// Everything here is already on the row the table rendered, so this makes no
// request of its own: opening the details of an invoice you are looking at
// should not be able to fail, and a spinner over data already in hand is a
// delay invented for its own sake.
//
// The panel exists because the table cannot show the pairing in full and the
// pairing is what somebody checking an invoice is checking. Whose it is, which
// shipment it is for, where that shipment went, who raised it and when — laid
// out side by side, with the document itself underneath.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatDateTime, formatMoney } from './format';
import styles from './Dashboard.module.css';
import { labelFor, usePageText } from './usePageText';
import { canOpenInEditor } from './invoiceEditable';
import { downloadUrl, printPdf } from './printPdf';

/** One label and its value, or a dash when there is nothing to show. */
function Fact({ label, children, wide = false }) {
  return (
    <div className={wide ? styles.detailWide : undefined}>
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

/**
 * @param {{ invoice: object, onClose: () => void }} props
 */
export default function InvoiceDetail({ invoice, onClose }) {
  const d = usePageText('invoices');
  const c = usePageText('common');
  // Shown when the PDF could not be fetched for printing.
  const [printError, setPrintError] = useState('');
  return (
    <section className={styles.detail} aria-labelledby="invoice-detail-title">
      <div className={styles.detailHead}>
        <h2 className={styles.detailTitle} id="invoice-detail-title">
          {invoice.number}
        </h2>
        <span style={{ display: 'flex', gap: '1rem' }}>
          {/* Open it in the editor to review, correct or fill it in - an
              automatic one too, while it has no document. */}
          {canOpenInEditor(invoice) && (
            <Link className={styles.linkButton} to={`/dashboard/invoices/${invoice.id}/edit`}>
              {d('openInEditor')}
            </Link>
          )}
          <button type="button" className={styles.linkButton} onClick={onClose}>
            {c('close')}
          </button>
        </span>
      </div>

      <dl className={styles.detailGrid}>
        <Fact label={d('invoiceNumber')}>{invoice.number}</Fact>
        <Fact label={d('invoiceStatus')}>{labelFor(c, 'invoiceStatus', invoice.status, invoice.status_display)}</Fact>
        <Fact label={d('colDate')}>{formatDate(invoice.dated_on)}</Fact>
        <Fact label={d('colAmount')}>{formatMoney(invoice.value_eur)}</Fact>

        <Fact label={d('customer')}>
          <Link
            className={styles.link}
            to={`/dashboard/customers?search=${encodeURIComponent(
              invoice.customer_email ?? invoice.customer,
            )}`}
          >
            {invoice.customer}
          </Link>
        </Fact>
        <Fact label={d('customerIdLabel')}>{invoice.customer_id}</Fact>
        <Fact label={c('email')}>{invoice.customer_email}</Fact>

        <Fact label={d('colTracking')}>
          <Link
            className={styles.link}
            to={`/dashboard/packages?search=${encodeURIComponent(
              invoice.tracking_number,
            )}`}
          >
            {invoice.tracking_number}
          </Link>
        </Fact>
        <Fact label={d('shipmentStatus')}>{invoice.shipment_status}</Fact>
        <Fact label={d('destination')}>{invoice.destination}</Fact>

        <Fact label={d('colCreated')}>{formatDateTime(invoice.created_at)}</Fact>
        <Fact label={d('createdBy')}>
          {/* Null when nothing but a paid shipment caused it. Said in words
              rather than left blank, which would read as missing data. */}
          {invoice.created_by_name ?? d('raisedAutomatically')}
        </Fact>
        <Fact label={d('reviewedBy')}>
          {invoice.reviewed_by_name
            ? `${invoice.reviewed_by_name} · ${formatDateTime(invoice.reviewed_at)}`
            : ''}
        </Fact>

        {invoice.status === 'sent' && (
          <Fact label={d('onProfileSinceLabel')} wide>
            {formatDateTime(invoice.sent_at)}
          </Fact>
        )}

        {invoice.rejection_reason && (
          <Fact label={d('whyRejected')} wide>
            {invoice.rejection_reason}
          </Fact>
        )}
      </dl>

      {/* Always offered. print_url is the stored document, or - before there
          is one - the invoice drawn as it stands now. Download saves it as a
          file named after the invoice number. */}
      <div className={styles.modalActions}>
        <a
          className={styles.primaryButton}
          href={downloadUrl(invoice.print_url)}
          download
        >
          {d('downloadPdf')}
        </a>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => {
            setPrintError('');
            printPdf(invoice.print_url).catch(() => setPrintError(d('printFailed')));
          }}
        >
          {d('print')}
        </button>
      </div>
      {printError && <p className={styles.mutedCell} role="alert">{printError}</p>}

      {invoice.pdf_url ? (
        <>

          {/* The document itself, in place. The route behind it checks the
              session on every request, so this is the same guarded URL the
              download button uses and not a media path. */}
          <iframe
            className={styles.pdfPreview}
            src={invoice.pdf_url}
            title={d('invoiceTitle', { number: invoice.number })}
          />
        </>
      ) : (
        <p className={styles.mutedCell}>{d('noDocument')}</p>
      )}
    </section>
  );
}
