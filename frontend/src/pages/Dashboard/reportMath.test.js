import { describe, expect, it } from 'vitest';
import { change, shiftMonth } from './reportMath';

describe('shiftMonth', () => {
  it('moves across the turn of the year', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -11)).toBe('2025-11');
  });
});

describe('change', () => {
  it('gives a rounded percentage', () => {
    expect(change(12, 10)).toEqual({ direction: 'up', percent: 20 });
    expect(change(5, 10)).toEqual({ direction: 'down', percent: -50 });
    expect(change('150.00', '100.00')).toEqual({ direction: 'up', percent: 50 });
  });

  it('has no percentage for a rise from zero, and nothing without a figure', () => {
    expect(change(3, 0)).toEqual({ direction: 'up', percent: null });
    expect(change(4, 4)).toEqual({ direction: 'flat', percent: 0 });
    expect(change(null, 4)).toBeNull();
  });
});
