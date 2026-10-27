// src/utils/volumeWeight.js
//
// Volume, volume weight and chargeable weight: the ONE place in the frontend
// where this is worked out. No React here, so any page (the intake sheet, the
// calculator, the warehouse measurements, later the measurement camera and
// the scale) can import and reuse it.
//
// WHAT IS VOLUME WEIGHT? (the short version)
// ------------------------------------------
// A ship or a plane fills up by SPACE as much as by weight. A big box of
// pillows is light, but it takes the place of a heavy box. So carriers
// pretend a box weighs what its size "should" weigh, and call that the volume
// weight (Dutch: volumegewicht). The customer then pays for whichever is
// HIGHER, the real weight or the volume weight. That is the chargeable weight.
//
// HOW MUCH a cubic metre "should" weigh depends on the transport:
//
//   ZEEVRACHT (sea, LCL)   1 m³ counts as 1000 kg     volume weight = cm³ / 1000
//   LUCHTVRACHT (air)      1 m³ counts as  167 kg     volume weight = cm³ / 6000
//
// Example, a pallet of 120 x 80 x 50 cm = 480,000 cm³ = 0.48 m³:
//
//   by sea:  480,000 / 1000 = 480 kg      by air:  480,000 / 6000 = 80 kg
//
// Same pallet, very different numbers - so ALWAYS say which transport you are
// calculating for. That is what `transportType` is for.
//
// LCL means "less than container load": the goods share a container with
// other customers' goods. Full containers (FCL) are priced per container, not
// per kg, so they have no volume weight and are not here.
//
// The server uses the same numbers (VOLUMETRIC_DIVISORS in
// backend/warehouse/models.py). If one ever changes, change it in BOTH places,
// or the figure on screen and the figure in the e-mail will disagree.

/**
 * The transport methods we can calculate for, and their rule.
 *
 * `cm3PerKg` is how many cm³ count as 1 kg. To add a transport method later
 * (road freight, say), add an entry here - the functions below need no change.
 */
export const TRANSPORT_TYPES = {
  SEA_LCL: {
    label: 'Zeevracht (LCL)',
    cm3PerKg: 1000, // 1 m³ = 1,000,000 cm³ / 1000 = 1000 kg  (1 m³ = 1 tonne)
    rule: '1 m³ = 1000 kg',
  },
  AIR: {
    label: 'Luchtvracht',
    cm3PerKg: 6000, // the IATA standard: 1 m³ = 1,000,000 / 6000 ≈ 167 kg
    rule: '1 m³ = 167 kg',
  },
};

/** The air freight divisor on its own. Older code (the shipping calculator) imports it by this name. */
export const VOLUMETRIC_DIVISOR = TRANSPORT_TYPES.AIR.cm3PerKg;

/** cm³ in one m³: a cube of 100 x 100 x 100 cm. */
export const CM3_PER_M3 = 1_000_000;

/**
 * The intake sheet's Transportwijze ('sea' / 'air', as the server stores it)
 * as a transport type, or null when none is chosen yet.
 *
 * @param {string} freight  'sea', 'air' or ''
 * @returns {'SEA_LCL'|'AIR'|null}
 */
export function transportTypeForFreight(freight) {
  if (freight === 'sea') return 'SEA_LCL';
  if (freight === 'air') return 'AIR';
  return null;
}

/**
 * A typed value as a number, or null if it is blank or not a number.
 *
 * Form inputs give us STRINGS ("12,5", "", "abc"), not numbers. A comma is
 * accepted as a decimal point, because in Dutch 12,5 means 12.5.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
export function toNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rounds to 2 decimals, for showing: 10.004 -> 10. Keep the unrounded number for adding up. */
export function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Rounds to 3 decimals: how m³ (CBM) is shown. 0.4801 -> 0.48 */
export function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * The space ONE package takes up, in cm³ (cubic centimetres).
 *
 *   50 x 40 x 30 cm = 60,000 cm³
 *
 * @returns {number}
 */
export function volumeCm3(lengthCm, widthCm, heightCm) {
  return lengthCm * widthCm * heightCm;
}

/**
 * The same space in m³ (cubic metres, "kuub", or CBM: cubic metre), the unit
 * freight is priced in. Divide by 1,000,000, because one m³ holds
 * 100 x 100 x 100 = 1,000,000 cm³.
 *
 *   120 x 80 x 50 = 480,000 cm³ / 1,000,000 = 0.48 m³
 *
 * @returns {number} unrounded
 */
export function volumeM3(lengthCm, widthCm, heightCm) {
  return volumeCm3(lengthCm, widthCm, heightCm) / CM3_PER_M3;
}

/**
 * Volume weight in kg for ONE package, unrounded.
 *
 *   volumeWeightKg(120, 80, 50, 'SEA_LCL')  -> 480   (480,000 / 1000)
 *   volumeWeightKg(120, 80, 50, 'AIR')      -> 80    (480,000 / 6000)
 *
 * @param {number} lengthCm
 * @param {number} widthCm
 * @param {number} heightCm
 * @param {'SEA_LCL'|'AIR'} [transportType]  defaults to 'AIR', which is what this function did before sea was added
 * @returns {number}
 */
export function volumeWeightKg(lengthCm, widthCm, heightCm, transportType = 'AIR') {
  const { cm3PerKg } = TRANSPORT_TYPES[transportType];
  return volumeCm3(lengthCm, widthCm, heightCm) / cm3PerKg;
}

/**
 * The chargeable weight: the higher of the real weight and the volume weight.
 *
 * @param {number} actualKg
 * @param {number} volumeKg
 * @returns {number}
 */
export function chargeableWeightKg(actualKg, volumeKg) {
  return Math.max(actualKg, volumeKg);
}

/**
 * Everything at once, straight from what was typed in a form (or, later,
 * what the camera and the scale send) - with the checks. This is the
 * function most screens want.
 *
 * THE CHECKS
 *   length, width, height  must be a number ABOVE 0   (a box has a size)
 *   actualWeight           must be a number, 0 or more (0 is allowed: the
 *                          volume weight then decides the charge)
 *
 * A missing or invalid value means no calculation at all (`ok: false`),
 * because half a calculation is worse than none: 0 m³ looks like a real
 * answer, and would be charged. `missing` lists the fields still empty,
 * `invalid` the ones filled in wrongly, so the screen can say which to fix.
 *
 * ROUNDING
 *   length, width, height, actualWeight  returned exactly as given (the
 *                                        originals, so the sum can be redone)
 *   cbm                                  3 decimals
 *   volumeWeight, chargeableWeight       2 decimals
 *
 * @param {'SEA_LCL'|'AIR'} transportType
 * @param {{ length: string|number, width: string|number, height: string|number,
 *           actualWeight: string|number }} input  sizes in cm, weight in kg
 * @returns {{ ok: true, transportType: string, length: number, width: number, height: number,
 *             actualWeight: number, cbm: number, volumeWeight: number,
 *             chargeableWeight: number, chargedBy: 'actual'|'volume' }
 *         | { ok: false, transportType: string, missing: string[], invalid: string[] }}
 *
 * @example
 *   calculateFreightWeight('SEA_LCL', { length: 120, width: 80, height: 50, actualWeight: 250 })
 *   // -> { ok: true, transportType: 'SEA_LCL', length: 120, width: 80, height: 50,
 *   //      actualWeight: 250, cbm: 0.48, volumeWeight: 480, chargeableWeight: 480,
 *   //      chargedBy: 'volume' }
 */
export function calculateFreightWeight(transportType, { length, width, height, actualWeight }) {
  // A typo like 'SEA' instead of 'SEA_LCL' would otherwise give NaN everywhere.
  if (!TRANSPORT_TYPES[transportType]) {
    throw new Error(`Unknown transport type: ${transportType}`);
  }

  const fields = { length, width, height, actualWeight };
  const missing = [];
  const invalid = [];
  const numbers = {};

  // Check each of the four in turn. Object.entries() turns the object into
  // pairs: [['length', '120'], ['width', '80'], ...].
  for (const [name, raw] of Object.entries(fields)) {
    const value = toNumber(raw);
    // A size must be above 0; a weight may be 0, but not below.
    const allowed = name === 'actualWeight' ? value >= 0 : value > 0;

    // Empty box -> missing. Something typed that isn't allowed (like "abc",
    // "0" for a size, or "-4") -> invalid. Otherwise keep the number.
    if (raw === null || raw === undefined || String(raw).trim() === '') missing.push(name);
    else if (value === null || !allowed) invalid.push(name);
    else numbers[name] = value;
  }

  // Stop here if anything is wrong: no numbers at all is safer than wrong ones.
  if (missing.length || invalid.length) return { ok: false, transportType, missing, invalid };

  // Everything is a valid number from here on. Work with the UNROUNDED values
  // and round only at the end, so rounding errors don't pile up.
  const volumeWeight = volumeWeightKg(numbers.length, numbers.width, numbers.height, transportType);
  const chargeableWeight = chargeableWeightKg(numbers.actualWeight, volumeWeight);

  return {
    ok: true,
    transportType,
    length: numbers.length,
    width: numbers.width,
    height: numbers.height,
    actualWeight: numbers.actualWeight,
    cbm: round3(volumeM3(numbers.length, numbers.width, numbers.height)),
    volumeWeight: round2(volumeWeight),
    chargeableWeight: round2(chargeableWeight),
    // Which of the two won, so the screen can say WHY this is the charge.
    // A tie counts as the real weight: nothing extra is being charged.
    chargedBy: volumeWeight > numbers.actualWeight ? 'volume' : 'actual',
  };
}

/**
 * Zeevracht (LCL) in one call, with the four numbers as separate arguments.
 * The same as calculateFreightWeight('SEA_LCL', ...) - see there.
 *
 * @example
 *   calculateSeaFreightWeight(150, 80, 60, 300)
 *   // -> cbm 0.72, volumeWeight 720, chargeableWeight 720
 */
export function calculateSeaFreightWeight(length, width, height, actualWeight) {
  return calculateFreightWeight('SEA_LCL', { length, width, height, actualWeight });
}

/** Luchtvracht in one call. The same as calculateFreightWeight('AIR', ...). */
export function calculateAirFreightWeight(length, width, height, actualWeight) {
  return calculateFreightWeight('AIR', { length, width, height, actualWeight });
}
