// src/pages/Dashboard/invoice/MeasurementCalculator.jsx
//
// THE BOX CALCULATOR: works out volume and volume weight from measured boxes.
//
// One row per box SIZE. Two identical pallets are one row with "Aantal: 2",
// not two rows.
//
// It shows three different numbers - and they really are different:
//
//   Werkelijk gewicht  what the scale says. Typed in the shipment section,
//                      not calculated here.
//   Volume (m³)        how much space the boxes take. Sea freight is priced
//                      on this.
//   Volumegewicht      L x B x H (cm) / 6000 per box. Air freight is priced
//                      on this, or on the actual weight if that is higher.
//
// The sums are in invoiceMath.measurePackages(); this component only shows
// the inputs and the result.

import { chargeableWeight, formatNumber, measurePackages } from './invoiceMath';
import { newMeasurement } from './invoiceForm';
import { useInvoiceText } from './useInvoiceText';

// Each box side: the form field, and its label in invoiceTranslations.js.
const SIDES = [
  ['length_cm', 'calculator.length'],
  ['width_cm', 'calculator.width'],
  ['height_cm', 'calculator.height'],
];

export default function MeasurementCalculator({ form, update, error, disabled }) {
  const tr = useInvoiceText();
  const measured = measurePackages(form.measurements);
  const weight = form.weight_kg.replace(',', '.');

  function changeRow(key, changes) {
    update({
      measurements: form.measurements.map((row) => (row.key === key ? { ...row, ...changes } : row)),
    });
  }

  return (
    <div className="border rounded p-3 mb-3 bg-light">
      <p className="small text-muted mb-2">
        {tr('calculator.intro')}
      </p>

      {form.measurements.map((row, index) => (
        <div key={row.key} className="row g-2 align-items-end mb-2">
          {SIDES.map(([name, label]) => (
            <div key={name} className="col-6 col-md-3">
              <label className="form-label small mb-1" htmlFor={`m-${row.key}-${name}`}>
                {tr(label)}
              </label>
              <input
                id={`m-${row.key}-${name}`}
                className="form-control form-control-sm"
                inputMode="decimal"
                value={row[name]}
                disabled={disabled}
                onChange={(event) => changeRow(row.key, { [name]: event.target.value })}
              />
            </div>
          ))}
          <div className="col-4 col-md-2">
            <label className="form-label small mb-1" htmlFor={`m-${row.key}-count`}>
              {tr('calculator.count')}
            </label>
            <input
              id={`m-${row.key}-count`}
              className="form-control form-control-sm"
              inputMode="numeric"
              value={row.count}
              disabled={disabled}
              onChange={(event) => changeRow(row.key, { count: event.target.value })}
            />
          </div>
          <div className="col-2 col-md-1">
            <button
              type="button"
              className="btn btn-sm btn-outline-danger w-100"
              aria-label={tr('calculator.removeBox', { n: index + 1 })}
              disabled={disabled || form.measurements.length === 1}
              onClick={() => update({ measurements: form.measurements.filter((r) => r.key !== row.key) })}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-sm btn-outline-primary mb-3"
        disabled={disabled}
        onClick={() => update({ measurements: [...form.measurements, newMeasurement()] })}
      >
        {tr('calculator.addBox')}
      </button>

      {error && <div className="text-danger small mb-2">{error}</div>}

      {/* The three numbers, labelled so nobody mixes them up. */}
      <dl className="row small mb-0" aria-label={tr('calculator.result')}>
        <dt className="col-7 col-md-4">{tr('calculator.pieces')}</dt>
        <dd className="col-5 col-md-2 mb-1">{measured.pieces}</dd>
        <dt className="col-7 col-md-4">{tr('calculator.volume')}</dt>
        <dd className="col-5 col-md-2 mb-1" data-testid="calc-volume">
          {formatNumber(measured.volumeM3, 'm³')}
        </dd>
        <dt className="col-7 col-md-4">{tr('calculator.volumeWeight')}</dt>
        <dd className="col-5 col-md-2 mb-1" data-testid="calc-volume-weight">
          {formatNumber(measured.volumeWeightKg, 'kg')}
        </dd>
        <dt className="col-7 col-md-4">{tr('calculator.actualWeight')}</dt>
        <dd className="col-5 col-md-2 mb-1">{formatNumber(weight, 'kg') || '—'}</dd>
        {form.freight === 'air' && (
          <>
            <dt className="col-7 col-md-4">{tr('calculator.chargeable')}</dt>
            <dd className="col-5 col-md-2 mb-1 fw-bold">
              {formatNumber(chargeableWeight(weight, measured.volumeWeightKg), 'kg') || '—'}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
