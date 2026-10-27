// src/pages/Dashboard/invoice/invoiceMath.js
//
// THE ARITHMETIC OF AN INVOICE, IN THE BROWSER.
//
// This is a copy of backend/invoicing/calculation.py, so the editor can show
// totals while the employee types. The server always recalculates before it
// saves or prints anything; this copy is only for instant feedback.
//
// Both copies are tested against the same examples:
// backend/invoicing/fixtures/calculation_cases.json. If you change a rule
// here, change it in calculation.py too - one of the two test suites will
// fail if they disagree.
//
// HOW MONEY IS HANDLED (important!)
//
// JavaScript numbers are floating point, and 0.1 + 0.2 === 0.30000000000000004.
// That is fine for a game and wrong for an invoice. So every amount is turned
// into a whole number of CENTS before any sum is done:
//
//     "1370.48"  ->  137048
//
// Whole numbers add up exactly. We only turn cents back into text
// ("€ 1.370,48") at the very end, to show them.
//
// Volumes can get big (100 m boxes x 10 000 of them), so the volume maths
// uses BigInt, JavaScript's whole numbers without a size limit.

/** Box sides are divided by this to get volume weight (cm3 / 6000 = kg). */
export const VOLUME_WEIGHT_DIVISOR = 6000;

// ---- reading what people type ---------------------------------------------

/**
 * Text typed into a money box -> whole cents, or null when it is not money.
 *
 *   "1.370,48" -> 137048   (Dutch: dot for thousands, comma for decimals)
 *   "1370,48"  -> 137048
 *   "1370.48"  -> 137048   (the API's own format)
 *   "1.370"    -> 137000   (dots between groups of three are thousands)
 *   "€ -100"   -> -10000
 *   ""         -> null
 */
export function parseCents(text) {
  if (text === null || text === undefined) return null;
  let value = String(text).replace(/[€\s\u00a0]/g, '');
  if (value === '') return null;

  if (value.includes(',')) {
    // A comma is the decimal mark, so every dot is a thousands separator.
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(value)) {
    // "1.370" or "12.500.000": dots between groups of three are thousands.
    value = value.replace(/\./g, '');
  }

  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;

  const [, sign, euros, cents = ''] = match;
  const total = Number(euros) * 100 + Number(cents.padEnd(2, '0'));
  return sign === '-' ? -total : total;
}

/** Cents -> the API's decimal string: 137048 -> "1370.48", -5 -> "-0.05". */
export function centsToDecimal(cents) {
  if (cents === null || cents === undefined) return null;
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/**
 * A decimal typed by a person -> a BigInt scaled by 10^places, or null.
 *   parseScaled("120,5", 1) -> 1205n      parseScaled("1.5", 3) -> 1500n
 * Used for measurements and percentages, where we need exact decimals too.
 */
export function parseScaled(text, places) {
  if (text === null || text === undefined) return null;
  const value = String(text).trim().replace(',', '.');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > places) return null;
  const scaled = BigInt(whole + fraction.padEnd(places, '0'));
  return sign === '-' ? -scaled : scaled;
}

/**
 * a / b for BigInts, rounded half AWAY from zero - the same rounding as
 * Python's ROUND_HALF_UP on the server: 0.5 -> 1 and -0.5 -> -1.
 */
function divideRounded(a, b) {
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const quotient = (absA * 2n + absB) / (absB * 2n);
  return negative ? -quotient : quotient;
}

// ---- formatting --------------------------------------------------------------

/**
 * Cents -> "€ 1.370,48" or "-€ 100,00", exactly as the PDF prints it.
 * A dash for "no amount". (Not Intl.NumberFormat: that writes "€ -100,00",
 * and the preview has to match the PDF character for character.)
 */
export function formatEuro(cents) {
  if (cents === null || cents === undefined) return '—';
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const text = `€ ${euros},${String(absolute % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}

/** "1.550" -> "1,55": trailing zeros off, a comma for the point. */
export function formatNumber(value, unit = '') {
  if (value === null || value === undefined || value === '') return '';
  let text = String(value).replace(',', '.');
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  text = text.replace('.', ',');
  return unit ? `${text} ${unit}` : text;
}

/** 21 -> "21%", "0.00" -> "0%", "9.50" -> "9,5%". */
export function formatPercent(rate) {
  return `${formatNumber(rate) || '0'}%`;
}

// ---- packages ----------------------------------------------------------------

/**
 * Volume and volume weight of a list of measured boxes.
 *
 * rows: [{ length_cm: "120", width_cm: "80", height_cm: "100", count: 2 }, ...]
 *   ("count: 2" = two boxes of exactly this size.)
 *
 * Returns three different things - keep them apart on screen:
 *   pieces          how many boxes
 *   volumeM3        the space they take, "2.208" (3 decimals)
 *   volumeWeightKg  L x W x H / 6000 added up, "368.00" (2 decimals)
 * Rows that are not filled in completely are skipped and reported in
 * `incomplete`, so the form can point at them.
 */
export function measurePackages(rows) {
  let pieces = 0;
  // Sides are read in tenths of a cm, so the product is in cm3 x 1000.
  let product = 0n;
  let incomplete = 0;

  for (const row of rows ?? []) {
    const length = parseScaled(row.length_cm, 1);
    const width = parseScaled(row.width_cm, 1);
    const height = parseScaled(row.height_cm, 1);
    const count = Number.parseInt(row.count, 10);

    if (!length || !width || !height || !(count > 0) || length < 0n || width < 0n || height < 0n) {
      incomplete += 1;
      continue;
    }
    pieces += count;
    product += length * width * height * BigInt(count);
  }

  // cm3 = product / 1000.
  // m3 to 3 decimals = cm3 / 1 000 000, kept as thousandths: product / 1 000 000.
  const thousandthsM3 = divideRounded(product, 1000000n);
  // kg to 2 decimals = cm3 / 6000, kept as cents of a kg: product / 60 000.
  const hundredthsKg = divideRounded(product, 1000n * 60n);

  return {
    pieces,
    volumeM3: scaledToText(thousandthsM3, 3),
    volumeWeightKg: scaledToText(hundredthsKg, 2),
    incomplete,
  };
}

function scaledToText(value, places) {
  const text = value.toString().padStart(places + 1, '0');
  return `${text.slice(0, -places)}.${text.slice(-places)}`;
}

/** The weight air freight is charged on: the higher of the two. */
export function chargeableWeight(actualKg, volumeWeightKg) {
  const known = [actualKg, volumeWeightKg]
    .map((value) => parseScaled(value, 3))
    .filter((value) => value !== null);
  if (known.length === 0) return null;
  const highest = known.reduce((a, b) => (a > b ? a : b));
  return scaledToText(highest, 3).replace(/\.?0+$/, '');
}

// ---- insurance ---------------------------------------------------------------

/**
 * The insurance premium in cents, when an admin configured a rate.
 * No rate configured -> null: the premium is typed by hand instead.
 * We never invent a rate.
 */
export function insuranceFeeCents(insuredCents, ratePercent, minimumCents) {
  if (insuredCents === null || ratePercent === null || ratePercent === undefined || ratePercent === '') {
    return null;
  }
  const rateThousandths = parseScaled(ratePercent, 3);
  if (rateThousandths === null) return null;
  // insured x rate / 100, with the rate in thousandths: / 100 000.
  const fee = Number(divideRounded(BigInt(insuredCents) * rateThousandths, 100000n));
  return minimumCents !== null && minimumCents !== undefined ? Math.max(fee, minimumCents) : fee;
}

// ---- the totals ----------------------------------------------------------------

/**
 * Everything in the financial summary, in cents.
 *
 * chargeCents      amounts of the service lines (insurance included)
 * adjustmentCents  the contractual adjustments - may be negative OR positive
 * vatRate          a percentage as text or number: "21", "0", "9.5"
 *
 * Returns { subtotal, adjustments, totalExcl, vat, total } in cents.
 * A negative total is a credit: money we owe the customer.
 */
export function calculateTotals(chargeCents, adjustmentCents, vatRate) {
  const subtotal = chargeCents.reduce((sum, cents) => sum + cents, 0);
  const adjustments = adjustmentCents.reduce((sum, cents) => sum + cents, 0);
  const totalExcl = subtotal + adjustments;
  // The rate is read in hundredths of a percent (21 -> 2100), so
  // VAT = totalExcl x rate / 100 becomes totalExcl x hundredths / 10 000.
  const rateHundredths = parseScaled(String(vatRate ?? 0), 2) ?? 0n;
  let vat = Number(divideRounded(BigInt(totalExcl) * rateHundredths, 10000n));
  if (Object.is(vat, -0)) vat = 0;
  return { subtotal, adjustments, totalExcl, vat, total: totalExcl + vat };
}

/** True when the invoice ends in money owed to the customer. */
export function isCredit(totalCents) {
  return totalCents !== null && totalCents !== undefined && totalCents < 0;
}
