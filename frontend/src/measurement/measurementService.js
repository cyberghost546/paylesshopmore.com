// src/measurement/measurementService.js
//
// Turns one still picture from the camera into a length, width and height.
//
// THIS IS A PROTOTYPE. The steps below are the real shape of a camera
// measurement system, but the two "detect" steps do not look at the picture
// yet: they return DEMO data, so the screens and the workflow can be built and
// tested now. Replace them one at a time with real computer vision:
//
//   detectReferenceMarker()  ->  OpenCV.js ArUco detection (cv.aruco)
//   detectPackage()          ->  a box detector (YOLO, or OpenCV contours)
//   detectPackageEdges()     ->  OpenCV Canny edges + polygon fitting
//   height                   ->  a second, side-on picture, or a depth camera
//
// Nothing else needs to change: calculateDimensions() and the maths in
// measurementUtils.js already work on whatever pixel sizes they are given.
//
// One real check does run today: a picture too dark to contain anything
// (a covered lens) is refused, so the "not detected" path can be seen and
// tested without any computer vision.

import {
  REFERENCE_MARKER_SIZE_CM,
  averageBrightness,
  convertPixelsToCentimeters,
  measurementProblems,
  pixelsPerCentimeter,
} from './measurementUtils';

/** True while detection returns demo data. The page says so on screen. */
export const DEMO_MODE = true;

// Below this average brightness (0-255) a picture is treated as empty.
const TOO_DARK = 30;

// The demo picture: a 10 cm marker that is 200 px wide (20 px per cm), and a
// box whose sides measure 904 x 636 px from above and 558 px from the side.
// With the maths in measurementUtils.js that gives 45.2 x 31.8 x 27.9 cm.
const DEMO = {
  markerSizePx: 200,
  lengthPx: 904,
  widthPx: 636,
  heightPx: 558,
};

/** How long the demo pretends to think, so the loading state can be seen. */
const DEMO_DELAY_MS = 700;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Finds the printed reference marker in the picture.
 *
 * REAL VERSION (later): run ArUco detection on frame.imageData, take the
 * marker's four corners, and return the average length of its sides in pixels.
 *
 * @param {{ imageData: ImageData }} frame
 * @returns {{ detected: boolean, sizePx: number|null, sizeCm: number }}
 */
export function detectReferenceMarker(frame) {
  if (!hasPicture(frame)) return { detected: false, sizePx: null, sizeCm: REFERENCE_MARKER_SIZE_CM };
  // DEMO: always "finds" a 200 px marker.
  return { detected: true, sizePx: DEMO.markerSizePx, sizeCm: REFERENCE_MARKER_SIZE_CM };
}

/**
 * Finds the package in the picture.
 *
 * REAL VERSION (later): a detector returns the box's outline; its sides in
 * pixels come from detectPackageEdges(). Height cannot be seen from straight
 * above, so it needs a second picture from the side (or a depth camera).
 *
 * @param {{ imageData: ImageData }} frame
 * @returns {{ detected: boolean, lengthPx: number|null, widthPx: number|null, heightPx: number|null }}
 */
export function detectPackage(frame) {
  if (!hasPicture(frame)) return { detected: false, lengthPx: null, widthPx: null, heightPx: null };
  const edges = detectPackageEdges(frame);
  // DEMO: the box's sides, as if measured in the picture.
  return { detected: true, ...edges };
}

/**
 * The package's sides in pixels, from its edges.
 *
 * REAL VERSION (later): Canny edge detection, find the largest four-sided
 * shape, and measure its sides. The longer side is the length.
 *
 * @returns {{ lengthPx: number, widthPx: number, heightPx: number }}
 */
export function detectPackageEdges() {
  return { lengthPx: DEMO.lengthPx, widthPx: DEMO.widthPx, heightPx: DEMO.heightPx };
}

/**
 * Pixel sizes, as centimetres. This part is real and does not change when
 * detection does.
 *
 * @param {{ sizePx: number, sizeCm: number }} marker
 * @param {{ lengthPx: number, widthPx: number, heightPx: number }} box
 * @returns {{ length: number|null, width: number|null, height: number|null, scale: number|null }}
 *   scale is pixels per centimetre, kept so it can be shown or logged
 */
export function calculateDimensions(marker, box) {
  const scale = pixelsPerCentimeter(marker?.sizePx, marker?.sizeCm);
  return {
    length: convertPixelsToCentimeters(box?.lengthPx, scale),
    width: convertPixelsToCentimeters(box?.widthPx, scale),
    height: convertPixelsToCentimeters(box?.heightPx, scale),
    scale,
  };
}

/**
 * The whole measurement, start to finish: marker, package, sizes, problems.
 * This is the one function the page calls.
 *
 * @param {{ width: number, height: number, imageData: ImageData } | null} frame  from cameraService.captureFrame()
 * @returns {Promise<{ markerDetected: boolean, packageDetected: boolean,
 *   dimensions: { length: number|null, width: number|null, height: number|null, scale: number|null } | null,
 *   problems: string[], demo: boolean }>}
 */
export async function measurePackage(frame) {
  // Async on purpose: real computer vision takes time (and may run in a web
  // worker), so the page already treats measuring as something to wait for.
  if (DEMO_MODE) await wait(DEMO_DELAY_MS);

  const marker = detectReferenceMarker(frame);
  const box = detectPackage(frame);
  const dimensions = marker.detected && box.detected ? calculateDimensions(marker, box) : null;

  const result = {
    markerDetected: marker.detected,
    packageDetected: box.detected,
    dimensions,
    demo: DEMO_MODE,
  };
  return { ...result, problems: measurementProblems(result) };
}

/** Whether there is a picture worth looking at: one exists, and it is not black. */
function hasPicture(frame) {
  return Boolean(frame?.imageData) && averageBrightness(frame.imageData) >= TOO_DARK;
}
