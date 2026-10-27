// src/measurement/measurementUtils.js
//
// The arithmetic of measuring with a camera, and nothing else: no camera, no
// React, no computer vision. Small pure functions, so they are easy to test
// and stay correct whatever detection system is plugged in later.
//
// HOW CAMERA MEASUREMENT WORKS (the short version)
// -----------------------------------------------
// A camera sees pixels, not centimetres. How many pixels one centimetre takes
// up depends on how far away the package is and on the lens, so a webcam on
// its own cannot know real sizes. That is why a REFERENCE MARKER is used: a
// printed square of known size (for example 10 cm) lying next to the package.
//
//   1. Find the marker in the picture and measure it in pixels.
//        The 10 cm marker is 200 pixels wide.
//   2. Work out the scale: pixels per centimetre.
//        200 px / 10 cm = 20 px per cm.
//   3. Measure the package in pixels and divide by the scale.
//        A side of 904 px / 20 px per cm = 45.2 cm.
//
// The scale is only right for things at the same distance from the camera as
// the marker, which is why the marker has to lie on (or right next to) the
// package. It is an estimate, not a certified measurement.

/** The printed reference marker's side, in centimetres. Change it if you print a different size. */
export const REFERENCE_MARKER_SIZE_CM = 10;

/** Measurements are shown to one decimal: 45.2 cm. Finer than that is false precision for a webcam. */
export function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

/**
 * A measurement for the screen: 45.2 -> "45.2" in English, "45,2" in Dutch
 * and Papiamentu (a decimal comma). A dash when there is no number.
 *
 * @param {number|null} value
 * @param {string} language  'en', 'nl' or 'pap'
 */
export function formatCentimeters(value, language) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const locale = language === 'en' ? 'en-GB' : 'nl-NL';
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Step 2 above: how many pixels one centimetre takes up in this picture.
 *
 * @param {number} markerSizePx  the marker's side as measured in the picture, in pixels
 * @param {number} markerSizeCm  the marker's real side, in centimetres
 * @returns {number|null} pixels per centimetre, or null if it cannot be worked out
 */
export function pixelsPerCentimeter(markerSizePx, markerSizeCm = REFERENCE_MARKER_SIZE_CM) {
  // Guard against nonsense (no marker, a zero-size marker): dividing by it
  // would give Infinity or NaN, which would then show up as a measurement.
  if (!(markerSizePx > 0) || !(markerSizeCm > 0)) return null;
  return markerSizePx / markerSizeCm;
}

/**
 * Step 3 above: a length in pixels, as centimetres.
 *
 * @param {number} pixels  a length measured in the picture
 * @param {number} scale   pixels per centimetre, from pixelsPerCentimeter()
 * @returns {number|null} centimetres, rounded to one decimal, or null
 */
export function convertPixelsToCentimeters(pixels, scale) {
  if (!(pixels >= 0) || !(scale > 0)) return null;
  return roundToTenth(pixels / scale);
}

/**
 * What is wrong with a measurement, as a list of problem codes. An empty list
 * means it may be confirmed.
 *
 * The page turns each code into a sentence the worker can act on
 * (translations: dashboard.flow.camera.problems.*).
 *
 * @param {{ markerDetected: boolean, packageDetected: boolean,
 *           dimensions: { length: number|null, width: number|null, height: number|null } | null }} result
 * @returns {string[]}
 */
export function measurementProblems(result) {
  const problems = [];
  if (!result?.markerDetected) problems.push('noMarker');
  if (!result?.packageDetected) problems.push('noPackage');

  // Only worth saying when both were found: otherwise the missing marker or
  // package already explains why there are no sizes.
  if (result?.markerDetected && result?.packageDetected) {
    const { length, width, height } = result.dimensions ?? {};
    if (!(length > 0)) problems.push('noLength');
    if (!(width > 0)) problems.push('noWidth');
    if (!(height > 0)) problems.push('noHeight');
  }
  return problems;
}

/**
 * The average brightness of a picture, from 0 (black) to 255 (white).
 *
 * Used as a first, honest check before any detection: a picture this dark
 * (a covered lens, a dark corner) has nothing in it to measure. Every 16th
 * pixel is enough to tell, and keeps it fast on a phone.
 *
 * @param {{ data: Uint8ClampedArray }} imageData  RGBA pixels, as from canvas getImageData()
 */
export function averageBrightness(imageData) {
  const { data } = imageData;
  let total = 0;
  let count = 0;
  // 4 values per pixel (red, green, blue, alpha); step over 16 pixels at a time.
  for (let i = 0; i < data.length; i += 4 * 16) {
    // The usual weighting: the eye sees green as brightest, blue as darkest.
    total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count += 1;
  }
  return count ? total / count : 0;
}
