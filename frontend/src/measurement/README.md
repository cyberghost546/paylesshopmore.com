# Camera measurement (prototype)

> **Switched off.** The page is not reachable in the app while the detection
> is demo data: its route and the button to it were taken out. The code, its
> tests and these notes stay, ready for when it measures for real. To bring it
> back:
>
> 1. In `src/App.jsx`, import it again -
>    `const PackageMeasurement = lazy(() => import('./pages/Warehouse/PackageMeasurement'));`
>    - and add `<Route path="measurements/camera" element={<PackageMeasurement />} />`
>    inside the `/warehouse` routes. Under `measurements/`, so the Measurements
>    access switch covers it.
> 2. Link to `/warehouse/measurements/camera` from the Measurements tab
>    (`src/pages/Warehouse/MeasurementsPage.jsx`).

The Package Measurement page (`/warehouse/measurements/camera`) lets a warehouse
worker point a webcam or phone camera at a package and read its length, width
and height in centimetres.

**It is a prototype.** The camera is real. The marker-to-centimetre maths is
real. The detection that finds the marker and the box in the picture is
**demo data**, and the page says so on screen. A webcam cannot measure
centimetres without calibration, so nothing here replaces the tape measure,
and nothing is saved to a real package record yet.

## How the pieces fit

```
measurement/                      (no React here - plain JavaScript)
  cameraService.js      start / stop the camera, take one still picture
  measurementService.js picture -> marker + box -> centimetres + problems
  measurementUtils.js   the maths: pixels per cm, pixels -> cm, validation
  apiService.js         the record to save (kept in the page for now)
  stationConfig.js      the physical station: platform, fixed markers, camera
                        frame and camera positions (see docs/measurement-station.md
                        and docs/camera-frame.md)

pages/Warehouse/
  PackageMeasurement.jsx   the page: ties the pieces together
  camera/useCamera.js      the camera as a React hook
  camera/CameraPreview.jsx live picture + placement frame
  camera/CameraControls.jsx Start / Scan / Stop
  camera/MeasurementGuide.jsx the frame overlay and the instructions
  camera/MeasurementResult.jsx the three sizes, problems, Confirm / Scan again
  camera/ConfirmationCard.jsx "Measurement confirmed." + Save
```

The camera code never measures, and the measuring code never touches the
camera. Either can be replaced without the other noticing.

## How the measurement is worked out

1. A printed reference marker of known size (10 cm,
   `REFERENCE_MARKER_SIZE_CM`) lies next to the package.
2. Find the marker in the picture and measure it in pixels. For example,
   200 px.
3. Scale = 200 px / 10 cm = **20 px per cm**.
4. Measure the box in pixels and divide by the scale. For example, 904 px /
   20 = **45.2 cm**.

The scale is only right at the marker's distance from the camera, so the
marker must lie on, or right next to, the package. Height cannot be seen from
straight above: it needs a second, side-on picture or a depth camera.

## Making it real, one step at a time

| Replace | With | File |
| --- | --- | --- |
| `detectReferenceMarker()` | OpenCV.js ArUco detection (`cv.aruco`), corners to side length in px | `measurementService.js` |
| `detectPackage()` / `detectPackageEdges()` | A box detector (YOLO, or OpenCV contours + Canny edges) | `measurementService.js` |
| Height | A side-on capture, or a depth camera | `measurementService.js` |
| `DEMO_MODE` | `false` once both detectors are real | `measurementService.js` |
| `SAVE_TO_SERVER` | `true`, using `saveMeasurement()` in `src/api/warehouse.js` | `apiService.js` |

`calculateDimensions()`, the maths in `measurementUtils.js`, the page and its
components stay as they are. One real check already runs: a picture too dark
to contain anything (a covered lens) is refused. That lets the "marker not
detected" path be seen and tested today.

Later additions slot in the same way: barcode or package-ID scanning (the
site already has a barcode scanner, `pages/Dashboard/Scan.jsx`), a weight
scale, measurement history, and label printing.

## Tests

- `measurement/measurement.test.js`: the maths, the camera service against a
  fake browser camera, the pipeline, and the saved record.
- `pages/Warehouse/PackageMeasurement.test.jsx`: the page, start to finish.

To try it in Chrome without a real webcam, start Chrome with
`--use-fake-device-for-media-stream`.
