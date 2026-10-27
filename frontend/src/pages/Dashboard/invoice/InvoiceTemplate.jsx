// src/pages/Dashboard/invoice/InvoiceTemplate.jsx
//
// THE PRINTABLE INVOICE.
//
// This component only LAYS OUT an invoice. It does no arithmetic and knows
// nothing about the form: it receives a finished `doc` from buildDocument()
// in invoiceForm.js and puts each value in its place on an A4 sheet.
//
// That separation is on purpose (the input form and the printable template
// are two different jobs):
//   - the form can change without touching the invoice layout, and
//   - the template can be tested by handing it a `doc` and reading the page.
//
// The layout follows the office's paper FACTUUR and the server's PDF
// (backend/invoicing/pdf.py): blue headings, yellow double lines, charges on
// the left with amounts on the right, the totals, then the payment
// instructions and the conditions. Labels are Dutch, as on the paper invoice.

import logo from '../../../images/logo.png';
import { formatEuro, formatNumber, formatPercent } from './invoiceMath';
import './InvoiceTemplate.css';

/** "2026-10-07" -> "07-10-2026", the way the paper invoice writes dates. */
function dutchDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

/**
 * @param {{ doc: object }} props  `doc` comes from buildDocument().
 */
export default function InvoiceTemplate({ doc }) {
  const { company, totals } = doc;
  const vatLabel = `Totaal BTW (${formatPercent(doc.vatRate)}${doc.exportVerified ? ' Export' : ''}):`;

  return (
    <article className="pls-sheet" aria-label={`Factuur ${doc.number}`}>
      {/* ---- FACTUUR and the logo ---- */}
      <div className="pls-sheet__top">
        <h1 className="pls-sheet__title">FACTUUR</h1>
        <img className="pls-sheet__logo" src={logo} alt="Pay Less Shop More" />
      </div>

      {/* ---- the customer (left) and our company (right) ---- */}
      <div className="pls-sheet__parties">
        <div className="pls-sheet__customer">
          {doc.billTo.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {doc.phone && <p>Tel: {doc.phone}</p>}
        </div>

        <div>
          <div className="pls-sheet__company">
            <p>{company.name}</p>
            <p>{company.street}</p>
            <p>{company.postcode_city}</p>
          </div>
          <dl className="pls-sheet__facts">
            <dt>KVK</dt>
            <dd>{company.kvk}</dd>
            <dt>BTW</dt>
            <dd>{company.vat}</dd>
            <dt>IBAN</dt>
            <dd>{company.iban}</dd>
            <div className="gap" />
            <dt>E-mail</dt>
            <dd>{company.email}</dd>
            <dt>Website</dt>
            <dd>{company.website}</dd>
            {company.phone && (
              <>
                <dt>Telefoonnummer</dt>
                <dd>{company.phone}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {/* ---- the shipment, in blue-headed columns ---- */}
      <dl className="pls-sheet__grid">
        <div>
          <dt>Factuurnummer</dt>
          <dd>{doc.number}</dd>
        </div>
        <div>
          <dt>Factuurdatum</dt>
          <dd>{dutchDate(doc.dated)}</dd>
        </div>
        <div>
          <dt>Zendingsnummer</dt>
          <dd>{doc.shipmentNumber}</dd>
        </div>
        <div>
          <dt>Relatienummer</dt>
          <dd>{doc.relationNumber}</dd>
        </div>
        <div>
          <dt>Laadhaven</dt>
          <dd>{doc.portOfLoading}</dd>
        </div>
        <div>
          <dt>Loshaven</dt>
          <dd>{doc.portOfDischarge}</dd>
        </div>
        <div className="pls-sheet__goods">
          <dt>Goederen omschrijving</dt>
          <dd>{doc.goodsDescription}</dd>
        </div>
      </dl>

      <hr className="pls-sheet__double" />
      <dl className="pls-sheet__measures">
        <div>
          <dt>Stuks</dt>
          <dd>{doc.pieces}</dd>
        </div>
        <div>
          <dt>Gewicht</dt>
          <dd>
            {formatNumber(doc.weightKg, 'kg')}
            {doc.volumeWeightKg && (
              <span className="pls-sheet__volume-weight">
                Volumegewicht: {formatNumber(doc.volumeWeightKg, 'kg')}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Volume</dt>
          <dd>{formatNumber(doc.volumeM3, 'm³')}</dd>
        </div>
        <div>
          <dt>Ordernummer</dt>
          <dd>{doc.orderNumber}</dd>
        </div>
      </dl>
      <hr className="pls-sheet__double" />

      {/* ---- charges, subtotal and adjustments ---- */}
      <table className="pls-sheet__lines">
        <tbody>
          {doc.charges.map((line) => (
            <tr key={line.key}>
              <td>{line.description}</td>
              <td className="pls-sheet__amount">{formatEuro(line.cents)}</td>
            </tr>
          ))}
          <tr className="pls-sheet__subtotal">
            <td>Subtotaal dienstverlening</td>
            <td className="pls-sheet__amount" data-testid="sheet-subtotal">
              {formatEuro(totals?.subtotal)}
            </td>
          </tr>
          {doc.adjustments.map((line) => (
            <tr key={line.key} className="pls-sheet__adjustment">
              <td>{line.description}</td>
              <td className="pls-sheet__amount">{formatEuro(line.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr className="pls-sheet__double" style={{ marginTop: '3mm' }} />

      {/* ---- the totals ---- */}
      <dl className="pls-sheet__totals">
        <dt>Totaal excl. BTW:</dt>
        <dd data-testid="sheet-total-excl">{formatEuro(totals?.totalExcl)}</dd>
        <dt>{vatLabel}</dt>
        <dd data-testid="sheet-vat">{formatEuro(totals?.vat)}</dd>
        {/* A negative total is money we owe the customer - say so in words. */}
        <dt className="pls-sheet__due">
          {doc.credit ? 'Creditbedrag (te ontvangen):' : 'Totaal te betalen:'}
        </dt>
        <dd className="pls-sheet__due" data-testid="sheet-total">
          {formatEuro(totals?.total)}
        </dd>
      </dl>
      {doc.exportVatNote && <p className="pls-sheet__vat-note">{doc.exportVatNote}</p>}

      {/* ---- payment instructions and conditions (configurable texts) ---- */}
      <section className="pls-sheet__terms">
        <p className="pls-sheet__strong pls-sheet__payment">{doc.paymentInstructions}</p>
        <p>{doc.termsIntro}</p>
        <ul>
          {doc.termsItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="pls-sheet__strong">{doc.exclusionsTitle}</p>
        <ul>
          {doc.exclusionsItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <footer className="pls-sheet__footer">
        {doc.footer.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </footer>
    </article>
  );
}
