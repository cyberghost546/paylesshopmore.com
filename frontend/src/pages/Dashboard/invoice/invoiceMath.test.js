// The browser's copy of the invoice arithmetic, checked against the SAME
// examples as the server's (backend/invoicing/test_calculation.py). If the two
// ever disagree about a total, one of the two suites fails.

import { describe, expect, it } from 'vitest';
import cases from '../../../../../backend/invoicing/fixtures/calculation_cases.json';
import {
  calculateTotals,
  centsToDecimal,
  chargeableWeight,
  formatEuro,
  formatNumber,
  insuranceFeeCents,
  isCredit,
  measurePackages,
  parseCents,
} from './invoiceMath';

const cents = (text) => (text === null ? null : parseCents(text));

describe('shared totals cases', () => {
  for (const example of cases.totals) {
    it(example.name, () => {
      const totals = calculateTotals(
        example.charges.map(cents),
        example.adjustments.map(cents),
        example.vat_rate,
      );
      expect({
        subtotal: centsToDecimal(totals.subtotal),
        adjustments: centsToDecimal(totals.adjustments),
        total_excl: centsToDecimal(totals.totalExcl),
        vat: centsToDecimal(totals.vat),
        total: centsToDecimal(totals.total),
      }).toEqual(example.expected);
    });
  }
});

describe('shared package cases', () => {
  for (const example of cases.packages) {
    it(example.name, () => {
      const measured = measurePackages(example.measurements);
      expect(measured.pieces).toBe(example.expected.pieces);
      expect(measured.volumeM3).toBe(example.expected.volume_m3);
      expect(measured.volumeWeightKg).toBe(example.expected.volume_weight_kg);
    });
  }
});

describe('shared insurance cases', () => {
  for (const example of cases.insurance) {
    it(example.name, () => {
      const fee = insuranceFeeCents(
        cents(example.insured_value),
        example.rate,
        cents(example.minimum),
      );
      expect(fee === null ? null : centsToDecimal(fee)).toBe(example.expected);
    });
  }
});

describe('reading and writing amounts', () => {
  it('reads amounts the way they are written here', () => {
    expect(parseCents('1.370,48')).toBe(137048);
    expect(parseCents('1370,48')).toBe(137048);
    expect(parseCents('1370.48')).toBe(137048);
    expect(parseCents('1.370')).toBe(137000);
    expect(parseCents('€ -100')).toBe(-10000);
    expect(parseCents('0,5')).toBe(50);
    expect(parseCents('')).toBeNull();
    expect(parseCents('twaalf')).toBeNull();
    expect(parseCents('1,234')).toBeNull();
  });

  it('writes euros exactly as the PDF does', () => {
    expect(formatEuro(137048)).toBe('€ 1.370,48');
    expect(formatEuro(-10000)).toBe('-€ 100,00');
    expect(formatEuro(0)).toBe('€ 0,00');
    expect(formatEuro(123456789)).toBe('€ 1.234.567,89');
    expect(formatEuro(null)).toBe('—');
  });

  it('drops trailing zeros from measurements', () => {
    expect(formatNumber('1.550', 'm³')).toBe('1,55 m³');
    expect(formatNumber('199.00', 'kg')).toBe('199 kg');
  });

  it('never shows minus zero VAT on a credit', () => {
    expect(Object.is(calculateTotals([], [-1000], '0').vat, 0)).toBe(true);
  });

  it('knows a credit when it sees one', () => {
    expect(isCredit(-1)).toBe(true);
    expect(isCredit(0)).toBe(false);
  });

  it('charges air freight on the heavier weight', () => {
    expect(chargeableWeight('100', '160.00')).toBe('160');
    expect(chargeableWeight('200', '160.00')).toBe('200');
    expect(chargeableWeight('', null)).toBeNull();
  });

  it('skips and counts boxes that are not filled in', () => {
    const measured = measurePackages([
      { length_cm: '100', width_cm: '100', height_cm: '100', count: 1 },
      { length_cm: '', width_cm: '50', height_cm: '50', count: 1 },
    ]);
    expect(measured.pieces).toBe(1);
    expect(measured.incomplete).toBe(1);
    expect(measured.volumeM3).toBe('1.000');
  });
});
