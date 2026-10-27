// The physical measurement station: its sizes, its fixed markers, the
// camera frame, and the camera-placement maths. Uses the example packages
// from the station brief, from a small 10 x 10 x 5 cm box to a 300 cm tall one.

import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_POST_SOCKETS,
  CAMERA_FRAME,
  CAMERA_SLOTS,
  DEFAULT_FRAME_SEGMENTS,
  DESIGN_MEASUREMENT_HEIGHT_CM,
  FLOOR_MARKERS,
  FLOOR_MARKER_SIZE_CM,
  MEASUREMENT_AREA,
  PLATFORM,
  PLATFORM_MARGIN_CM,
  SIDE_CAMERA,
  SIDE_CAMERA_LENS_Y_CM,
  TOP_CAMERA,
  TOP_CAMERA_OPERATING_HEIGHT_CM,
  boomReachCm,
  calibrationPostMarkers,
  cmPerPixel,
  coverageAtDistance,
  distanceToSee,
  frameSegmentsNeeded,
  highestCameraMountCm,
  maxPackageHeightCm,
  requiredTopCameraHeight,
  sideCameraPlan,
  sideCameraWidthCheck,
} from './stationConfig';

// Package heights from the brief, smallest to tallest.
const HEIGHTS_CM = [5, 12, 20, 40, 100, 250, 270, 300];

describe('the platform', () => {
  it('is 220 x 120 cm around a 200 x 100 cm measurement area', () => {
    expect(MEASUREMENT_AREA).toEqual({ lengthCm: 200, widthCm: 100 });
    expect(PLATFORM.lengthCm).toBe(220);
    expect(PLATFORM.widthCm).toBe(120);
  });
});

describe('the floor markers', () => {
  it('are four, with ids 0 to 3', () => {
    expect(FLOOR_MARKERS.map((m) => m.id)).toEqual([0, 1, 2, 3]);
  });

  it('sit entirely in the margin: never inside the area, never off the platform', () => {
    const half = FLOOR_MARKER_SIZE_CM / 2;
    for (const { x, y } of FLOOR_MARKERS) {
      // Off the platform? The platform runs from -margin to area + margin.
      expect(x - half).toBeGreaterThanOrEqual(-PLATFORM_MARGIN_CM);
      expect(x + half).toBeLessThanOrEqual(MEASUREMENT_AREA.lengthCm + PLATFORM_MARGIN_CM);
      expect(y - half).toBeGreaterThanOrEqual(-PLATFORM_MARGIN_CM);
      expect(y + half).toBeLessThanOrEqual(MEASUREMENT_AREA.widthCm + PLATFORM_MARGIN_CM);
      // Inside the area? At least one side of the marker must be fully outside it.
      const outsideX = x + half <= 0 || x - half >= MEASUREMENT_AREA.lengthCm;
      const outsideY = y + half <= 0 || y - half >= MEASUREMENT_AREA.widthCm;
      expect(outsideX || outsideY).toBe(true);
    }
  });

  it('are a known distance apart (210 x 110 cm, centre to centre), which is what gives the scale', () => {
    const [m0, m1, , m3] = FLOOR_MARKERS;
    expect(m1.x - m0.x).toBe(MEASUREMENT_AREA.lengthCm + PLATFORM_MARGIN_CM);
    expect(m3.y - m0.y).toBe(MEASUREMENT_AREA.widthCm + PLATFORM_MARGIN_CM);
  });
});

describe('the calibration post', () => {
  it('stands in sockets in the margin, clear of the floor markers', () => {
    for (const socket of CALIBRATION_POST_SOCKETS) {
      const outsideArea = socket.y < 0 || socket.y > MEASUREMENT_AREA.widthCm;
      expect(outsideArea).toBe(true);
      for (const marker of FLOOR_MARKERS) {
        expect(Math.abs(socket.x - marker.x)).toBeGreaterThan(FLOOR_MARKER_SIZE_CM);
      }
    }
  });

  it('has a marker every 50 cm up to the design height, ids from 10', () => {
    const markers = calibrationPostMarkers();
    expect(markers[0]).toEqual({ id: 10, z: 50 });
    expect(markers.at(-1).z).toBe(DESIGN_MEASUREMENT_HEIGHT_CM);
  });

  it('gets more markers when it is made taller', () => {
    expect(calibrationPostMarkers(410).length).toBeGreaterThan(calibrationPostMarkers().length);
  });
});

describe('the camera maths', () => {
  it('a 90 degree camera must be 100 cm away to see 200 cm', () => {
    expect(distanceToSee(200, 90)).toBeCloseTo(100);
  });

  it('distanceToSee and coverageAtDistance undo each other', () => {
    expect(coverageAtDistance(distanceToSee(137, 58), 58)).toBeCloseTo(137);
  });

  it('one pixel covers more centimetres the further away the camera is', () => {
    expect(cmPerPixel(400, 90, 1000)).toBeCloseTo(0.8);
    expect(cmPerPixel(400, 90, 1000)).toBeGreaterThan(cmPerPixel(200, 90, 1000));
  });
});

describe('the top camera', () => {
  it('always hangs above the package with room to spare', () => {
    for (const height of HEIGHTS_CM) {
      expect(requiredTopCameraHeight(height)).toBeGreaterThanOrEqual(height + TOP_CAMERA.minClearanceAbovePackageCm);
    }
  });

  it('sees the whole 220 x 120 cm platform plus a margin, even at its lowest', () => {
    const lowest = requiredTopCameraHeight(0);
    const margin = 2 * TOP_CAMERA.viewMarginCm;
    expect(coverageAtDistance(lowest, TOP_CAMERA.horizontalFovDeg)).toBeGreaterThanOrEqual(PLATFORM.lengthCm + margin);
    expect(coverageAtDistance(lowest, TOP_CAMERA.verticalFovDeg)).toBeGreaterThanOrEqual(PLATFORM.widthCm + margin);
  });

  it('goes up as packages get taller (no fixed height)', () => {
    const heights = HEIGHTS_CM.map((h) => requiredTopCameraHeight(h));
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
    expect(requiredTopCameraHeight(300)).toBeGreaterThan(requiredTopCameraHeight(250));
  });

  it('is clamped, in normal use, high enough for a 300 cm package', () => {
    expect(TOP_CAMERA_OPERATING_HEIGHT_CM).toBe(requiredTopCameraHeight(300));
    expect(TOP_CAMERA_OPERATING_HEIGHT_CM).toBeLessThanOrEqual(highestCameraMountCm());
  });

  it('hangs from a boom that reaches from the frame to above the centre of the area', () => {
    expect(boomReachCm()).toBe(CAMERA_FRAME.postsY - MEASUREMENT_AREA.widthCm / 2);
  });
});

describe('the side cameras', () => {
  it('stand behind the platform, never on the loading side', () => {
    expect(SIDE_CAMERA_LENS_Y_CM).toBeGreaterThan(MEASUREMENT_AREA.widthCm + PLATFORM_MARGIN_CM);
    expect(CAMERA_FRAME.postsY).toBeGreaterThan(SIDE_CAMERA_LENS_Y_CM);
  });

  it('see the whole 220 cm platform length, with a margin', () => {
    const { seenCm, neededCm, ok } = sideCameraWidthCheck();
    expect(neededCm).toBe(PLATFORM.lengthCm + 2 * SIDE_CAMERA.viewMarginCm);
    expect(ok).toBe(true);
    expect(seenCm).toBeGreaterThanOrEqual(neededCm);
  });

  it('one camera is enough for small, medium and large packages', () => {
    expect(sideCameraPlan(5).cameras).toHaveLength(1);
    expect(sideCameraPlan(20).cameras).toHaveLength(1);
    expect(sideCameraPlan(100).cameras).toHaveLength(1);
  });

  it('two cameras, stacked up the frame, cover a 300 cm package', () => {
    const { cameras } = sideCameraPlan(300);
    expect(cameras).toHaveLength(2);
    expect(cameras[1].mountHeightCm).toBeGreaterThan(cameras[0].mountHeightCm);
  });

  it('together, the cameras cover the platform up to above the top of the package', () => {
    for (const height of [...HEIGHTS_CM, 350, 400]) {
      const { coveragePerCameraCm, cameras } = sideCameraPlan(height);
      const bottom = cameras[0].mountHeightCm - coveragePerCameraCm / 2;
      const top = cameras.at(-1).mountHeightCm + coveragePerCameraCm / 2;
      expect(bottom).toBeLessThanOrEqual(0.5); // rounding
      expect(top).toBeGreaterThanOrEqual(height);
    }
  });

  it('the prototype installs exactly the cameras a 300 cm package needs', () => {
    const installedSide = CAMERA_SLOTS.filter((s) => s.installed && s.id.startsWith('side-'));
    expect(installedSide).toHaveLength(sideCameraPlan(DESIGN_MEASUREMENT_HEIGHT_CM).cameras.length);
  });
});

describe('the camera frame', () => {
  it('as first built, measures every package in the brief, 300 cm included', () => {
    expect(maxPackageHeightCm()).toBeGreaterThanOrEqual(DESIGN_MEASUREMENT_HEIGHT_CM);
    for (const height of HEIGHTS_CM) {
      expect(frameSegmentsNeeded(height)).toBeLessThanOrEqual(DEFAULT_FRAME_SEGMENTS);
    }
  });

  it('is not taller than it needs to be for 300 cm', () => {
    expect(frameSegmentsNeeded(DESIGN_MEASUREMENT_HEIGHT_CM)).toBe(DEFAULT_FRAME_SEGMENTS);
  });

  it('grows by one 100 cm segment for every 100 cm more package', () => {
    expect(maxPackageHeightCm(DEFAULT_FRAME_SEGMENTS + 1) - maxPackageHeightCm()).toBe(100);
    expect(frameSegmentsNeeded(maxPackageHeightCm() + 50)).toBe(DEFAULT_FRAME_SEGMENTS + 1);
  });

  it('every side camera a package needs fits on the frame', () => {
    const { cameras } = sideCameraPlan(maxPackageHeightCm());
    expect(cameras.at(-1).mountHeightCm).toBeLessThanOrEqual(highestCameraMountCm());
  });
});
