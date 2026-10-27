// src/pages/Dashboard/invoice/ChargesSection.jsx
//
// STEP 4: THE CHARGES - one line per service, each with an amount.
//
// The buttons at the top are the charge types from the invoice settings page,
// filtered by shipping method: a sea-only charge such as Bunkertoeslag is not
// offered on an air freight invoice. "+ Andere kosten" adds an empty line for
// anything not on the list.
//
// Three kinds of line live in form.lines (see InvoiceLine on the server):
//
//   charge      typed here; never negative
//   insurance   shown here, but its wording and amount come from step 5
//   adjustment  "Contractuele verrekening" - printed UNDER the subtotal, may
//               be negative or positive, and only an admin may add or change
//               one (the server refuses anyone else)

import { newLine } from './invoiceForm';
import { formatEuro } from './invoiceMath';
import { useInvoiceText } from './useInvoiceText';

export default function ChargesSection({ form, update, errors, lineErrors, disabled, config, computed }) {
  const tr = useInvoiceText();
  const canAdjust = config.permissions.can_adjust;
  const offered = config.charge_types.filter(
    (charge) => charge.active && (charge.freight === form.freight || charge.freight === 'both'),
  );
  // The worked-out wording and amount of each line (insurance included).
  const shown = Object.fromEntries(computed.lines.map((line) => [line.key, line]));

  const charges = form.lines.filter((line) => line.kind !== 'adjustment');
  const adjustments = form.lines.filter((line) => line.kind === 'adjustment');

  function setLines(lines) {
    update({ lines });
  }

  function addCharge(charge) {
    // A default amount from the settings uses the Dutch decimal comma.
    const amount = charge?.default_amount ? String(charge.default_amount).replace('.', ',') : '';
    setLines([...form.lines, newLine('charge', charge?.name ?? '', amount)]);
  }

  function changeLine(key, changes) {
    setLines(form.lines.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  }

  /** Move a line one place up (-1) or down (+1) among lines of its own kind. */
  function moveLine(key, step) {
    const lines = [...form.lines];
    const index = lines.findIndex((line) => line.key === key);
    const isAdjustment = lines[index].kind === 'adjustment';
    let target = index + step;
    // Skip over lines of the other group, so charges and adjustments stay apart.
    while (lines[target] && (lines[target].kind === 'adjustment') !== isAdjustment) target += step;
    if (!lines[target]) return;
    [lines[index], lines[target]] = [lines[target], lines[index]];
    setLines(lines);
  }

  function removeLine(key) {
    setLines(form.lines.filter((line) => line.key !== key));
  }

  function lineRow(line, position, group) {
    const isInsurance = line.kind === 'insurance';
    const isAdjustment = line.kind === 'adjustment';
    // Office staff see an admin's adjustment, but cannot change it.
    const locked = disabled || (isAdjustment && !canAdjust);
    const error = lineErrors[line.key];
    // "Charge 2" or "Adjustment 1", for screen readers and tests.
    const name = tr(isAdjustment ? 'charges.adjustment' : 'charges.charge', { n: position });

    return (
      <div key={line.key} className="charge-row py-2">
        <div className="row g-2 align-items-center">
          <div className="col-12 col-md-7">
            <input
              className={`form-control form-control-sm${error ? ' is-invalid' : ''}`}
              aria-label={`${name} ${tr('charges.description')}`}
              placeholder={isAdjustment ? 'Contractuele verrekening conform overeenkomst' : tr('charges.descriptionPlaceholder')}
              value={isInsurance ? shown[line.key]?.description ?? '' : line.description}
              readOnly={isInsurance}
              disabled={locked}
              maxLength={300}
              onChange={(event) => changeLine(line.key, { description: event.target.value })}
            />
          </div>
          <div className="col-7 col-md-3">
            <div className="input-group input-group-sm">
              <span className="input-group-text">€</span>
              <input
                className={`form-control money-input${error ? ' is-invalid' : ''}`}
                aria-label={`${name} ${tr('charges.amount')}`}
                inputMode="decimal"
                placeholder={isAdjustment ? '-0,00' : '0,00'}
                value={isInsurance ? formatEuro(shown[line.key]?.cents).replace('€ ', '') : line.amount}
                readOnly={isInsurance}
                disabled={locked}
                onChange={(event) => changeLine(line.key, { amount: event.target.value })}
              />
            </div>
          </div>
          <div className="col-5 col-md-2 text-end text-nowrap">
            <div className="btn-group btn-group-sm" role="group" aria-label={tr('charges.moveGroup')}>
              <button type="button" className="btn btn-outline-secondary" aria-label={tr('charges.moveUp')} disabled={locked || position === 1} onClick={() => moveLine(line.key, -1)}>
                ↑
              </button>
              <button type="button" className="btn btn-outline-secondary" aria-label={tr('charges.moveDown')} disabled={locked || position === group.length} onClick={() => moveLine(line.key, 1)}>
                ↓
              </button>
              <button type="button" className="btn btn-outline-danger" aria-label={tr('charges.remove')} disabled={locked} onClick={() => removeLine(line.key)}>
                ✕
              </button>
            </div>
          </div>
        </div>
        {isInsurance && <div className="form-text">{tr('charges.insuranceNote')}</div>}
        {error && <div className="invalid-feedback d-block">{error}</div>}
      </div>
    );
  }

  return (
    <section aria-labelledby="charges-title" className="mb-4">
      <h2 id="charges-title" className="invoice-section-title">
        {tr('charges.title', { method: tr(form.freight === 'air' ? 'charges.air' : 'charges.sea') })}
      </h2>

      {!disabled && (
        <div className="d-flex flex-wrap gap-2 mb-3" aria-label={tr('charges.addLabel')}>
          {offered.map((charge) => (
            <button key={charge.id} type="button" className="btn btn-sm btn-outline-primary" onClick={() => addCharge(charge)}>
              + {charge.name}
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => addCharge(null)}>
            {tr('charges.other')}
          </button>
        </div>
      )}

      {errors.lines && <div className="alert alert-warning py-2 small">{errors.lines}</div>}
      {charges.map((line, index) => lineRow(line, index + 1, charges))}

      <h3 className="h6 mt-4">{tr('charges.adjustTitle')}</h3>
      <p className="small text-muted mb-2">
        {tr('charges.adjustIntro')}
        {!canAdjust && tr('charges.adjustAdminOnly')}
      </p>
      {adjustments.map((line, index) => lineRow(line, index + 1, adjustments))}
      {canAdjust && !disabled && (
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setLines([...form.lines, newLine('adjustment')])}>
          {tr('charges.addAdjustment')}
        </button>
      )}
    </section>
  );
}
