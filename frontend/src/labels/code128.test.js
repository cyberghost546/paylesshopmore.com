// The label's Code 128 barcode: proven by reading it back with zxing's own
// Code 128 reader - the same library the warehouse scanner uses.

import { BitArray, Code128Reader } from '@zxing/library';
import { describe, expect, it } from 'vitest';
import { code128Svg, code128Values } from './code128';

/** Reads the bars out of the SVG into the row of pixels a scanner sees. */
function scanRow(svg, pixelsPerModule = 3) {
  const total = Number(svg.match(/viewBox="0 0 (\d+) /)[1]);
  const row = new BitArray(total * pixelsPerModule);
  for (const [, x, width] of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) {
    for (let pixel = Number(x) * pixelsPerModule; pixel < (Number(x) + Number(width)) * pixelsPerModule; pixel++) {
      row.set(pixel);
    }
  }
  return row;
}

describe('Code 128 barcode', () => {
  it.each(['PLSM-DEMO-23202', 'PLSM-B00003', 'PLS-2001', 'abc xyz ~09'])(
    'scans back as %s',
    (text) => {
      const result = new Code128Reader().decodeRow(0, scanRow(code128Svg(text)), new Map());
      expect(result.getText()).toBe(text);
    },
  );

  it('starts with code set B, ends with a check symbol and stop', () => {
    // "PLS": P=48, L=44, S=51; check = (104 + 48 + 88 + 153) % 103 = 84.
    expect(code128Values('PLS')).toEqual([104, 48, 44, 51, 84, 106]);
  });

  it('refuses what code set B cannot hold', () => {
    expect(() => code128Values('Curaçao')).toThrow();
  });
});
