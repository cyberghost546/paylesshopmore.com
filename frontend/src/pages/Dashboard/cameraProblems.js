// src/pages/Dashboard/cameraProblems.js
//
// What went wrong with the camera, in words for the person holding it - one
// per CAMERA_ERRORS code (src/measurement/cameraService.js). Shared by the
// intake sheet's damage photos (IntakePhotos.jsx) and its label reader
// (LabelReader.jsx). The sentences themselves are in
// i18n/pages/intakeCamera.js under `problem`, in each language.

const KNOWN = ['needsHttps', 'noCamera', 'blocked', 'inUse', 'failed'];

/**
 * The sentence for a camera error code. `d` is usePageText('intakeCamera');
 * a code we have no sentence for reads as the general "could not start".
 */
export function cameraProblem(code, d) {
  return d(`problem.${KNOWN.includes(code) ? code : 'failed'}`);
}
