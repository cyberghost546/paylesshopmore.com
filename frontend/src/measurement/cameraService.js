// src/measurement/cameraService.js
//
// Everything that talks to the camera, and nothing that measures. Starting
// and stopping it, and taking one still picture from the live preview for the
// measurement code to look at. Kept apart from measurementService.js so that
// either can be replaced (a depth camera, a fixed station camera) without
// touching the other.
//
// Uses the browser's own MediaDevices API - no library.

/** Error codes the page turns into sentences (dashboard.flow.camera.errors.*). */
export const CAMERA_ERRORS = {
  NEEDS_HTTPS: 'needsHttps', // the page is not on https, so the browser hides the camera
  NO_CAMERA: 'noCamera', // this device has no camera, or none we may use
  BLOCKED: 'blocked', // the worker (or the browser settings) said no
  IN_USE: 'inUse', // another app or tab is already using it
  FAILED: 'failed', // anything else
};

/** An Error that carries one of CAMERA_ERRORS as `code`, for the page to translate. */
function cameraError(code) {
  const error = new Error(`Camera: ${code}`);
  error.code = code;
  return error;
}

/**
 * Whether this browser can give us a camera at all.
 *
 * getUserMedia only exists on a secure origin (https, or localhost while
 * developing). On plain http it is simply missing, which would otherwise look
 * like "this phone has no camera".
 */
export function isCameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Turns the camera on and shows it in a <video> element.
 *
 * Asks for the BACK camera on phones and tablets (facingMode "environment"),
 * which is the one that points at the package. `ideal` rather than `exact`, so
 * a laptop with only a front webcam still works instead of failing.
 *
 * The browser shows its own permission prompt the first time.
 *
 * @param {HTMLVideoElement} videoElement  where to show the live picture
 * @returns {Promise<MediaStream>} the stream - keep it, it is how the camera is turned off again
 * @throws {Error} with `code` set to one of CAMERA_ERRORS
 */
export async function startCamera(videoElement) {
  if (!isCameraAvailable()) {
    throw cameraError(
      window.isSecureContext === false ? CAMERA_ERRORS.NEEDS_HTTPS : CAMERA_ERRORS.NO_CAMERA,
    );
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        // A sharper picture measures better; the browser picks the nearest it can do.
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (error) {
    throw cameraError(describeCameraError(error));
  }

  videoElement.srcObject = stream;
  // Needed on iPhone: without playsInline the video opens full screen, and
  // without muted some browsers refuse to start it automatically.
  videoElement.setAttribute('playsinline', '');
  videoElement.muted = true;
  try {
    await videoElement.play();
  } catch {
    // Some browsers start the video by themselves once srcObject is set and
    // reject play() anyway; the preview still works, so this is not an error.
  }
  return stream;
}

/**
 * Turns the camera off. Safe to call twice, or with nothing.
 *
 * Every track has to be stopped, or the camera light stays on and the camera
 * stays busy for other apps - even after the page is gone.
 *
 * @param {MediaStream|null} stream
 * @param {HTMLVideoElement|null} [videoElement]
 */
export function stopCamera(stream, videoElement = null) {
  stream?.getTracks().forEach((track) => track.stop());
  if (videoElement) videoElement.srcObject = null;
}

/**
 * Takes one still picture from the live preview, for the measurement code.
 *
 * Draws the current video frame onto an off-screen canvas and reads its
 * pixels back. The picture is never uploaded or stored.
 *
 * @param {HTMLVideoElement} videoElement
 * @returns {{ width: number, height: number, imageData: ImageData } | null}
 *   null when the video has no picture yet (it is still starting)
 */
export function captureFrame(videoElement) {
  const width = videoElement?.videoWidth ?? 0;
  const height = videoElement?.videoHeight ?? 0;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently: a hint that we read the pixels back, which some
  // browsers handle faster.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(videoElement, 0, 0, width, height);
  return { width, height, imageData: context.getImageData(0, 0, width, height) };
}

/**
 * Takes one still picture from the live preview as a JPEG file, ready to
 * upload (the intake sheet's damage photos).
 *
 * @param {HTMLVideoElement} videoElement
 * @returns {Promise<File|null>} null when the video has no picture yet
 */
export function captureJpeg(videoElement) {
  const width = videoElement?.videoWidth ?? 0;
  const height = videoElement?.videoHeight ?? 0;
  if (!width || !height) return Promise.resolve(null);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(videoElement, 0, 0, width, height);
  // toBlob is asynchronous, hence the Promise. 0.9 = good quality, small file.
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], 'foto.jpg', { type: 'image/jpeg' }) : null),
      'image/jpeg',
      0.9,
    );
  });
}

/** A browser camera error, as one of CAMERA_ERRORS. */
export function describeCameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return CAMERA_ERRORS.BLOCKED;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return CAMERA_ERRORS.NO_CAMERA;
    case 'NotReadableError':
    case 'AbortError':
      return CAMERA_ERRORS.IN_USE;
    default:
      return CAMERA_ERRORS.FAILED;
  }
}
