// The camera measurement module: the maths, the camera service against a fake
// browser camera, the (demo) measurement pipeline, and the saved record.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMeasurementRecord, saveMeasurement } from './apiService';
import { CAMERA_ERRORS, describeCameraError, startCamera, stopCamera } from './cameraService';
import { calculateDimensions, measurePackage } from './measurementService';
import {
  averageBrightness,
  convertPixelsToCentimeters,
  formatCentimeters,
  measurementProblems,
  pixelsPerCentimeter,
} from './measurementUtils';

/** A fake picture: every pixel the same grey (0 black - 255 white). */
function frameOf(grey, size = 64) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) data.set([grey, grey, grey, 255], i);
  return { width: size, height: size, imageData: { data } };
}

describe('the maths', () => {
  it('turns a marker into a scale: 10 cm at 200 px is 20 px per cm', () => {
    expect(pixelsPerCentimeter(200, 10)).toBe(20);
  });

  it('turns pixels into centimetres at that scale, to one decimal', () => {
    expect(convertPixelsToCentimeters(904, 20)).toBe(45.2);
    expect(convertPixelsToCentimeters(20, 20)).toBe(1);
    expect(convertPixelsToCentimeters(333, 20)).toBe(16.7);
  });

  it('refuses to divide by nothing rather than showing Infinity', () => {
    expect(pixelsPerCentimeter(0, 10)).toBeNull();
    expect(pixelsPerCentimeter(null, 10)).toBeNull();
    expect(convertPixelsToCentimeters(100, null)).toBeNull();
    expect(convertPixelsToCentimeters(-5, 20)).toBeNull();
  });

  it('calculates all three sides from a marker and a box', () => {
    const sizes = calculateDimensions(
      { sizePx: 200, sizeCm: 10 },
      { lengthPx: 904, widthPx: 636, heightPx: 558 },
    );
    expect(sizes).toEqual({ length: 45.2, width: 31.8, height: 27.9, scale: 20 });
  });

  it('says what stops a measurement being confirmed', () => {
    const good = { markerDetected: true, packageDetected: true, dimensions: { length: 1, width: 2, height: 3 } };
    expect(measurementProblems(good)).toEqual([]);
    expect(measurementProblems({ ...good, markerDetected: false })).toEqual(['noMarker']);
    expect(measurementProblems({ ...good, packageDetected: false })).toEqual(['noPackage']);
    expect(
      measurementProblems({ ...good, dimensions: { length: 0, width: null, height: 3 } }),
    ).toEqual(['noLength', 'noWidth']);
    expect(measurementProblems(null)).toEqual(['noMarker', 'noPackage']);
  });

  it('tells a black picture from a lit one', () => {
    expect(averageBrightness(frameOf(0).imageData)).toBe(0);
    expect(averageBrightness(frameOf(200).imageData)).toBeCloseTo(200, 0);
  });

  it('shows the decimal the worker reads', () => {
    expect(formatCentimeters(45.2, 'en')).toBe('45.2');
    expect(formatCentimeters(45.2, 'nl')).toBe('45,2');
    expect(formatCentimeters(null, 'en')).toBe('—');
  });
});

describe('the measurement pipeline (demo detection)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function measure(frame) {
    const pending = measurePackage(frame);
    await vi.runAllTimersAsync();
    return pending;
  }

  it('measures a lit picture: 45.2 x 31.8 x 27.9 cm, and says it is a demo', async () => {
    const result = await measure(frameOf(180));

    expect(result.markerDetected).toBe(true);
    expect(result.packageDetected).toBe(true);
    expect(result.dimensions).toMatchObject({ length: 45.2, width: 31.8, height: 27.9 });
    expect(result.problems).toEqual([]);
    expect(result.demo).toBe(true);
  });

  it('finds nothing in a black picture (a covered lens)', async () => {
    const result = await measure(frameOf(5));

    expect(result.dimensions).toBeNull();
    expect(result.problems).toEqual(['noMarker', 'noPackage']);
  });

  it('finds nothing when there is no picture yet', async () => {
    expect((await measure(null)).problems).toEqual(['noMarker', 'noPackage']);
  });
});

describe('the camera service', () => {
  const realMediaDevices = navigator.mediaDevices;
  let track;
  let video;

  beforeEach(() => {
    track = { stop: vi.fn() };
    video = { srcObject: null, setAttribute: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: realMediaDevices, configurable: true });
  });

  function fakeCamera(getUserMedia) {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  }

  it('asks for the back camera and shows it in the video', async () => {
    const stream = { getTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    fakeCamera(getUserMedia);

    await expect(startCamera(video)).resolves.toBe(stream);

    expect(getUserMedia.mock.calls[0][0].video.facingMode).toEqual({ ideal: 'environment' });
    expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalled();
  });

  it('says so when the worker refuses the camera', async () => {
    fakeCamera(vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })));

    await expect(startCamera(video)).rejects.toMatchObject({ code: CAMERA_ERRORS.BLOCKED });
  });

  it('says why when there is no camera API at all', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });

    await expect(startCamera(video)).rejects.toHaveProperty('code');
  });

  it('turns every track off, and is safe to call with nothing', () => {
    video.srcObject = 'stream';
    stopCamera({ getTracks: () => [track, track] }, video);

    expect(track.stop).toHaveBeenCalledTimes(2);
    expect(video.srcObject).toBeNull();
    expect(() => stopCamera(null)).not.toThrow();
  });

  it('names the browser errors', () => {
    expect(describeCameraError({ name: 'NotFoundError' })).toBe(CAMERA_ERRORS.NO_CAMERA);
    expect(describeCameraError({ name: 'NotReadableError' })).toBe(CAMERA_ERRORS.IN_USE);
    expect(describeCameraError({ name: 'Weird' })).toBe(CAMERA_ERRORS.FAILED);
  });
});

describe('saving', () => {
  it('builds the record a future API will take', () => {
    const record = buildMeasurementRecord({
      packageId: 'PKG-0001',
      dimensions: { length: 45.2, width: 31.8, height: 27.9 },
      workerId: 7,
    });

    expect(record).toMatchObject({
      packageId: 'PKG-0001',
      length: 45.2,
      width: 31.8,
      height: 27.9,
      unit: 'cm',
      workerId: 7,
      status: 'confirmed',
      source: 'camera-prototype',
    });
    expect(new Date(record.measuredAt).toString()).not.toBe('Invalid Date');
  });

  it('keeps it in the page for now, not on the server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');

    const answer = await saveMeasurement({
      packageId: '',
      dimensions: { length: 1, width: 2, height: 3 },
      workerId: null,
    });

    expect(answer.savedToServer).toBe(false);
    expect(answer.record.packageId).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
