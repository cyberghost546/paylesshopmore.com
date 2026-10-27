# Package measurement station: camera frame and mounts

Stage 2 of the measurement station. Stage 1, the platform and its floor
markers, is in [measurement-station.md](measurement-station.md). This document
covers the frame that holds the cameras, how each camera is mounted, adjusted
and locked, and how the frame grows for taller packages.

Every number here also comes from
[`frontend/src/measurement/stationConfig.js`](../frontend/src/measurement/stationConfig.js),
and its tests check that the numbers add up. If you change the real frame,
change that file and this document in the same commit.

## What changed from stage 1

| Stage 1 | Stage 2 | Why |
| --- | --- | --- |
| Two separate masts: one at the back for the top camera, one at the right end for the side camera | **One frame behind the platform** carries every camera | The side camera must see the full 220 cm length of the platform. From the right end it only saw the 120 cm end of the package. |
| Backdrop wall at the left end, with markers | **Removable calibration post** that stands in two fixed sockets | The side cameras now look forward, so a left-end wall is no longer in their view. |
| Designed for 270 cm | **Designed for 300 cm**, extendable | New requirement |

The platform, the measurement area, the coordinates and floor markers 0–3
are unchanged.

## Coordinates (as in stage 1)

Distances are in cm. **(0, 0, 0)** is the front-left corner of the
measurement area. **x** runs right along the 200 cm side, **y** runs away
from the worker, and **z** runs up from the platform surface. The platform
surface is 15 cm above the floor.

## Key numbers

| | Value |
| --- | --- |
| Platform / measurement area | 220 × 120 cm / 200 × 100 cm |
| Design measurement height (tallest package) | **300 cm** |
| Tallest package with the frame as first built | **359 cm** |
| Frame as first built | 2 posts × 5 segments of 100 cm = **500 cm above the floor** |
| Highest camera position (initial frame) | **z = 465 cm** (480 cm above the floor) |
| Top camera, normal working height | **z = 406 cm**, centred over the area at (100, 50) |
| Side cameras, normal working heights | **z = 83 cm** and **z = 229 cm**, at x = 100, lens at y = 250 |
| Side camera distance to the area's back edge | 150 cm |
| Frame posts | centres at x = -15 and x = 215, y = 265 |
| Floor space, including base plates and rear braces | about 280 × 450 cm (x = -40 to 240, y = -10 to 440) |

The frame is 500 cm tall even though packages only go to 300 cm. The top
camera must hang about 105 cm *above* a package to see a whole 200 × 100 cm
top. Measurement height and frame height are different numbers.

## 1. Front view

What the worker sees, looking at the station. The frame is **behind** the
platform, and the cameras look towards the worker.

```
   z (above platform)
   465 ┬  ┌─┐ cap                                                    ┌─┐ cap
       │  │▓│                                                        │▓│
   406 ┤  │▓│════════════ boom carriage (2 bars) ══════╤════════════════│▓│
       │  │▓│                                   📷 TOP  (boom comes    │▓│
       │  │▓│                                          toward you)   │▓│
   376 ┤  │▓│- - - - - - - - - - bar 3 (spare, side-3) - - - - - - - - │▓│
       │  │▓│                                                        │▓│
   300 ┤  │▓│ ─ ─ ─ ─ ─ design measurement height ─ ─ ─ ─ ─ ─ ─ ─ ─ │▓│
       │  │▓│                                                        │▓│
   229 ┤  │▓│════════════════ camera bar 2 ═══ 📷 side-2 ═════════════│▓│
       │  │▓│                                                        │▓│
       │  │▓│ ← 100 cm segment joint (bolted flange)                 │▓│
   83  ┤  │▓│════════════════ camera bar 1 ═══ 📷 side-1 ═════════════│▓│
       │  │▓│  ┌────────────────────────────────────────────────┐   │▓│
     0 ┤  │▓│  │ ●0        PLATFORM 220 cm (in front)        ●1 │   │▓│
  -15  ┴ ═╧═╧══╧════════════════════════════════════════════════╧═══╧═╧═ floor
         x=-15                       x=100                         x=215
         post                     camera line                      post
```

## 2. Side view

Seen from the right end. The worker and the loading side are on the left.

```
                                                         y=265
   z                                                      post
  465 ┬                                                   ┌┐
  406 ┤          📷 TOP ════════ boom (215 cm) ═══════════╡│╲
      │          ↓   (y=50)                     ╲ knee    ││ ╲
      │                                           ╲ brace ││  ╲
  306 ┤                                             ╲═════╡│   ╲  rear brace
      │                                                   ││    ╲ (to floor,
      │                                                   ││     ╲  y=415)
  229 ┤                                      side-2 📷 ◄──╡│      ╲
      │      ┌──────────────┐                             ││       ╲
      │      │              │                             ││        ╲
      │      │   PACKAGE    │                             ││         ╲
   83 ┤      │              │                side-1 📷 ◄──╡│          ╲
      │      │              │                             ││           ╲
    0 ┤ ramp╱┴──────────────┴───────╮                     ││            ╲
  -15 ┴ ═══════════════════════════════════════════════════╧╧═════════════╧═
  🧍   y=-10       PLATFORM          y=110   keep-out     y=250 lens
 worker                                       zone
       ◄──────── 150 cm standoff from y=100 to the side camera lenses ───►
```

## 3. Top view

```
                     rear brace feet (floor anchors), y = 415
           ✕ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ✕
           ╎                                           ╎
           ╎   compute cabinet on the back of the frame ╎
   post ■━━━━━━━━━━━━━━━━ camera bars ━━━━━━━━━━━━━━━━━━━━■ post   y = 265
  x=-15              📷 side cams (lens y = 250, look → -y)       x=215
                         ┃
          ░░░░░░░░░░░░░░░┃░░ keep-out zone (hatched floor) ░░░░
                         ┃ boom, knee brace ends at y = 165
       ┌─────────────────┃─────────────────────┐ y = 110  platform edge
       │ ●3              ┃ ◎ back socket   ●2 │
       │   ┌─────────────┃─────────────────┐   │ y = 100
       │   │             📷 TOP (100, 50)  │   │
       │   │   MEASUREMENT AREA 200 × 100  │   │
       │   └───────────────────────────────┘   │ y = 0
       │ ●0         ◎ front socket        ●1 │
       └─────────────────────────────────────┘ y = -10
        x=-10                              x=210
           ▲▲▲ ramp: LOADING SIDE, kept completely clear ▲▲▲
                     worker / forklift / pallet jack

   ● floor marker (fixed)   ◎ calibration post socket (fixed)   ✕ floor anchor
```

## 4. The frame

| Part | Prototype spec |
| --- | --- |
| Posts | 100 × 100 × 4 mm steel square tube, in **100 cm segments**. Each segment has a 12 mm end flange, joined with 4 × M12 grade 8.8 bolts and 2 dowel pins, so the segments line up perfectly. |
| Base | The bottom segment is welded to a 50 × 50 × 1.5 cm base plate with 4 × M16 floor anchors. |
| Rails | 45 × 90 mm aluminium T-slot extrusion on the front face of each post, in matching 100 cm lengths. Index holes every 5 cm, plus a centimetre scale. |
| Cross-ties | A fixed horizontal tie between the two posts at every segment joint, on the **back** face, so the camera bars can slide past on the front. |
| Rear braces | 60 × 60 × 3 mm tube from each post at z ≈ 300 down to an anchored floor plate 150 cm behind. They stop a 5 m frame from swaying forwards and backwards. |
| Cap | A bolted cap on top of each post, which also anchors the winch pulley. |

**The frame is bolted to the floor and does not touch the platform.** A heavy
package dropped on the platform shakes the platform, but not the cameras.

## 5. Camera mounts: adjust, then lock

Every camera mount works the same way. Each one has four adjustments, and
each adjustment has its own lock:

```
   post rail ║                              ║ post rail
             ╠═[clamp]══ camera bar ══[clamp]═╣   ← HEIGHT: bar slides up/down
             ║          │◄──► sideways slide │   ← POSITION along x: ±20 cm
             ║          │                    ║
             ║       ┌──┴──┐ forward slide   ║   ← DISTANCE: 30 cm travel
             ║       │ 3-way│ geared head     ║   ← ANGLE + ORIENTATION:
             ║       │ head │                 ║     pan, tilt, roll
             ║       └──┬──┘                 ║
             ║        [📷] in steel guard     ║
```

| Adjustment | How | Locked by |
| --- | --- | --- |
| Height | the bar slides on both rails | 2 × M10 clamp screws per end **and** a steel index pin through the rail's 5 cm holes |
| Sideways (x) | slide plate on the bar | 2 × M8 lock screws |
| Distance (y) | 30 cm linear slide | 2 × M8 lock screws |
| Angle and orientation | geared 3-way head (pan, tilt, roll), adjustable to 0.1° | each axis has its own lock knob |

**After calibration:**

1. Tighten every lock to the torque written on the mount.
2. Paint a witness stripe across every lock screw and every slide joint. A
   broken stripe means something moved.
3. Write the rail mark, slide positions and head angles in the station log.

The **boom carriage** is heavy, so it doesn't slide by hand. A self-locking
worm-gear hand winch on the left post raises and lowers it, and index pins
take the load once it is in position. A self-locking winch can't run back on
its own.

## 6. Top camera (length and width)

- Hangs at the tip of the **boom**: 100 × 50 × 3 mm steel tube, reaching
  215 cm forward from the posts to above the centre of the area (100, 50).
- The boom is bolted to a **carriage of two bars, 100 cm apart**. A 45°
  knee brace runs from the lower bar to the boom and lands at y = 165, behind
  the platform. The brace makes the cantilever a rigid triangle, so the camera
  can't bounce.
- At the working height of **z = 406** it sees the whole platform plus 10 cm
  all round, and still clears a 300 cm package by more than 100 cm.

| Tallest package | Required top camera height |
| --- | --- |
| 5–20 cm | 127 cm (the lowest allowed, set by the floor markers) |
| 100 cm | 206 cm |
| 250 cm | 356 cm |
| **300 cm (design)** | **406 cm** |
| 350 cm | 456 cm |

The camera stays clamped at 406 cm for **every** package. Moving it would mean
recalibrating, and a camera lowered for small parcels is a camera a tall
package can hit.

**Precision trade-off.** From 406 cm, one pixel of a 1280-pixel depth camera
covers about **0.6 cm** on the floor. That is fine for large packages but
borderline for a 10 × 10 cm parcel. The boom tip has a second slot,
`top-hires`, for a 4K colour camera (about **0.2 cm per pixel**). Fit it
before small-parcel accuracy matters.

## 7. Side cameras (height)

- On their own camera bars, at x = 100, lens at y = 250, looking forward
  (towards −y), level.
- At 150 cm from the area's back edge, one camera sees a band **166 cm** tall
  and **285 cm** wide. That covers the platform's 220 cm plus 10 cm margins
  (240 cm needed) with room to spare.
- Cameras are stacked with 20 cm overlap until the bands reach 10 cm above
  the package:

| Package height | Side cameras | Lens heights (z) |
| --- | --- | --- |
| up to 156 cm | side-1 | 83 |
| up to 302 cm (**design: 300**) | side-1, side-2 | 83, 229 |
| up to 448 cm | + side-3 (spare bar) | 83, 229, 376 |

The bottom camera also sees floor markers 0 and 1 (and the front socket).
That links it to the same coordinates as the top camera. Beyond the
platform's front edge it sees the warehouse, including the worker. The depth
camera ignores anything further away than the front edge of the platform.

## 8. Calibration marker locations

| Marker | Where | Fixed? | Seen by |
| --- | --- | --- | --- |
| Floor 0–3 (8 cm, `DICT_4X4_50`) | corners of the margin, (−5, −5), (205, −5), (205, 105), (−5, 105) | **permanent**, recessed under polycarbonate | top camera (all 4); side-1 (0 and 1) |
| Calibration post sockets | front (100, −5) and back (100, 105): 30 mm steel sleeves set flush in the margin, with a cap | **permanent** | — |
| Calibration post markers (10 cm, ids 10–15) | on a 310 cm post, z = 50, 100, … 300 | post removable, but always in a fixed socket | side cameras |

How the post is used:

1. Stand the post in the **front socket**. The side cameras see known
   heights at the far distance.
2. Move it to the **back socket**. Now they see the same heights at the near
   distance.
3. Remove the post. The platform must be empty during measuring.

From these two positions the software learns how size changes with distance,
which is what lets it measure the height of a package that isn't standing
exactly at a socket. The post plugs together from pieces. When the frame is
extended, add a piece so the markers reach the new height.

**Drift check (for the future software).** In normal use, the top camera
sees all four floor markers and side-1 sees markers 0 and 1 in every picture.
If any marker moves more than about 2 pixels from where it was at
calibration, the camera has moved. The app should then stop and ask for
recalibration instead of measuring wrong.

## 9. Cable routing

```
   camera ──(30 cm service loop, strain relief)──► bar cable channel
        ──► short drag chain ──► grommet in post side (every 50 cm)
        ──► INSIDE the hollow post ──► out at the base, at the BACK
        ──► floor cable protector, running backwards ──► compute cabinet
```

- **No cable crosses the front or ends of the platform.** Everything leaves
  the frame at the back, into the keep-out zone.
- Inside the posts: power and data travel in separate split conduits.
- On the bars: a lidded cable channel. Inside the boom tube for the top
  camera.
- The **drag chain** at each bar lets it move ±50 cm without unplugging.
  For bigger moves, re-route through a different grommet.
- Depth cameras use USB 3. Over about 5 m use **active optical USB cables**,
  or PoE GigE cameras with a single cable each. Label both ends with the
  slot id, for example `side-2`.
- The compute cabinet (PC, small UPS, power strip) is lockable and is bolted
  to the back of the frame at 100–180 cm, inside the keep-out zone.

## 10. Stability

| Threat | Countermeasure |
| --- | --- |
| Vibration from loading | frame bolted to the floor, separate from the platform |
| Frame swaying | rear braces, cross-ties every 100 cm, flanged and dowelled joints |
| Boom bouncing | two-bar carriage and knee brace (triangle) |
| Camera sliding down | clamp screws **plus** index pin (two independent locks) |
| Angle creep | geared head with a lock on every axis, plus witness paint |
| Someone bumping a camera | steel guard around each camera, and cameras are outside the worker's reach (see below) |
| Undetected movement | drift check on the floor markers (section 8) |

## 11. Safety

- **The loading side stays clear.** Nothing stands in front of the platform
  or at its ends. The frame and braces are behind it.
- **Keep-out zone:** paint the floor behind the platform (y = 110 to 415)
  with yellow/black hatching. It is for maintenance only, not a walkway.
- **Nothing to trip on:** no cables cross a walkway. Base plates have
  chamfered edges and domed caps over the anchor bolts, and they sit inside
  the keep-out zone.
- **No sharp edges:** tube ends are capped. Every bar and boom end gets a
  rubber end cap. Exposed rail ends get plastic covers.
- **Impact protection:** each camera sits in an open-front steel guard with
  the lens set 3 cm back. Paint the posts yellow/black up to 200 cm. If
  forklifts drive past the back, put a steel bollard at each post base.
- **Overhead:** the top camera and boom are at 406 cm, far above anyone's
  head. Each camera has a steel safety lanyard to its bar, so it can't fall
  even if every screw fails.
- **Work at height:** adjust bar 2 and above, and the boom, only from a
  mobile elevating work platform or scissor lift. Never from the platform,
  never from a ladder leaning on the frame.
- **Ceiling:** the frame is 500 cm tall. Keep the clearance below sprinkler
  heads that the local fire code requires (often 45 cm). Keep clear of
  lights and overhead doors.
- **Rated load:** put a plate on the frame with the maximum camera load per
  bar (for example 10 kg) and the boom tip (5 kg).

## 12. Making it taller

The posts are built to grow. Adding height does **not** mean replacing
anything:

| Frame segments | Frame height | Highest camera (z) | Tallest package | Side cameras for that height |
| --- | --- | --- | --- | --- |
| **5 (as built)** | 500 cm | 465 cm | **359 cm** (covers 300 and 350) | up to 3 |
| 6 | 600 cm | 565 cm | 459 cm (covers 400) | up to 4 |
| each extra | +100 cm | +100 cm | +100 cm | |

`frameSegmentsNeeded(height)` in the code answers "do we need to extend for
this package?".

**To add a segment:**

1. Check the ceiling and sprinklers (section 11).
2. Take off the caps. Bolt a new segment onto each post: flange, dowels,
   4 × M12. Bolt on the matching rail section and a new cross-tie.
3. Put the caps back on top and move the winch pulley up.
4. Above 6 segments, add a second rear brace on each post, higher up.
5. Add a piece to the calibration post. Fit `side-3` on the spare bar if the
   new height needs it.
6. Raise the boom to the new `requiredTopCameraHeight()`. Update
   `DEFAULT_FRAME_SEGMENTS` and `DESIGN_MEASUREMENT_HEIGHT_CM` in the code.
7. **Recalibrate every camera.**

## 13. Room for more cameras

The prototype needs only **3 cameras**: `top`, `side-1` and `side-2`. Every
other slot is planned now, so a camera can be added later without rebuilding:

| Slot | For | Mount | In the prototype |
| --- | --- | --- | --- |
| `top` | length + width (depth) | boom tip, pointing down | ✅ |
| `top-hires` | sharper length + width | boom tip, beside `top` | planned |
| `side-1`, `side-2` | height | camera bars 1 and 2 | ✅ |
| `side-3` | height over ~302 cm | spare camera bar 3 | planned |
| `front` | front face, angled 45° down | boom tip, facing the loading side | planned |
| `end-left`, `end-right` | end faces | short end masts on floor sockets beside the platform (fit flush caps until used) | planned |

Each camera bar already has its cable channel and grommet, and the boom has
room for 3 cameras. The compute cabinet is sized for 8 camera connections.

## 14. Prototype parts list (rough)

| Qty | Part |
| --- | --- |
| 10 | post segments, 100 × 100 × 4 mm steel, 100 cm, flanged (2 of them on base plates) |
| 10 | T-slot rail sections, 45 × 90 mm, 100 cm, with index holes |
| 5 | cross-ties |
| 2 | rear braces with floor plates |
| 5 | camera bars with clamp blocks and index pins (3 side + 2 for the boom carriage) |
| 1 | boom, 100 × 50 × 3 mm × 230 cm, with knee brace |
| 1 | self-locking hand winch with pulley |
| 3 (+5 later) | camera heads: sideways slide, forward slide, geared 3-way head, steel guard, lanyard |
| 3 | depth cameras (for example Intel RealSense D455) |
| 1 | calibration post, 310 cm in plug-together pieces, markers 10–15 |
| 2 | calibration post sockets (30 mm sleeves with caps) |
| — | anchors, conduit, drag chains, cable channels, floor cable protector, compute cabinet, hazard paint, end caps |
