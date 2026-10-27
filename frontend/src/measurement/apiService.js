// src/measurement/apiService.js
//
// Saving a camera measurement.
//
// NOT CONNECTED TO THE SERVER YET, on purpose. While measurementService.js
// returns demo sizes, sending them to the server would put made-up numbers on
// a real customer's package. So for now saveMeasurement() builds the record
// the server will want and keeps it in the page (React state) only.
//
// TO CONNECT IT LATER (once detection is real):
//   1. Set SAVE_TO_SERVER to true.
//   2. The site already has an endpoint for measurements:
//        saveMeasurement(packageId, { weight_kg, length_cm, width_cm, height_cm })
//      in src/api/warehouse.js (POST /api/staff/warehouse/measurements/).
//      It needs the package's database id and a weight, so the page would
//      ask for the package by scanning its label, and for the weight from a
//      scale. The server records the worker and the time itself, from the
//      signed-in account - never trust those from the browser.

/** Flip to true once measurements are real. See the comment above. */
export const SAVE_TO_SERVER = false;

/**
 * The record of one camera measurement, in the shape a future API will take.
 *
 * @param {{ packageId: string, dimensions: { length: number, width: number, height: number },
 *           workerId: number|null }} input
 */
export function buildMeasurementRecord({ packageId, dimensions, workerId }) {
  return {
    packageId: packageId || null,
    length: dimensions.length,
    width: dimensions.width,
    height: dimensions.height,
    unit: 'cm',
    workerId: workerId ?? null,
    // ISO 8601, in UTC: the format a server stores and sorts by.
    measuredAt: new Date().toISOString(),
    status: 'confirmed',
    // How the sizes were found, so a later report can tell camera estimates
    // from tape-measure readings.
    source: 'camera-prototype',
  };
}

/**
 * Saves a confirmed measurement.
 *
 * @returns {Promise<{ record: object, savedToServer: boolean }>}
 */
export async function saveMeasurement(input) {
  const record = buildMeasurementRecord(input);

  if (SAVE_TO_SERVER) {
    // Wired up when detection is real - see the comment at the top.
    throw new Error('Saving camera measurements to the server is not connected yet.');
  }

  // A promise even now, so the page already waits for it the way it will
  // wait for a real request.
  return { record, savedToServer: false };
}
