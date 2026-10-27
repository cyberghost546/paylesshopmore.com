// Volume, volume weight and chargeable weight, for zeevracht (LCL) and
// luchtvracht: the examples from the feature requests, and the inputs a form
// can throw at it.

import { describe, expect, it } from 'vitest';
import {
  TRANSPORT_TYPES,
  VOLUMETRIC_DIVISOR,
  calculateAirFreightWeight,
  calculateFreightWeight,
  calculateSeaFreightWeight,
  chargeableWeightKg,
  round2,
  round3,
  toNumber,
  transportTypeForFreight,
  volumeCm3,
  volumeM3,
  volumeWeightKg,
} from './volumeWeight';

describe('volume', () => {
  it('is length x width x height, in cm³ and in m³ (CBM)', () => {
    expect(volumeCm3(50, 40, 30)).toBe(60_000);
    expect(volumeM3(50, 40, 30)).toBe(0.06);
    expect(volumeM3(120, 80, 50)).toBe(0.48);
    expect(volumeM3(100, 100, 100)).toBe(1);
  });

  it('rounds CBM to 3 decimals', () => {
    // 33 x 27 x 19 = 16,929 cm³ = 0.016929 m³
    expect(round3(volumeM3(33, 27, 19))).toBe(0.017);
  });
});

describe('volume weight', () => {
  it('zeevracht (LCL) counts 1 m³ as 1000 kg: cm³ / 1000', () => {
    expect(TRANSPORT_TYPES.SEA_LCL.cm3PerKg).toBe(1000);
    expect(volumeWeightKg(120, 80, 50, 'SEA_LCL')).toBe(480);
    expect(volumeWeightKg(100, 100, 100, 'SEA_LCL')).toBe(1000);
  });

  it('luchtvracht counts 1 m³ as 167 kg: cm³ / 6000', () => {
    expect(VOLUMETRIC_DIVISOR).toBe(6000);
    expect(volumeWeightKg(50, 40, 30, 'AIR')).toBe(10);
    expect(volumeWeightKg(120, 80, 50, 'AIR')).toBe(80);
  });

  it('is air when no transport type is given, as before sea was added', () => {
    expect(volumeWeightKg(50, 40, 30)).toBe(10);
  });

  it('rounds to 2 decimals for showing', () => {
    // 33 x 27 x 19 = 16,929 cm³ / 6000 = 2.8215 kg
    expect(round2(volumeWeightKg(33, 27, 19, 'AIR'))).toBe(2.82);
  });
});

describe('chargeable weight', () => {
  it('is the volume weight when the box is big and light', () => {
    expect(chargeableWeightKg(250, 480)).toBe(480);
  });

  it('is the actual weight when the box is small and heavy', () => {
    expect(chargeableWeightKg(700, 480)).toBe(700);
  });
});

describe('calculateSeaFreightWeight (zeevracht LCL)', () => {
  it('120 x 80 x 50 cm, 250 kg: 0.48 m³, 480 kg volume, 480 kg charged', () => {
    expect(calculateSeaFreightWeight(120, 80, 50, 250)).toEqual({
      ok: true,
      transportType: 'SEA_LCL',
      length: 120,
      width: 80,
      height: 50,
      actualWeight: 250,
      cbm: 0.48,
      volumeWeight: 480,
      chargeableWeight: 480,
      chargedBy: 'volume',
    });
  });

  it('120 x 80 x 50 cm, 700 kg: the actual weight is charged', () => {
    expect(calculateSeaFreightWeight(120, 80, 50, 700)).toMatchObject({
      chargeableWeight: 700,
      chargedBy: 'actual',
    });
  });

  it('150 x 80 x 60 cm, 300 kg: 0.72 m³, 720 kg volume, 720 kg charged', () => {
    expect(calculateSeaFreightWeight(150, 80, 60, 300)).toMatchObject({
      cbm: 0.72,
      volumeWeight: 720,
      chargeableWeight: 720,
    });
  });
});

describe('calculateAirFreightWeight (luchtvracht)', () => {
  it('50 x 40 x 30 cm, 6 kg: 10 kg volume, 10 kg charged', () => {
    expect(calculateAirFreightWeight(50, 40, 30, 6)).toMatchObject({
      cbm: 0.06,
      volumeWeight: 10,
      chargeableWeight: 10,
      chargedBy: 'volume',
    });
  });

  it('the same pallet costs far less volume weight by air than by sea', () => {
    expect(calculateAirFreightWeight(120, 80, 50, 50).chargeableWeight).toBe(80);
    expect(calculateSeaFreightWeight(120, 80, 50, 50).chargeableWeight).toBe(480);
  });
});

describe('calculateFreightWeight: checking the input', () => {
  it('takes what a form gives: strings, with a decimal comma, and keeps the originals', () => {
    const result = calculateFreightWeight('SEA_LCL', { length: '120,5', width: '80', height: '50', actualWeight: '6,5' });
    expect(result).toMatchObject({ ok: true, length: 120.5, actualWeight: 6.5 });
  });

  it('does not calculate while a measurement is missing', () => {
    expect(calculateFreightWeight('SEA_LCL', { length: '50', width: '', height: '30', actualWeight: '6' })).toEqual({
      ok: false,
      transportType: 'SEA_LCL',
      missing: ['width'],
      invalid: [],
    });
  });

  it('refuses a size of 0, a negative size, or not a number', () => {
    expect(calculateFreightWeight('AIR', { length: 0, width: -4, height: 'abc', actualWeight: 6 })).toMatchObject({
      ok: false,
      missing: [],
      invalid: ['length', 'width', 'height'],
    });
  });

  it('accepts a weight of 0, but not below', () => {
    expect(calculateFreightWeight('SEA_LCL', { length: 50, width: 40, height: 30, actualWeight: '0' })).toMatchObject({
      ok: true,
      chargeableWeight: 60,
    });
    expect(calculateFreightWeight('SEA_LCL', { length: 50, width: 40, height: 30, actualWeight: '-1' })).toMatchObject({
      ok: false,
      invalid: ['actualWeight'],
    });
  });

  it('refuses a transport type it does not know, instead of returning nonsense', () => {
    expect(() => calculateFreightWeight('SEA', { length: 1, width: 1, height: 1, actualWeight: 1 })).toThrow(
      'Unknown transport type',
    );
  });
});

describe('transportTypeForFreight', () => {
  it("turns the sheet's Transportwijze into a transport type", () => {
    expect(transportTypeForFreight('sea')).toBe('SEA_LCL');
    expect(transportTypeForFreight('air')).toBe('AIR');
    expect(transportTypeForFreight('')).toBeNull();
  });
});

describe('toNumber', () => {
  it('reads form input, and gives null for nothing usable', () => {
    expect(toNumber('12,5')).toBe(12.5);
    expect(toNumber(' 7 ')).toBe(7);
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });
});
