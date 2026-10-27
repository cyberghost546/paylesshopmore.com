// src/pages/Dashboard/invoice/InsuranceSection.jsx
//
// STEP 5: INSURANCE.
//
// Switching insurance on adds one "Verzekering (...)" line to the charges.
// Its wording is written for you from the two values below:
//
//   "Verzekering (verzekerde waarde € 8.390,00 - eigen risico € 250,00)"
//
// The premium (the amount on that line):
//   - If an admin has set an insurance rate on the settings page, it is
//     calculated: insured value x rate, but at least the minimum. The field
//     is then read-only.
//   - If no rate is set, the employee types it. We never make up a rate.

import { insuranceDescription, newLine } from './invoiceForm';
import { formatEuro, formatPercent } from './invoiceMath';
import { Field } from './ui';
import { useInvoiceText } from './useInvoiceText';

function MoneyField({ label, value, onChange, error, hint, disabled, readOnly }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(props) => (
        <div className="input-group">
          <span className="input-group-text">€</span>
          <input
            {...props}
            className={`${props.className} money-input`}
            inputMode="decimal"
            value={value}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      )}
    </Field>
  );
}

export default function InsuranceSection({ form, update, errors, disabled, config, computed }) {
  const tr = useInvoiceText();
  const insured = form.lines.some((line) => line.kind === 'insurance');
  const rate = config.settings.insurance_rate_percent;
  const { insurance } = computed;

  function toggle(on) {
    if (on) {
      // Put the insurance line just before "Handling Fee" when there is one -
      // that is where it sits on the paper invoice - otherwise at the end.
      const lines = [...form.lines];
      const handling = lines.findIndex((line) => /handling fee/i.test(line.description));
      const at = handling === -1 ? lines.filter((l) => l.kind !== 'adjustment').length : handling;
      lines.splice(at, 0, newLine('insurance'));
      update({ lines });
    } else {
      update({ lines: form.lines.filter((line) => line.kind !== 'insurance') });
    }
  }

  return (
    <section aria-labelledby="insurance-title" className="mb-4">
      <h2 id="insurance-title" className="invoice-section-title">
        {tr('insurance.title')}
      </h2>

      <div className="form-check form-switch mb-3">
        <input
          id="with-insurance"
          className="form-check-input"
          type="checkbox"
          role="switch"
          checked={insured}
          disabled={disabled}
          onChange={(event) => toggle(event.target.checked)}
        />
        <label className="form-check-label" htmlFor="with-insurance">
          {tr('insurance.toggle')}
        </label>
      </div>

      {insured && (
        <>
          <div className="row g-3">
            <div className="col-md-4">
              <MoneyField
                label={tr('insurance.insuredValue')}
                value={form.insured_value}
                error={errors.insured_value}
                disabled={disabled}
                onChange={(value) => update({ insured_value: value })}
              />
            </div>
            <div className="col-md-4">
              <MoneyField
                label={tr('insurance.ownRisk')}
                value={form.own_risk}
                error={errors.own_risk}
                disabled={disabled}
                onChange={(value) => update({ own_risk: value })}
              />
            </div>
            <div className="col-md-4">
              {rate !== null && rate !== '' ? (
                <MoneyField
                  label={tr('insurance.premiumCalculated')}
                  value={formatEuro(insurance.feeCents).replace('€ ', '')}
                  readOnly
                  disabled={disabled}
                  hint={`${tr('insurance.rateHint', { rate: formatPercent(rate) })}${
                    config.settings.insurance_minimum
                      ? tr('insurance.minimumHint', { minimum: String(config.settings.insurance_minimum).replace('.', ',') })
                      : ''
                  }.`}
                  onChange={() => {}}
                />
              ) : (
                <MoneyField
                  label={tr('insurance.premium')}
                  value={form.insurance_fee}
                  error={errors.insurance_fee}
                  hint={tr('insurance.manualHint')}
                  disabled={disabled}
                  onChange={(value) => update({ insurance_fee: value })}
                />
              )}
            </div>
          </div>
          <p className="small text-muted mb-0">
            {tr('insurance.onInvoice')} <em>{insuranceDescription(insurance.insuredCents, insurance.ownRiskCents)}</em>
          </p>
        </>
      )}
    </section>
  );
}
