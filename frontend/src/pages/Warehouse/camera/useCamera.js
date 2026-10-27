// src/pages/Warehouse/camera/useCamera.js
//
// The camera as a React hook: start it, stop it, take a picture, and know
// which of those is happening. Wraps measurement/cameraService.js so a
// component never has to hold on to a MediaStream itself.
//
// Usage:
//   const camera = useCamera();
//   <video ref={camera.videoRef} />
//   <button onClick={camera.start}>Start</button>
//   const frame = camera.capture();

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureFrame, startCamera, stopCamera } from '../../../measurement/cameraService';

/**
 * @returns {{ videoRef: object, status: 'off'|'starting'|'live', error: string|null,
 *   start: () => Promise<void>, stop: () => void, capture: () => object|null }}
 *   error is one of cameraService's CAMERA_ERRORS codes, or null
 */
export function useCamera() {
  // The <video> element the picture is shown in.
  const videoRef = useRef(null);
  // The live stream. A ref, not state: it is the only way to turn the camera
  // off again, and a re-render must never lose it.
  const streamRef = useRef(null);

  const [status, setStatus] = useState('off');
  const [error, setError] = useState(null);

  const stop = useCallback(() => {
    stopCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    setStatus('off');
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return; // already on
    setError(null);
    setStatus('starting');
    try {
      streamRef.current = await startCamera(videoRef.current);
      setStatus('live');
    } catch (failure) {
      setError(failure?.code ?? 'failed');
      setStatus('off');
    }
  }, []);

  // One still picture from the live preview, or null if there is none yet.
  const capture = useCallback(() => captureFrame(videoRef.current), []);

  // When the page is left, the camera goes off - always. A camera left
  // running keeps its light on, drains a phone's battery, and stays busy for
  // every other app.
  useEffect(
    () => () => {
      stopCamera(streamRef.current);
      streamRef.current = null;
    },
    [],
  );

  return { videoRef, status, error, start, stop, capture };
}
