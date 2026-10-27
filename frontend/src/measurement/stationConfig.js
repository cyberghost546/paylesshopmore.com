// src/measurement/stationConfig.js
//
// The PHYSICAL measurement station, written down as data.
//
// WHAT IS THIS FILE FOR?
// ----------------------
// Somewhere in the warehouse there will be a real, physical table (the
// "platform") with a camera frame behind it. The future computer vision code
// needs to know exactly how that station is built: how big the platform is,
// where the calibration markers are glued down, where the cameras hang. This
// file is that knowledge, in one place.
//
// Rule of thumb: if someone changes the real station (moves a marker, adds a
// frame segment, buys a different camera), they change THIS file, and nothing
// else in the code should need to change.
//
// There is no React here, no camera, and no computer vision. Only numbers and
// a few small helper functions that answer questions like "how high must the
// top camera hang to see a 300 cm tall package?". The drawings are in:
//   docs/measurement-station.md  - stage 1: the platform and the markers
//   docs/camera-frame.md         - stage 2: the camera frame and the mounts
//
// UNITS
// -----
// Every length is in CENTIMETRES (cm). Every angle is in DEGREES.
// When you add a constant, put the unit in its name (..._CM, ..._DEG) so
// nobody has to guess.
//
// THE COORDINATE SYSTEM (how we say "where" something is)
// --------------------------------------------------------
// Think of the station as a 3D graph with three directions, x, y and z.
// Point (0, 0, 0) is the FRONT-LEFT corner of the marked measurement area,
// as seen by the worker standing in front of the station.
//
//                      [ camera frame, behind the platform ]
//              y (away from the worker)
//              ^
//          100 +------------------------+
//              |                        |
//              |    MEASUREMENT AREA    |
//              |      200 x 100 cm      |
//              |                        |
//            0 +------------------------+---> x (to the worker's right)
//              0                       200
//
//                   [ worker stands here ]
//
//   x = along the long side   (0 to 200 cm inside the area)
//   y = along the short side  (0 to 100 cm inside the area)
//   z = straight UP from the top of the platform (0 = the platform surface)
//
// Things outside the area just get numbers outside those ranges. For example
// the platform edge is at x = -10, because the platform is 10 cm bigger than
// the area on every side, and the camera frame is behind it at y = 265.

// ---------------------------------------------------------------------------
// 1. THE PLATFORM (the strong, flat table the package stands on)
// ---------------------------------------------------------------------------

/**
 * The marked zone the package must stand inside. The software measures
 * inside this rectangle only.
 */
export const MEASUREMENT_AREA = {
  lengthCm: 200, // along x
  widthCm: 100, // along y
};

/**
 * The extra border between the measurement area and the edge of the
 * platform, on all four sides. It is intentional: the calibration markers
 * live here, so a package inside the area can never stand on them.
 */
export const PLATFORM_MARGIN_CM = 10;

/**
 * The whole platform: 220 x 120 cm. Worked out from the area + margin, so
 * the two can never disagree. (200 + 10 + 10 = 220, 100 + 10 + 10 = 120.)
 */
export const PLATFORM = {
  lengthCm: MEASUREMENT_AREA.lengthCm + 2 * PLATFORM_MARGIN_CM,
  widthCm: MEASUREMENT_AREA.widthCm + 2 * PLATFORM_MARGIN_CM,

  // How high the top surface is above the warehouse floor. Kept LOW on
  // purpose: heavy packages are slid or forked on, not lifted up. A 15 cm
  // step also has a ramp on the front edge (see the build document).
  surfaceHeightAboveFloorCm: 15,

  // The heaviest package the platform is built for, spread over its base.
  ratedLoadKg: 1500,

  // "Flat" as a number: under the rated load, no point of the surface may
  // sink more than this. More sag would make the floor markers lie about
  // the scale. Check it with a straight edge during maintenance.
  maxDeflectionUnderLoadCm: 0.1, // = 1 mm
};

/**
 * The tallest package the station is DESIGNED for, as first built. This is
 * a target, not a hard limit: the frame can be made taller (section 4).
 *
 * Careful: this is the height of the PACKAGE, not of the frame. The top
 * camera has to hang well above the package, so the frame is much taller
 * than this (see frameSegmentsNeeded()).
 */
export const DESIGN_MEASUREMENT_HEIGHT_CM = 300;

// ---------------------------------------------------------------------------
// 2. THE CALIBRATION MARKERS (the fixed squares the cameras use as a ruler)
// ---------------------------------------------------------------------------
//
// WHY MARKERS?
// A camera only sees pixels, not centimetres. If the camera can see squares
// whose real positions we KNOW (written below), the software can work out
// "this many pixels = this many cm". That is called calibration.
//
// ArUco markers are black-and-white squares (a bit like small QR codes) that
// OpenCV can find very reliably. Each one has a number (its "id"), so the
// software knows WHICH marker it is looking at, not just "a marker".

/** Which family of ArUco markers is printed. OpenCV needs this name to find them. */
export const ARUCO_DICTIONARY = 'DICT_4X4_50';

// --- 2a. Floor markers: glued down, NEVER move ----------------------------
//
// If one is moved, damaged or replaced, the numbers below must be checked
// and every camera recalibrated.

/** The printed side of each floor marker. It fits in the 10 cm margin with 1 cm to spare on each side. */
export const FLOOR_MARKER_SIZE_CM = 8;

// Each marker's CENTRE sits in the middle of the margin (5 cm outside the
// area), diagonally off one corner of the measurement area.
const MARKER_OFFSET_CM = PLATFORM_MARGIN_CM / 2;

/**
 * The four floor markers, one off each corner of the measurement area.
 * `x` and `y` are the marker's CENTRE, in the coordinate system above.
 *
 *    id 3 ●──────────────────● id 2        (back, near the camera frame)
 *         │                  │
 *         │  MEASUREMENT AREA│
 *         │                  │
 *    id 0 ●──────────────────● id 1        (front, near the worker)
 *
 * Going round anticlockwise from the front-left (0, 1, 2, 3) is the order
 * OpenCV uses for a square's corners too, which makes the maths later easier.
 */
export const FLOOR_MARKERS = [
  { id: 0, corner: 'front-left', x: -MARKER_OFFSET_CM, y: -MARKER_OFFSET_CM },
  { id: 1, corner: 'front-right', x: MEASUREMENT_AREA.lengthCm + MARKER_OFFSET_CM, y: -MARKER_OFFSET_CM },
  { id: 2, corner: 'back-right', x: MEASUREMENT_AREA.lengthCm + MARKER_OFFSET_CM, y: MEASUREMENT_AREA.widthCm + MARKER_OFFSET_CM },
  { id: 3, corner: 'back-left', x: -MARKER_OFFSET_CM, y: MEASUREMENT_AREA.widthCm + MARKER_OFFSET_CM },
];

// --- 2b. The calibration post: only there DURING calibration --------------
//
// The floor markers are flat, so they teach the cameras about the floor. The
// SIDE cameras measure height, so they also need to see known heights. For
// that there is a removable calibration post: a straight board with markers
// every 50 cm going up.
//
// The POST is removable (it would be in the way of packages), but the two
// SOCKETS it stands in are fixed holes in the platform margin. Because the
// sockets never move, the post always ends up in exactly the same place.
// Standing it in the front socket and then the back socket shows the side
// cameras a known height at two known distances.

/** The fixed holes in the platform margin the calibration post stands in. x and y are the hole's centre. */
export const CALIBRATION_POST_SOCKETS = [
  { name: 'front', x: MEASUREMENT_AREA.lengthCm / 2, y: -MARKER_OFFSET_CM },
  { name: 'back', x: MEASUREMENT_AREA.lengthCm / 2, y: MEASUREMENT_AREA.widthCm + MARKER_OFFSET_CM },
];

export const CALIBRATION_POST_MARKER_SIZE_CM = 10;
export const CALIBRATION_POST_MARKER_SPACING_CM = 50;

/**
 * The post as first built. 10 cm taller than DESIGN_MEASUREMENT_HEIGHT_CM so
 * the top marker can sit right AT the design height (300 cm). It plugs
 * together from pieces; add a piece when the frame is extended.
 */
export const CALIBRATION_POST_HEIGHT_CM = DESIGN_MEASUREMENT_HEIGHT_CM + 10;

// ---------------------------------------------------------------------------
// 3. THE CAMERAS
// ---------------------------------------------------------------------------
//
// FIELD OF VIEW (FOV), in one sentence: how wide a camera "looks", as an
// angle. A camera with a 90 degree FOV sees a slice of the world shaped like
// a quarter of a pizza. The further away it is, the more it sees - but each
// thing looks smaller, so the measurement gets less precise.
//
// Every camera has two FOV angles: horizontal (left-right) and vertical
// (up-down). The numbers below are for a typical depth camera (for example
// an Intel RealSense D455). If you buy a different camera, copy the numbers
// from its datasheet.
//
// "resolutionPx" is how many pixels the picture has across and down. More
// pixels = each pixel covers fewer centimetres = a more precise measurement.

/**
 * The TOP camera: looks straight DOWN at the package to measure its length
 * and width. It hangs from the end of a boom (an arm) that reaches forward
 * from the camera frame, over the centre of the measurement area. The boom
 * slides up and down the frame, so the camera can always hang above even a
 * very tall package.
 */
export const TOP_CAMERA = {
  horizontalFovDeg: 87, // along x, the long side
  verticalFovDeg: 58, // along y, the short side
  resolutionPx: { width: 1280, height: 800 },
  // Directly above the centre of the measurement area.
  x: MEASUREMENT_AREA.lengthCm / 2,
  y: MEASUREMENT_AREA.widthCm / 2,
  // The camera must see a bit MORE than the platform, all round, so the
  // floor markers are never right at the edge of the picture (lenses are
  // blurriest and most distorted at the edges).
  viewMarginCm: 10,
  // The camera must never be closer than this to the top of the package.
  // Two reasons: closer than this a depth camera cannot see clearly, and it
  // leaves room so a package being put down cannot hit the camera.
  minClearanceAbovePackageCm: 50,
};

/**
 * The SIDE camera(s): look at the package from the side to measure its
 * HEIGHT. They are on the camera frame BEHIND the platform, and look
 * forward (towards the worker), so they see the package's long side: the
 * full 220 cm length of the platform, and its height.
 *
 * A tall package does not fit in one camera picture, so the frame can carry
 * SEVERAL side cameras stacked one above the other, each covering one
 * "band" of height. sideCameraPlan() below works out how many, and where.
 */
export const SIDE_CAMERA = {
  horizontalFovDeg: 87, // across the platform's 220 cm length
  verticalFovDeg: 58, // this is the one that matters for height
  resolutionPx: { width: 1280, height: 800 },
  // In the middle of the platform's length, so it sees both ends equally.
  x: MEASUREMENT_AREA.lengthCm / 2,
  // Distance from the back edge of the measurement area (y = 100) to the
  // camera lens. Why 150? It is the shortest distance at which two cameras
  // still cover a 300 cm package, and at which one camera still sees the
  // whole platform length with room to spare. Closer = more cameras needed.
  standoffFromAreaCm: 150,
  // Neighbouring cameras' pictures overlap by this much, so no part of the
  // package falls into a gap between two cameras.
  overlapCm: 20,
  // Each camera's view should reach a bit above the package, so the top
  // edge is clearly visible and not cut off by the edge of the picture.
  marginAbovePackageCm: 10,
  // Same idea sideways: see this much past each end of the platform.
  viewMarginCm: 10,
};

/** Where the side cameras' lenses are, front to back (y). Worked out so it can never disagree with the standoff. */
export const SIDE_CAMERA_LENS_Y_CM = MEASUREMENT_AREA.widthCm + SIDE_CAMERA.standoffFromAreaCm;

// ---------------------------------------------------------------------------
// 4. THE CAMERA FRAME (what the cameras hang on)
// ---------------------------------------------------------------------------
//
// ONE frame, standing BEHIND the platform, carries every camera:
//
//   - two upright POSTS, one at each end of the platform, with a rail on
//     their front face;
//   - CAMERA BARS: horizontal bars that span the two posts and slide up
//     and down the rails. Each side camera sits on its own bar;
//   - the BOOM: an arm on its own bar that reaches forward over the
//     platform and holds the top camera.
//
// Why behind? The FRONT of the platform is where the worker and the forklift
// load packages, so nothing may stand there. Behind, the frame is out of
// everyone's way.
//
// THERE IS NO ROOF on purpose. A roof (or a fixed camera height) would put a
// hard limit on package height. Instead, each post is built from identical
// stackable SEGMENTS. Need taller? Bolt on another segment, and slide the
// bars up.
//
// The frame is bolted to the FLOOR, not to the platform. When a heavy
// package is dropped onto the platform, the platform shakes - the cameras
// must not shake with it.

/** One post segment is this long. Add one to each post to make the frame 1 m taller. */
export const FRAME_SEGMENT_LENGTH_CM = 100;

/**
 * How many segments each post has when first built: 5 x 100 cm = 5 m tall.
 * That is the fewest that can measure DESIGN_MEASUREMENT_HEIGHT_CM (the
 * tests check this), so the first build already meets the 300 cm target.
 */
export const DEFAULT_FRAME_SEGMENTS = 5;

/**
 * The top of a post is not usable for a camera: the cap and the top clamp
 * take some room. A bar can go no higher than this below the top.
 */
export const FRAME_TOP_RESERVED_CM = 20;

/** Where the frame stands. Lengths in cm, in the station's coordinates. */
export const CAMERA_FRAME = {
  // The posts' centre line, front to back. The side camera lenses stick out
  // 15 cm in front of it on their mounts (lens at y = 250, posts at 265).
  postsY: SIDE_CAMERA_LENS_Y_CM + 15,
  // The two posts' centres, left and right. Just outside the platform's
  // ends, so a forklift driving past a package can see them.
  postsX: [-PLATFORM_MARGIN_CM - 5, MEASUREMENT_AREA.lengthCm + PLATFORM_MARGIN_CM + 5],
  // Diagonal braces run backwards from each post to the floor. This is how
  // far behind the posts they land. They are what stop a 5 m frame swaying.
  braceFootprintCm: 150,
};

/**
 * How far the boom reaches forward, from the posts to the top camera.
 * Long, so the boom has a diagonal knee brace underneath it (see the doc).
 */
export function boomReachCm() {
  return CAMERA_FRAME.postsY - TOP_CAMERA.y;
}

/**
 * Every place a camera CAN be mounted, whether or not a camera is there yet.
 *
 * The first prototype only needs the ones with `installed: true`. The rest
 * are planned now - the bars, holes and cable routes are built in - so a
 * camera can be added later without rebuilding the frame.
 */
export const CAMERA_SLOTS = [
  { id: 'top', role: 'length + width (depth camera)', mount: 'boom tip, pointing down', installed: true },
  { id: 'top-hires', role: 'length + width (sharper picture, see cmPerPixel)', mount: 'boom tip, beside "top"', installed: false },
  { id: 'side-1', role: 'height, lower band', mount: 'camera bar 1', installed: true },
  { id: 'side-2', role: 'height, upper band (packages over ~156 cm)', mount: 'camera bar 2', installed: true },
  { id: 'side-3', role: 'height, packages over ~302 cm', mount: 'camera bar 3 (spare)', installed: false },
  { id: 'front', role: 'front face, angled down 45 degrees', mount: 'boom tip, facing the worker side', installed: false },
  { id: 'end-left', role: 'left end face', mount: 'short end mast, floor socket left of the platform', installed: false },
  { id: 'end-right', role: 'right end face', mount: 'short end mast, floor socket right of the platform', installed: false },
];

// ---------------------------------------------------------------------------
// 5. HELPER FUNCTIONS
// ---------------------------------------------------------------------------
//
// Small, pure functions: same input, same output, no side effects. That
// makes them easy to test (see stationConfig.test.js).

/** Degrees to radians. JavaScript's Math.tan() wants radians, people think in degrees. */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * How far a camera must be from something so the WHOLE thing fits in the
 * picture.
 *
 * THE MATHS, drawn out. The camera is at the top; the thing it must see is
 * the line at the bottom. Cut the picture down the middle and you get a
 * right-angled triangle:
 *
 *            camera
 *              /|
 *             / |
 *            /  |  distance   <- what we want
 *    half    /   |
 *    the FOV/    |
 *  angle -->/____|
 *           half of the size
 *
 *   tan(half the FOV) = (half the size) / distance
 *   so:     distance  = (half the size) / tan(half the FOV)
 *
 * Example: to see 200 cm with a 90 degree camera:
 *   100 / tan(45 degrees) = 100 / 1 = 100 cm away.
 *
 * @param {number} sizeCm  how big the thing is (in the direction the FOV is for)
 * @param {number} fovDeg  the camera's field of view in that direction, in degrees
 * @returns {number} the minimum distance, in cm
 */
export function distanceToSee(sizeCm, fovDeg) {
  return sizeCm / 2 / Math.tan(toRadians(fovDeg / 2));
}

/**
 * The opposite question: at this distance, how much can the camera see?
 * Same triangle as distanceToSee(), solved for the size instead.
 *
 * @param {number} distanceCm
 * @param {number} fovDeg
 * @returns {number} how many cm fit in the picture, edge to edge
 */
export function coverageAtDistance(distanceCm, fovDeg) {
  return 2 * distanceCm * Math.tan(toRadians(fovDeg / 2));
}

/**
 * How many centimetres ONE pixel covers, for something this far away.
 * This is the best precision you can hope for: an edge can only be found to
 * within a pixel or two. Smaller is better.
 *
 * Example: 1280 pixels across, seeing 770 cm -> 770 / 1280 = 0.6 cm per pixel.
 *
 * @param {number} distanceCm
 * @param {number} fovDeg
 * @param {number} pixels  the picture's pixels in the same direction as fovDeg
 */
export function cmPerPixel(distanceCm, fovDeg, pixels) {
  return coverageAtDistance(distanceCm, fovDeg) / pixels;
}

/**
 * How high (above the platform surface) the TOP camera must hang for a
 * package of this height.
 *
 * Three things must ALL be true, so we take the biggest of the three:
 *
 *   a) It sees all four floor markers. The markers sit around the area, so
 *      it must see the whole platform (220 x 120 cm) plus viewMarginCm all
 *      round, from the floor up.
 *   b) It sees the whole top of the package. The biggest top that fits is
 *      the full area (200 x 100 cm), seen from the package's top surface.
 *   c) It stays at least minClearanceAbovePackageCm above the package.
 *
 * For a) and b) we check both directions (length uses the horizontal FOV,
 * width uses the vertical FOV) and keep the bigger distance, because the
 * picture is a rectangle and both sides must fit.
 *
 * @param {number} packageHeightCm  the tallest package to be measured
 * @param {object} [camera]         defaults to TOP_CAMERA
 * @returns {number} camera height above the platform surface, in cm, rounded up
 */
export function requiredTopCameraHeight(packageHeightCm, camera = TOP_CAMERA) {
  const fitBoth = (lengthCm, widthCm) =>
    Math.max(
      distanceToSee(lengthCm, camera.horizontalFovDeg),
      distanceToSee(widthCm, camera.verticalFovDeg),
    );

  // a) From the floor: the whole platform, markers included, plus a margin.
  const margin = 2 * camera.viewMarginCm;
  const toSeeMarkers = fitBoth(PLATFORM.lengthCm + margin, PLATFORM.widthCm + margin);
  // b) From the top of the package: the whole measurement area.
  const toSeePackageTop = packageHeightCm + fitBoth(MEASUREMENT_AREA.lengthCm, MEASUREMENT_AREA.widthCm);
  // c) Safety gap.
  const toStayClear = packageHeightCm + camera.minClearanceAbovePackageCm;

  return Math.ceil(Math.max(toSeeMarkers, toSeePackageTop, toStayClear));
}

/**
 * Where the TOP camera is clamped in normal use: high enough for the design
 * height (300 cm). It stays there for every package, small or tall.
 *
 * Why not lower it for small parcels? Every time a camera moves it has to be
 * recalibrated, and a worker might forget to raise it before a tall package
 * arrives and the package would hit it. One fixed, locked height is safer.
 */
export const TOP_CAMERA_OPERATING_HEIGHT_CM = requiredTopCameraHeight(DESIGN_MEASUREMENT_HEIGHT_CM);

/**
 * Where the side cameras go for a package of this height: how many cameras,
 * and at what height to clamp each one.
 *
 * One camera at standoffFromAreaCm sees a band of height (its "coverage").
 * The bottom camera is clamped so its band starts at the platform surface.
 * Each next camera goes one band higher, minus the overlap, until the bands
 * reach the top of the package (plus a small margin).
 *
 *     z
 *     ^   ┌──────┐
 *     |   │cam 2 │  <- band 2
 *     |   ├──────┤  <- overlap
 *     |   │cam 1 │  <- band 1
 *     0 ══╧══════╧══ platform surface
 *
 * @param {number} packageHeightCm
 * @param {object} [camera]  defaults to SIDE_CAMERA
 * @returns {{ coveragePerCameraCm: number, cameras: { index: number, mountHeightCm: number }[] }}
 *   mountHeightCm is the height of the lens above the platform surface
 */
export function sideCameraPlan(packageHeightCm, camera = SIDE_CAMERA) {
  const coverage = coverageAtDistance(camera.standoffFromAreaCm, camera.verticalFovDeg);
  // Each extra camera adds one band, minus the part that overlaps the band below.
  const step = coverage - camera.overlapCm;
  const heightToCover = packageHeightCm + camera.marginAbovePackageCm;

  // The first camera covers `coverage` cm. Whatever is left above that needs
  // extra cameras, each adding `step` cm. Math.ceil rounds UP, because half
  // a camera is not a thing: 1.2 cameras' worth of height means 2 cameras.
  const count = heightToCover <= coverage ? 1 : 1 + Math.ceil((heightToCover - coverage) / step);

  // A camera looking straight ahead sees as much above its lens as below, so
  // the lens sits in the MIDDLE of its band. Band i starts at i * step.
  const cameras = Array.from({ length: count }, (_, index) => ({
    index,
    mountHeightCm: Math.round(index * step + coverage / 2),
  }));

  return { coveragePerCameraCm: Math.round(coverage), cameras };
}

/**
 * Whether one side camera sees the whole platform length (plus a margin at
 * each end), at the NEAREST place a package face can be: the back edge of
 * the measurement area. Further away it sees even more, so this is the
 * worst case.
 *
 * @param {object} [camera]  defaults to SIDE_CAMERA
 * @returns {{ seenCm: number, neededCm: number, ok: boolean }}
 */
export function sideCameraWidthCheck(camera = SIDE_CAMERA) {
  const seenCm = Math.round(coverageAtDistance(camera.standoffFromAreaCm, camera.horizontalFovDeg));
  const neededCm = PLATFORM.lengthCm + 2 * camera.viewMarginCm;
  return { seenCm, neededCm, ok: seenCm >= neededCm };
}

/**
 * The highest a camera bar can be clamped on a frame with this many
 * segments, measured above the PLATFORM SURFACE (not the floor).
 *
 * Remember: the frame stands on the floor, but our z = 0 is the platform's
 * top, which is surfaceHeightAboveFloorCm higher. So we subtract that.
 *
 * @param {number} [segments]  defaults to DEFAULT_FRAME_SEGMENTS
 */
export function highestCameraMountCm(segments = DEFAULT_FRAME_SEGMENTS) {
  return segments * FRAME_SEGMENT_LENGTH_CM - FRAME_TOP_RESERVED_CM - PLATFORM.surfaceHeightAboveFloorCm;
}

/**
 * How many frame segments are needed to measure a package of this height.
 * This is the question to ask before a taller-than-usual package arrives:
 * if the answer is bigger than the segments the frame has now, extend it
 * first (and check the warehouse ceiling, lights and sprinklers!).
 *
 * The TOP camera is the one that needs to be highest, so it decides.
 *
 * @param {number} packageHeightCm
 * @returns {number} a whole number of segments
 */
export function frameSegmentsNeeded(packageHeightCm) {
  const cameraHeightAboveFloor =
    requiredTopCameraHeight(packageHeightCm) + PLATFORM.surfaceHeightAboveFloorCm + FRAME_TOP_RESERVED_CM;
  return Math.ceil(cameraHeightAboveFloor / FRAME_SEGMENT_LENGTH_CM);
}

/**
 * The tallest package the station can measure with this many frame segments.
 * Handy for a sign on the station, or a warning in the app later.
 *
 * Worked backwards from requiredTopCameraHeight(): the camera must be
 * "package height + the bigger of (distance to see the area, safety gap)".
 *
 * @param {number} [segments]  defaults to DEFAULT_FRAME_SEGMENTS
 * @returns {number} cm, rounded down
 */
export function maxPackageHeightCm(segments = DEFAULT_FRAME_SEGMENTS) {
  const seeArea = Math.max(
    distanceToSee(MEASUREMENT_AREA.lengthCm, TOP_CAMERA.horizontalFovDeg),
    distanceToSee(MEASUREMENT_AREA.widthCm, TOP_CAMERA.verticalFovDeg),
  );
  const spaceNeededAbovePackage = Math.max(seeArea, TOP_CAMERA.minClearanceAbovePackageCm);
  return Math.floor(highestCameraMountCm(segments) - spaceNeededAbovePackage);
}

/**
 * The markers on the calibration post, for a post this tall: one every
 * CALIBRATION_POST_MARKER_SPACING_CM, starting 50 cm up, ids from 10 (so
 * they can never be mixed up with the floor markers, 0-3).
 *
 * `z` is the marker's centre above the platform surface. Where the post
 * stands (x, y) depends on which socket it is in: CALIBRATION_POST_SOCKETS.
 *
 * @param {number} [postHeightCm]  defaults to CALIBRATION_POST_HEIGHT_CM
 * @returns {{ id: number, z: number }[]}
 */
export function calibrationPostMarkers(postHeightCm = CALIBRATION_POST_HEIGHT_CM) {
  const markers = [];
  const half = CALIBRATION_POST_MARKER_SIZE_CM / 2;
  // Keep going while the whole marker (centre + half its size) fits on the post.
  for (let z = CALIBRATION_POST_MARKER_SPACING_CM; z + half <= postHeightCm; z += CALIBRATION_POST_MARKER_SPACING_CM) {
    markers.push({ id: 10 + markers.length, z });
  }
  return markers;
}
