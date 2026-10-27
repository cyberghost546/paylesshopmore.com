// src/pages/Dashboard/measure.js
//
// The arithmetic behind the measured lines on an intake sheet, apart from the
// component so it can be tested on its own and so Fast Refresh keeps working.

import { TRANSPORT_TYPES } from '../../utils/volumeWeight';

export const EMPTY_LINE = {
  quantity: '1',
  packaging: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  weight_kg: '',
  note: '',
};

/** A line from the API, as the form holds it: numbers become strings. */
export function toLine(line) {
  const draft = { ...EMPTY_LINE };
  for (const field of Object.keys(EMPTY_LINE)) {
    draft[field] = line[field] === null || line[field] === undefined ? '' : String(line[field]);
  }
  return draft;
}

/** A line as the API wants it: blanks go back as null, not as zero. */
export function toLinePayload(line) {
  const blankToNull = (value) => (String(value).trim() === '' ? null : value);

  return {
    quantity: Number(line.quantity) || 1,
    packaging: line.packaging,
    length_cm: blankToNull(line.length_cm),
    width_cm: blankToNull(line.width_cm),
    height_cm: blankToNull(line.height_cm),
    weight_kg: blankToNull(line.weight_kg),
    note: line.note,
  };
}

/**
 * A typed box as a number, or null while it is blank or not a number yet.
 *
 * Note: unlike the per-line check in utils/volumeWeight.js, this does NOT
 * refuse a size of 0. The totals here follow the server, and the server
 * accepts 0 (see Measurement in backend/warehouse/models.py). So a line with
 * B = 0 says "must be a number above 0" under its boxes, but still counts, as
 * 0 m³, in the totals bar and on the server.
 */
export function number(value) {
  const parsed = Number(String(value).replace(',', '.'));
  return String(value).trim() === '' || Number.isNaN(parsed) ? null : parsed;
}

/** A line counts towards the totals once all four boxes have a number in them. */
export function isComplete(line) {
  return ['length_cm', 'width_cm', 'height_cm', 'weight_kg'].every(
    (field) => number(line[field]) !== null,
  );
}

/**
 * What the lines add up to, from the complete ones only - the same rule as
 * measurement_totals on the server, so the figure on screen is the figure in
 * the e-mail.
 *
 * The volume weight depends on the transport (sea counts 1 m³ as 1000 kg,
 * air as 167 kg - see utils/volumeWeight.js), so it is only worked out when a
 * transport type is given. Without one, `volumetric` stays null.
 *
 * @param {object[]} lines
 * @param {'SEA_LCL'|'AIR'|null} [transportType]
 */
export function totalsFor(lines, transportType = null) {
  const colli = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const complete = lines.filter(isComplete);

  if (complete.length === 0) return { colli, volume: null, weight: null, volumetric: null };

  let volume = 0;
  let weight = 0;
  let volumetric = 0;

  // Every figure is PER ITEM, so each one is multiplied by the line's
  // Aantal: 3 cartons of 10 kg is 30 kg.
  for (const line of complete) {
    const quantity = Number(line.quantity) || 0;
    const cm3 = number(line.length_cm) * number(line.width_cm) * number(line.height_cm);
    volume += (quantity * cm3) / 1_000_000; // cm³ -> m³
    weight += quantity * number(line.weight_kg);
    if (transportType) volumetric += (quantity * cm3) / TRANSPORT_TYPES[transportType].cm3PerKg;
  }

  return { colli, volume, weight, volumetric: transportType ? volumetric : null };
}
