// src/pages/Dashboard/invoice/SummarySection.jsx
//
// STEP 6: VAT AND THE FINANCIAL SUMMARY.
//
// The totals update by themselves on every keystroke: they are worked out by
// computeInvoice() (invoiceForm.js) each time the editor renders.
//
// VAT: 0% applies only when somebody ticks "export verified" - i.e. has
// checked the goods really leave the EU. Without that tick, the standard
// rate applies. Both rates are set by an admin on the settings page; nothing
// here assumes 0%.

import { formatEuro, formatPercent, isCredit } from './invoiceMath';
import { useInvoiceText } from './useInvoiceText';

export default function SummarySection({ form, update, disabled, config, computed, serverCheck }) {
  const tr = useInvoiceText();
  const { totals, vatRate } = computed;
  const credit = totals ? isCredit(totals.total) : false;
  const { settings } = config;

  return (
    <section aria-labelledby="summary-title" className="mb-4">
      <h2 id="summary-title" className="invoice-section-title">
        {tr('summary.title')}
      </h2>

      <div className="form-check mb-3">
        <input
          id="export-verified"
          className="form-check-input"
          type="checkbox"
          checked={form.export_verified}
          disabled={disabled}
          onChange={(event) => update({ export_verified: event.target.checked })}
        />
        <label className="form-check-label" htmlFor="export-verified">
          {tr('summary.exportCheck', { rate: formatPercent(settings.export_vat_rate) })}
        </label>
        <div className="form-text">
          {tr('summary.standardHint', { rate: formatPercent(settings.standard_vat_rate) })}
        </div>
      </div>

      <table className="table table-sm summary-table mb-2" aria-label={tr('summary.tableLabel')}>
        <tbody>
          <tr>
            <th scope="row" className="fw-semibold">{tr('summary.subtotal')}</th>
            <td className="text-end" data-testid="summary-subtotal">{formatEuro(totals?.subtotal)}</td>
          </tr>
          <tr>
            <th scope="row" className="fw-normal">{tr('summary.adjustments')}</th>
            <td className="text-end" data-testid="summary-adjustments">{formatEuro(totals?.adjustments)}</td>
          </tr>
          <tr>
            <th scope="row" className="fw-normal">{tr('summary.totalExcl')}</th>
            <td className="text-end" data-testid="summary-total-excl">{formatEuro(totals?.totalExcl)}</td>
          </tr>
          <tr>
            <th scope="row" className="fw-normal">
              {tr('summary.vat', {
                rate: formatPercent(vatRate),
                export: form.export_verified ? tr('summary.exportWord') : '',
              })}
            </th>
            <td className="text-end" data-testid="summary-vat">{formatEuro(totals?.vat)}</td>
          </tr>
          <tr className={credit ? 'table-warning' : 'table-light'}>
            <th scope="row">{tr(credit ? 'summary.credit' : 'summary.due')}</th>
            <td className={`text-end fw-bold ${credit ? 'text-danger' : ''}`} data-testid="summary-total">
              {formatEuro(totals?.total)}
            </td>
          </tr>
        </tbody>
      </table>

      {!totals && <p className="small text-muted">{tr('summary.incomplete')}</p>}
      {credit && (
        <p className="small text-danger mb-2">{tr('summary.creditNote')}</p>
      )}

      {/* The result of "Bereken factuur": did the server get the same totals? */}
      {serverCheck?.state === 'match' && (
        <div className="alert alert-success py-2 small" role="status">
          {tr('summary.checkMatch')}
        </div>
      )}
      {serverCheck?.state === 'mismatch' && (
        <div className="alert alert-danger py-2 small" role="alert">
          {tr('summary.checkMismatch', { detail: serverCheck.detail })}
        </div>
      )}
    </section>
  );
}
