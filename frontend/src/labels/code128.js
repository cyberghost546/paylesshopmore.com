// src/labels/code128.js
//
// Draws a Code 128 barcode (the usual barcode on parcels) as an SVG, with no
// library: zxing, which the site already uses, can read these but not draw
// them. Used on the shipping label (pages/Warehouse/ShipmentLabel.jsx).
//
// How Code 128 works, in short:
//   - Every symbol is 11 "modules" wide: 3 bars and 3 spaces, each 1-4
//     modules wide. PATTERNS below lists those widths for all 107 symbols,
//     bar first: '212222' = bar 2, space 1, bar 2, space 2, bar 2, space 2.
//   - A barcode is: start symbol, one symbol per character, a check symbol,
//     the stop symbol (13 modules: it ends with an extra 2-wide bar).
//   - We use code set B, which covers every printable ASCII character
//     (space to ~): a character's value is its character code minus 32.
//   - The check symbol is (start value + each value x its position) mod 103,
//     so a scanner can tell a misread from a good read.
//   - Scanners need a quiet zone (empty space) of 10 modules on each side.

// The bar/space widths of symbol values 0-106 (the Code 128 standard table).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;
const QUIET = 10;

/**
 * The symbol values for a text: start B, the characters, check, stop.
 *
 * @param {string} text  printable ASCII only (space to ~)
 * @returns {number[]}
 */
export function code128Values(text) {
  const values = [...text].map((char) => {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128 B cannot encode "${char}"`);
    return code - 32;
  });
  const check = values.reduce((sum, value, index) => sum + value * (index + 1), START_B) % 103;
  return [START_B, ...values, check, STOP];
}

/**
 * The barcode as an <svg> string: black bars on white, one unit per module.
 * It scales to any width in CSS; `preserveAspectRatio="none"` lets the
 * label make it taller or wider without the bars going out of proportion
 * to each other.
 *
 * @param {string} text
 * @param {{ height?: number }} [options]  bar height, in modules
 * @returns {string}
 */
export function code128Svg(text, { height = 50 } = {}) {
  const bars = [];
  let x = QUIET;
  for (const value of code128Values(text)) {
    [...PATTERNS[value]].forEach((width, index) => {
      const w = Number(width);
      // Even positions are bars, odd ones spaces.
      if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    });
  }
  const total = x + QUIET;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" ` +
    `preserveAspectRatio="none" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${height}" fill="#fff"/>` +
    `<g fill="#000">${bars.join('')}</g></svg>`
  );
}
