// src/pages/Dashboard/Measurements.jsx
//
// The measured lines on an intake sheet: so many items of one size and
// weight, a line each, with the totals worked out while somebody types.
//
// Built for a tape measure in one hand. The number boxes open the numeric
// keypad, a line is copied with one tap when the next box is the same as the
// last, and nothing is refused while typing - the warnings below a line say
// "that looks wrong" and leave the decision with the person holding the box.

import { INTAKE_PACKAGING } from '../../api/staff';
import {
  TRANSPORT_TYPES,
  calculateFreightWeight,
  transportTypeForFreight,
  volumeCm3,
  volumeM3,
  volumeWeightKg,
} from '../../utils/volumeWeight';
import { EMPTY_LINE, number, totalsFor } from './measure';
import styles from './Dashboard.module.css';
import { labelFor, usePageText } from './usePageText';

const DIMENSIONS = [
  ['length_cm', 'length'],
  ['width_cm', 'width'],
  ['height_cm', 'height'],
];

/**
 * "That looks wrong" for a line, or nothing. Typos, not rules: 1500 where
 * somebody meant 150, or a pallet that weighs less than the pallet does.
 */
function warningsFor(line, d) {
  const warnings = [];
  const sizes = DIMENSIONS.map(([field]) => number(line[field])).filter((v) => v !== null);
  const weight = number(line.weight_kg);

  if (sizes.some((size) => size > 300)) {
    warnings.push(d('warnOver3m'));
  }
  if (sizes.some((size) => size > 0 && size < 1)) {
    warnings.push(d('warnUnder1cm'));
  }
  if (weight !== null && weight > 1500) {
    warnings.push(d('warnOver1500'));
  }
  if (line.packaging === 'pallet' && weight !== null && weight < 5) {
    warnings.push(d('warnLightPallet'));
  }

  return warnings;
}

// The labels on the boxes, for "fill in B" style messages.
// The keys are the names calculateFreightWeight() uses in `missing` and
// `invalid`; the values are what the worker sees above each box.

/**
 * A number for the screen, the Dutch way: a decimal comma and always the same
 * number of decimals, so a column of figures lines up.
 *
 *   format(10, 2)      -> "10,00"
 *   format(0.168, 3)   -> "0,168"
 *   format(null, 2)    -> "—"   (nothing to show yet)
 */
function format(value, digits) {
  return value === null ? '—' : value.toLocaleString('nl-NL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Actual weight, volume, volume weight and chargeable weight for ONE item on
 * a line, shown under its boxes. The maths lives in utils/volumeWeight.js;
 * this only shows it.
 *
 * The volume weight depends on the Transportwijze chosen higher up the sheet:
 * Zeevracht counts 1 m³ as 1000 kg, Luchtvracht as 167 kg. So:
 *
 * - Nothing at all while the line is still empty.
 * - The volume (m³) as soon as L, B and H are filled in. It is the same for
 *   every transport, so it shows even before a transport is chosen.
 * - The volume weight once a transport is chosen too.
 * - Actual and chargeable weight once Kg is filled in as well.
 * - A hint saying what is still missing or wrong, until everything is there.
 *
 * @param {{ line: object, transportType: 'SEA_LCL'|'AIR'|null }} props
 */
function LineWeights({ line, transportType }) {
  const d = usePageText('measurements');
  // Has the worker typed anything in the four boxes yet? `.some()` is true as
  // soon as ONE box is not empty. A brand-new line shows nothing at all, so
  // the form doesn't start by nagging "fill in L, B, H and Kg".
  const typed = ['length_cm', 'width_cm', 'height_cm', 'weight_kg'].some(
    (field) => String(line[field]).trim() !== '',
  );
  if (!typed) return null;

  // Let the shared function check and calculate. The boxes hold strings
  // ("50", "12,5"), and the function turns them into numbers itself. With no
  // transport chosen yet it still runs (as sea - which one doesn't matter
  // here) to CHECK the boxes; its weights are not shown in that case.
  const result = calculateFreightWeight(transportType ?? 'SEA_LCL', {
    length: line.length_cm,
    width: line.width_cm,
    height: line.height_cm,
    actualWeight: line.weight_kg,
  });

  // Which boxes are holding things up. When result.ok, there are none.
  const missing = result.ok ? [] : result.missing;
  const invalid = result.ok ? [] : result.invalid;
  // Are L, B and H all fine? They are if every problem (if any) is the
  // weight. Example: missing = ['actualWeight'] -> sizes OK, only Kg to go.
  //          missing = ['height', 'actualWeight'] -> sizes not OK yet.
  const sizesOk = ![...missing, ...invalid].some((field) => field !== 'actualWeight');

  // Not even the sizes yet: only the hint.
  if (!sizesOk) return <LineHint missing={missing} invalid={invalid} transportType={transportType} />;

  // The sizes are good, so the volume can be worked out now, with or without
  // a weight. `...sizes` spreads the array into three arguments:
  // volumeCm3(...[50, 40, 30]) is the same as volumeCm3(50, 40, 30).
  const sizes = [number(line.length_cm), number(line.width_cm), number(line.height_cm)];
  const cm3 = volumeCm3(...sizes);
  const m3 = volumeM3(...sizes);
  // The volume weight needs a transport type; null until one is chosen.
  const volumeKg = transportType ? volumeWeightKg(...sizes, transportType) : null;
  // Actual and chargeable need the weight AND a transport type.
  const complete = result.ok && transportType !== null;

  // 50 x 40 x 30 cm, without needless ",0"s.
  const size = sizes.map((value) => value.toLocaleString('nl-NL', { maximumFractionDigits: 1 })).join(' × ');

  // A <dl> (description list) is the HTML for "label: value" pairs: <dt> is
  // the label, <dd> the value. Screen readers read it as pairs too.
  // Anything that can't be worked out yet shows "—".
  return (
    <>
      <dl className={styles.measureResult} aria-label={d('weightsPerItem')}>
        <div>
          <dt>{d('dimensions')}</dt>
          <dd>{size} cm</dd>
        </div>
        <div>
          <dt>{d('actualWeight')}</dt>
          <dd>{result.ok ? `${format(result.actualWeight, 2)} kg` : '—'}</dd>
        </div>
        <div>
          <dt>{d('volume')}</dt>
          <dd>
            {format(m3, 3)} m³
            <small className={styles.measureResultSub}>
              {Math.round(cm3).toLocaleString('nl-NL')} cm³
            </small>
          </dd>
        </div>
        <div>
          <dt>{d('volumeWeight')}</dt>
          <dd>
            {volumeKg === null ? '—' : `${format(volumeKg, 2)} kg`}
            {/* Which rule was used, so nobody wonders why sea and air differ. */}
            {transportType && (
              <small className={styles.measureResultSub}>
                {labelFor(d, 'transport', transportType, TRANSPORT_TYPES[transportType].label)}:{' '}
                {TRANSPORT_TYPES[transportType].rule}
              </small>
            )}
          </dd>
        </div>
        <div className={styles.measureResultCharge}>
          <dt>{d('chargeableWeight')}</dt>
          <dd>
            {complete ? (
              <>
                {format(result.chargeableWeight, 2)} kg
                <small>{result.chargedBy === 'volume' ? d('byVolume') : d('byActual')}</small>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
      {!complete && <LineHint missing={missing} invalid={invalid} transportType={transportType} />}
    </>
  );
}

/**
 * What is still holding a line up, in one sentence:
 *   "B: must be a number above 0."
 *   "Fill in H to see the volume."
 *   "Choose a freight (sea or air) to see the volume weight."
 */
function LineHint({ missing, invalid, transportType }) {
  const d = usePageText('measurements');
  // ['height', 'actualWeight'] -> "H, Kg"
  const names = (fields) => fields.map((field) => d(`dim.${field}`)).join(', ');
  // A size may not be 0; a weight may (see calculateFreightWeight).
  const badSizes = invalid.filter((field) => field !== 'actualWeight');
  const badWeight = invalid.includes('actualWeight');
  const sizeMissing = missing.some((field) => field !== 'actualWeight');

  // Say the most useful thing first: fix what is wrong, then fill in what is
  // missing, then choose the transport.
  const parts = [];
  if (badSizes.length > 0) parts.push(d('badSize', { fields: names(badSizes) }));
  if (badWeight) parts.push(d('badWeight'));
  if (missing.length > 0) {
    parts.push(d(sizeMissing ? 'fillForVolume' : 'fillForChargeable', { fields: names(missing) }));
  }
  if (!transportType) {
    parts.push(d('chooseFreight'));
  }

  return <p className={styles.measureResultHint}>{parts.join(' ')}</p>;
}

/**
 * @param {{ lines: object[], onChange: (lines: object[]) => void,
 *           freight: string, declaredWeight: string|null, disabled: boolean }} props
 */
export default function Measurements({ lines, onChange, freight, declaredWeight, disabled }) {
  const d = usePageText('measurements');
  const intake = usePageText('intake');
  // The sheet's Transportwijze ('sea' / 'air' / '') as the calculation's
  // transport type ('SEA_LCL' / 'AIR' / null). Picking another option in the
  // dropdown re-renders this component, so every figure follows at once.
  const transportType = transportTypeForFreight(freight);
  const totals = totalsFor(lines, transportType);

  // The lines belong to the parent (Intake.jsx), so this component never
  // changes them itself. It builds a NEW array with the change in it and
  // hands that to onChange. React only notices a change when it gets a new
  // array, not when an old one is edited in place.
  function update(index, field, value) {
    onChange(lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  }

  function add() {
    onChange([...lines, { ...EMPTY_LINE }]);
  }

  // The commonest case on the floor: the next carton is the same as the last.
  function duplicate(index) {
    const copy = { ...lines[index], note: '' };
    onChange([...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)]);
  }

  function remove(index) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <div className={styles.measureBlock}>
      {lines.length === 0 && (
        <p className={styles.intakeHint}>{d('nothingYet')}</p>
      )}

      {lines.map((line, index) => {
        const warnings = warningsFor(line, d);

        return (
          // Position as the key: lines have no id until they are saved, and
          // the list is only ever edited here, in order.
          <div key={index} className={styles.measureLine}>
            <div className={styles.measureTop}>
              <label className={styles.measureQty}>
                <span className={styles.intakeLabel}>{d('quantity')}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  className={styles.intakeInput}
                  value={line.quantity}
                  onChange={(event) => update(index, 'quantity', event.target.value)}
                />
              </label>

              <label className={styles.measureKind}>
                <span className={styles.intakeLabel}>{d('kind')}</span>
                <select
                  className={styles.intakeInput}
                  value={line.packaging}
                  onChange={(event) => update(index, 'packaging', event.target.value)}
                >
                  <option value="">—</option>
                  {INTAKE_PACKAGING.map((option) => (
                    <option key={option.value} value={option.value}>
                      {labelFor(intake, 'packaging', option.value, option.label)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.measureSizes}>
              {DIMENSIONS.map(([field, dimension]) => (
                <label key={field} className={styles.measureSize}>
                  <span className={styles.intakeLabel}>{d(`dim.${dimension}`)} (cm)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.1"
                    className={styles.intakeInput}
                    value={line[field]}
                    onChange={(event) => update(index, field, event.target.value)}
                  />
                </label>
              ))}
              <label className={styles.measureSize}>
                <span className={styles.intakeLabel}>{d('kgPerItem')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className={styles.intakeInput}
                  value={line.weight_kg}
                  onChange={(event) => update(index, 'weight_kg', event.target.value)}
                />
              </label>
            </div>

            <input
              className={styles.intakeInput}
              value={line.note}
              onChange={(event) => update(index, 'note', event.target.value)}
              placeholder={d('notePlaceholder')}
              aria-label={d('note')}
            />

            <LineWeights line={line} transportType={transportType} />

            {warnings.map((warning) => (
              <p key={warning} className={styles.measureWarning}>
                {warning}
              </p>
            ))}

            {!disabled && (
              <div className={styles.measureButtons}>
                <button
                  type="button"
                  className={styles.rowButton}
                  onClick={() => duplicate(index)}
                >
                  {d('duplicate')}
                </button>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => remove(index)}
                >
                  {d('remove')}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {!disabled && (
        <button type="button" className={styles.scanSecondary} onClick={add}>
          {d('addLine')}
        </button>
      )}

      <div className={styles.measureTotals} aria-live="polite">
        <span>
          <strong>{totals.colli}</strong> {d('colli')}
        </span>
        <span>
          <strong>{format(totals.volume, 3)}</strong> m³
        </span>
        <span>
          <strong>{format(totals.weight, 1)}</strong> kg
        </span>
        {/* Chargeable weight for the whole sheet, by the rule of the chosen
            transport. Before a transport is chosen there is no volume
            weight, so nothing to compare. */}
        {transportType && totals.volumetric !== null && (
          <span>
            <strong>{format(Math.max(totals.weight, totals.volumetric), 1)}</strong> kg
            {d('chargeable', {
              transport: labelFor(d, 'transport', transportType, TRANSPORT_TYPES[transportType].label),
            })}{' '}
            {format(totals.volumetric, 1)} kg
          </span>
        )}
        {declaredWeight !== null && declaredWeight !== undefined && (
          <span className={styles.measureDeclared}>
            {d('declared', { weight: format(Number(declaredWeight), 1) })}
          </span>
        )}
      </div>
    </div>
  );
}
