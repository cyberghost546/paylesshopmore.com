# Package measurement station: physical design

This is the physical station where a worker puts a package down so that
cameras can measure its length, width and height. This stage covers the
hardware only. The React screens and the computer vision come later.

Every number in this document is also in
[`frontend/src/measurement/stationConfig.js`](../frontend/src/measurement/stationConfig.js).
**That file is the source of truth.** If you change the real station, change
that file, and the numbers here, in the same commit.

## The idea in one picture

```
              SIDE VIEW (from the right end; the worker loads from the left)

                                                      camera frame
        📷 TOP CAMERA ═══════════ boom ═══════════════╡║╲   (no roof:
         ↓                                             ║ ╲   posts grow
                                         side-2 📷 ◄───╢  ╲  in 100 cm
        ┌──────────┐                                   ║   ╲ segments)
        │ PACKAGE  │                     side-1 📷 ◄───╢    ╲
   ramp╱┴──●───────┴──●──╮                             ║     ╲
 ═══════════════════════════════════════════════════════╩══════╩═ floor
  🧍    PLATFORM 220 × 120 cm,      keep-out zone
        15 cm high                  ● = fixed floor marker
```

There is no roof and no fixed camera height. Every camera hangs on one frame
**behind** the platform, built from 100 cm segments. To measure taller
packages, bolt on another segment and move the cameras up. The frame is
designed in stage 2: [camera-frame.md](camera-frame.md).

## Coordinates

All positions use one coordinate system, in centimetres:

- **(0, 0, 0)** is the front-left corner of the measurement area, as seen by
  the worker.
- **x** runs to the right along the 200 cm side.
- **y** runs away from the worker along the 100 cm side.
- **z** runs up from the platform surface, not from the floor.

## 1. Platform

```
                         220 cm
        ┌──────────────────────────────────────┐
        │ ●id3                            id2● │  ← back
        │   ┌──────────────────────────────┐   │
        │   │                              │   │
 120 cm │   │   MEASUREMENT AREA 200×100   │   │
        │   │                              │   │
        │   └──────────────────────────────┘   │
        │ ●id0                            id1● │  ← front (worker, loading side)
        └──────────────────────────────────────┘
          ↑ 10 cm margin on every side
```

| Item | Spec |
| --- | --- |
| Overall size | 220 × 120 cm |
| Measurement area | 200 × 100 cm, centred, 10 cm margin all round |
| Surface height | 15 cm above the floor, with a 1:6 steel ramp on the front edge for pallet jacks |
| Rated load | 1500 kg, spread out. State it on a placard on the front edge |
| Flatness | no more than 1 mm of sag anywhere under the rated load |
| Frame | welded steel, 60 × 60 × 3 mm square tube perimeter, cross members every 50 cm, 6 levelling feet |
| Deck | 6 mm steel plate on the frame, topped with a 3 mm matte HPL laminate in **mid-grey** |
| Edges | yellow/black hazard tape on the frame edges, rubber corner guards |

**Why mid-grey and matte?** Cardboard is brown, white or printed. A plain
grey that doesn't reflect light gives the cameras strong contrast with every
package and no glare.

**Measurement area markings:**

- A 5 mm black line on the area's outline. Its *inner* edge is the
  boundary.
- Tick marks every 10 cm along all four edges, longer every 50 cm, with
  numbers every 50 cm.
- Print or engrave these into the laminate. Stickers peel and shift.

## 2. Calibration markers

The cameras use these markers to turn pixels into centimetres. **They are
fixed for good.** Never move, cover or replace one without recalibrating.

### Floor markers (scale for length and width)

| id | Corner | Centre (x, y) |
| --- | --- | --- |
| 0 | front-left | (-5, -5) |
| 1 | front-right | (205, -5) |
| 2 | back-right | (205, 105) |
| 3 | back-left | (-5, 105) |

- ArUco dictionary `DICT_4X4_50`, printed 8 × 8 cm, with a white border.
- Each marker sits in the middle of the 10 cm margin. That leaves 1 cm of
  clearance to the area line and 1 cm to the platform edge, so a package
  standing inside the area never touches one.
- Recess each marker 1 mm into the deck, under a bonded matte polycarbonate
  cover, so pallet jacks and boots can't scuff it.
- Seen from above, a package that stays inside the area can never hide a
  marker from the top camera. The camera hangs above the area, so it always
  looks *past* the package's sides towards the margin.

### Calibration post sockets (for the side cameras)

Two 30 mm steel sleeves sit flush in the margin, at front-centre (100, −5)
and back-centre (100, 105), clear of the floor markers. During calibration
a removable post carrying markers 10–15 (one every 50 cm, up to 300 cm)
stands in them. See [camera-frame.md](camera-frame.md), section 8.

## 3. Cameras and frame

All of this is designed in stage 2, [camera-frame.md](camera-frame.md). In
short:

| Camera | Measures | Mounted on | Working position |
| --- | --- | --- | --- |
| Top | length and width | tip of a braced boom reaching forward from the frame | (100, 50), z = 406, pointing straight down |
| Side 1 and 2 (3 later) | height | camera bars sliding on the frame posts | x = 100, y = 250, z = 83 and 229, facing the worker side |

- Designed for packages up to **300 cm**. The frame as first built (5 × 100
  cm segments) actually reaches **359 cm**, and each extra segment adds
  100 cm.
- Camera numbers are for a typical depth camera (87° × 58° field of view,
  for example an Intel RealSense D455). With a different camera, update the
  field of view in `stationConfig.js` and the heights recalculate.

**Note for the vision software:** the floor markers give the scale *at the
floor*. The top of a tall package is nearer the camera, so it looks bigger.
Use the depth camera's distance, or the height from the side cameras, to
correct for this. Never apply the floor scale to the top surface as it is.

## 4. Lighting

- Two diffuse LED panels (5000 K, flicker-free) on each frame post, angled
  at the area from both sides. They light evenly and cast no hard shadows. A
  hard shadow can look like an edge to the software.
- No light source in any camera's view.
- Keep direct sunlight off the platform.

## 5. Platform safety

- The front long side and both ends stay fully open for forklifts and
  pallet jacks. The camera frame stands behind the platform.
- Hazard tape on the platform edges, rubber corner guards, and the rated
  load on a placard.
- Never stand on the measurement platform to reach a camera.
- Frame, cable and work-at-height safety: [camera-frame.md](camera-frame.md),
  section 11.

## 6. Calibration procedure

Do this when the station is first built, after any camera has been moved,
and once a month.

1. Clear the platform. Check all four floor markers are clean, flat and
   undamaged.
2. Check flatness with a 2 m straight edge along both diagonals. Anything
   above 1 mm: re-level the feet.
3. Check the top camera is at its working height (z = 406) and locked, and
   its witness paint is unbroken. Note the rail mark.
4. Set the side cameras to the heights from `sideCameraPlan()` and clamp
   them. Note the rail marks.
5. In the (future) calibration screen, check that the top camera detects
   markers 0–3. Stand the calibration post in the front socket, then the
   back socket, and check each side camera detects its markers.
6. Measure a **reference box** of known size (keep one at the station, for
   example 60 × 40 × 40 cm), plus a tall reference (a 300 cm pole standing on
   the area). Each reading must be within ±1 cm.
7. Log the date, rail marks and reference readings.

## 7. Worker placement rules

The app will later show these. Until then, put them on a sign at the station:

1. Place the package inside the marked area.
2. Make sure the package is completely visible.
3. Do not cover the calibration markers.
4. Keep the package inside the measurement zone.
5. Step out of the yellow line before measuring.

## 8. Ready for the software

The hardware is set up so the next stages slot in without rebuilding it:

| Future part | What the station already provides |
| --- | --- |
| OpenCV + ArUco | fixed markers with known ids and positions (`FLOOR_MARKERS`, `CALIBRATION_POST_SOCKETS`, `calibrationPostMarkers()`) |
| Depth cameras | mounts and clearances sized for a depth camera's field of view and minimum range |
| Multiple cameras | camera bars, planned slots (`CAMERA_SLOTS`) and `sideCameraPlan()` for any number of side cameras |
| React app | worker instructions (section 7) and a way to warn about packages that are too tall (`maxPackageHeightCm()`) |
| REST API + database | each camera's position in one shared coordinate system, ready to be stored with every measurement |

The measurement code in `frontend/src/measurement/` (see its `README.md`)
currently uses one loose 10 cm marker. Once this station is built, the four
floor markers replace it.
