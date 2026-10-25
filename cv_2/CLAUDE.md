# cv_2/: yellow / blue / red blob path tracker

Context for anyone (human or agent) continuing work here. User-facing setup is in [README.md](README.md); diagrams and a
user guide are in [../docs/yellow-tracker.html](../docs/yellow-tracker.html). It replaces the earlier `cv/` pose/zone
service (RTMPose over ONNX Runtime, port 8001, `/ws/cv`), which was **deleted from the working tree and never committed**,
so it is not recoverable from git. This project is self-contained: its own venv, its own copy of `Camera`.

## What this is

A standalone webcam program. It finds a **yellow, a blue and a red object (a ball/blob on a stick each)**, draws the
**path each one moves along**, in its own colour, over the live view, and **toggles detection on/off every 5 s; each time
it turns off every drawn path is erased**. Each ON phase asks for the next preset shape (circle, triangle, square, star, then
round again) and the program **names the shape it sees each colour drawing**. Separately, a **green strip on the front of a phone** (held in the left hand) is
tracked on every frame, whatever the gate says, and a fast downward swing of it makes the demo show **SLASHED!** for
`slash_hold_s`=2 s (`tracker/slash.py`). **Status: working on the dev setup with bright lime tape when the swing stays inside the picture: 7/7 deliberate slashes fired in one
recording, 3/5 live (4/5 replayed with the final thresholds) when raising to face height, and 0 false triggers in 30 s of ordinary movement (see Decisions: SlashDetector, and Gotchas for the framing requirement).** There is no server, WebSocket or frontend integration yet: the only consumer
is `tools/demo.py` (OpenCV window).

## Commands (run from `cv_2/`; Windows venv python is `.venv\Scripts\python.exe`)

```
python -m tools.demo                           # window; q quits, m shows the colour masks beside the view
python -m tools.demo --period 3                # different on/off period
python -m tools.demo --no-window --frames 90   # headless smoke test, prints fps + per-colour result
python -m tools.tune                           # click-to-calibrate: sample your objects, get YT_* lines (p)
python -m pytest                               # 211 tests (~30 s), no camera needed
```

Env knobs (`tracker/config.py`): `YT_CAMERA, YT_WIDTH, YT_HEIGHT, YT_COLORS` (subset, e.g. `blue,red`),
`YT_<COLOR>_HUE` (`20-25`, or `174-179,0-6` for a wrapping band), `YT_<COLOR>_S_MIN`, `YT_<COLOR>_V_MIN`, `YT_<COLOR>_MIN_CIRC`, `YT_<COLOR>_MIN_AREA`, `YT_MIN_AREA`,
`YT_PERIOD, YT_MIRROR`, `YT_PHONE` (0 turns the slash feature off), `YT_PHONE_HUE/S_MIN/V_MIN/MIN_AREA`, `YT_JUMP` (0 turns jump detection off). Everything else is a `Config` dataclass field. (The old single-colour `YT_H_MIN/H_MAX/S_MIN/V_MIN`
no longer exist; use `YT_YELLOW_*`.)

## Code map

```
tracker/
  config.py    Config dataclass + ColorSpec + default_colors() (yellow, blue, red) + from_env(). All tunables live here.
  capture.py   Camera: thread that keeps only the newest frame. Carried over from the old cv/ service.
  detector.py  to_hsv(frame) (blur + convert, once per frame) and ColorDetector(spec): inRange over the spec's hue
               ranges (OR-ed; red has two) -> open/close -> contour -> Detection(x,y,radius,area). Strict mask to
               acquire (largest blob), relaxed mask to follow (blob nearest the previous position); see Decisions.
               mask() is the strict mask, public so the demo can show it.
  calibrate.py suggest(samples) -> hue ranges/s_min/v_min covering HSV samples (hue is circular: red wraps);
               env_lines() formats them as PowerShell. Pure, used by tools/tune.py.
  track.py     ColorTrack: one colour's detect -> confirm (acquire_frames) -> smooth state (hint, candidate, smoothed point). Used by every
               wand colour and by the phone, so they follow identical rules.
  slash.py     SlashDetector.update(now, point|None, aspect, suppress) -> SlashState(active, seconds_left, count). Pure, time injected.
  motion.py    BodyMotion.update(frame, now) -> MotionSample(vy, vx, area)|None: Farneback optical flow on a 160x120 grey frame
               (~6 ms), global brightness removed; vy/vx in picture heights per second (vy < 0 is up), area = moving fraction.
  jump.py      JumpDetector.update(now, MotionSample|None) -> JumpState(active, seconds_left, count). Pure, time injected.
  shapes.py    ShapeRecognizer.classify(points, aspect) -> ShapeResult(shape|None, score) | None; outline(shape) for the
               guide icon. Pure numpy, ~0.3 ms. See Decisions (Shape recognition).
  trace.py     DetectionGate (on/off square wave, time passed in), Trace (polyline segments, gap break, point cap).
  pipeline.py  Pipeline.process(frame, now) -> payload dict. The only place stages are wired together. Also owns the shape cycle
               (`_round`, advanced on each off->on edge) and runs the recogniser on each colour's longest stroke every active frame.
  overlay.py   draw(frame, payload, period_s, colors): per-colour fading trail + marker + name, ON/OFF banner, countdown
               bar, red border when off, shape panel ("Draw: X" + guide icon + per-colour detected shape; while off
               "Next: Y" + last round's result). mask_view(): each detector's mask painted in its colour.
tools/demo.py  Window + --no-window smoke test + mask view.
tools/tune.py  Click-to-calibrate window: sample HSV of the object at several places, print suggested YT_* lines.
tests/         Synthetic frames (grey room, coloured balls on sticks, skin/green/orange distractors); injectable clock.
```

Data flow: `Camera -> Pipeline.process -> gate.state(now) -> [on: to_hsv once -> for each colour: detect -> EMA smooth ->
trace.add -> recognise shape] / [off: nothing] -> payload -> overlay.draw`.

Payload: `{active, secondsLeft, mirrored, objects: {name: {x, y, radius} | null}, traces: {name: [[[x, y], ...], ...]}}`
with `name` in the configured colours (`yellow`, `blue`, `red` by default). Shape fields: `target` (shape to draw this round),
`next` (shape for the next ON phase), `complete: {name: bool}` (that colour's drawing matched `target`; latched, see below), `shapes: {name: {shape: str|null, score} | null}` (live; `null` = no closed stroke yet,
`shape: null` = closed but matches no preset, `score` = distance to the nearest preset, lower is closer) and `previous:
{target, shapes} | null` (the finished round, kept while OFF because the live `shapes` are cleared with the traces). All coordinates are normalised 0-1 (radius is a
fraction of frame **width**), x already mirrored when `mirrored`, plain Python floats. Slash fields: `phone: {x, y, radius} | null` (the marker, mirrored x like `objects`, never in `objects`/`traces`/`shapes`) and
`slash: {active, secondsLeft, count}`, `jump: {active, secondsLeft, count}` and `motion: {vy, vx, area}|null` (the raw sensor values
behind `jump`, for tuning). (Before blue/red were added this was
a single `object` / `trace`; nothing consumed it, so it was changed without a compatibility shim.)

## Decisions and why (don't undo without reading)

- **Colour thresholding, not a neural model.** The target is defined by colour alone, so HSV `inRange` is ~1 ms/frame,
  needs no download and avoids the ARM64 PyTorch/MediaPipe wheel problems the old cv/ service ran into (it used ONNX Runtime for that reason). The cost is that it is
  only as good as the colour contrast: anything else in the band is a candidate (see Gotchas). If a *shape* is ever needed
  (stick vs. ball, several objects), add contour filtering (circularity/solidity) before reaching for a model.
- **Largest blob wins, one object per colour.** Simplest rule that matches "a yellow/blue/red object"; it is also why
  other things of the same colour in view steal that colour's trace. Colours are independent: no association between
  them, no exclusivity (hue bands are disjoint, so a pixel can only ever belong to one colour).
- **One gate for all colours**, not one per colour: they switch together, and `Pipeline` clears every trace on the single
  on->off edge. A per-colour schedule would mean one `DetectionGate` per detector; the payload already carries per-colour
  data, so only `Pipeline` and the overlay banner would change.
- **Hysteresis: acquire strict, follow strict-first with a relaxed fallback** (`ColorDetector.detect(hsv, hint)`). A new object is found
  with the strict `ColorSpec` thresholds (largest blob that is big and round enough). Once found, each frame prefers the object's
  **own strict blob** near its last position (`_near(..., strict=True)`, no shape test, so a half-covered ball is kept); only if that
  is gone does it fall back to a **relaxed mask** (hue widened by `track_hue_margin`=4, saturation/brightness floors x `track_relax`=0.5),
  again only the blob next to the last position. Why the relaxed fallback exists: lighting across the frame is uneven (dev webcam: mean
  brightness 164 on one side to 73 on the other), so a ball fades/washes out toward one edge. Why *strict first*: see the next item.
  Off: `track_relax=1.0`, `track_hue_margin=0`.
- **The relaxed mask must never be the primary measurement** (the "targets my lips" bug, found by measurement, not guessing). With
  relaxed-first following, a red ball held in a hand or near the face merged with skin in the relaxed mask (skin passes S>=58): live
  A/B on the dev camera, ball in view, mouth relaxed: reported marker contained the lips in **89%** of frames, its centre was a median
  **192 px** (max 397) off the ball's own blob, radius **121 px** vs the ball's ~50, and red was reported in 96 frames where the ball
  was not even in view. After the fix (same procedure): lips in **2%** of frames (3 frames, all the ball genuinely passing the mouth,
  offset 0 px), centre offset **0 px**, radius ~50, ball missed in 5% of frames (3 runs of 2-3 frames at the frame edge: the
  3-frame confirmation after re-entry). Lips alone, ball out of view, talking and smiling: red reported in **0%** of 280 frames.
- **Following limits are anchored to a fixed reference area, not the previous frame** (`Detection.ref_area` = area of the last *strict*
  sighting; relaxed detections carry it forward). Allowed area is `track_min_shrink`=0.3x .. `track_max_growth`=2x `ref_area`. The old
  per-frame reference allowed creep: each accepted blob became the next reference, so ball -> ball+hand -> ball+hand+face could grow by up
  to 2x a frame, and the lock then refreshed itself on the face. The bounds also reject a lip-sized blob (~7% of the ball) beside the
  ball (below 0.3x) and a face (20x). Cost: a ball that is faded *and* growing past 2x its last strict size is dropped until a strict
  sighting re-anchors it (a ball growing with normal colour is followed, since every strict sighting re-anchors).
- **Relaxed-only following has a time limit.** `Pipeline._last` holds (detection, last sighting, last *strict* sighting). The hint is valid
  while seen within `hold_s`=0.5 s **and** strictly confirmed within `track_relaxed_s`=1.5 s, so a skin patch the size of the ball cannot be
  followed for ever once the ball is gone.
- **HSV conversion happens once per frame** (`to_hsv`) and is shared by all detectors, so adding a colour costs only
  an `inRange` + morphology + contour pass (~1 ms), not another colour conversion.
- **Red is a list of hue ranges**, because hue wraps around 0 (`(0, 6)` and `(174, 179)`). `ColorSpec.hue` is a tuple of
  `(lo, hi)` pairs for every colour; `ColorDetector.mask` ORs the `inRange` results.
- **The gate is a pure function of the clock** (`DetectionGate.state(now)` = `(active, secondsLeft)`), phase measured from
  its first call, starting ON. `Pipeline.process` takes `now` (defaults to `time.monotonic()`), which is what makes the
  on/off behaviour testable without sleeping. Keep time injectable.
- **The trace is cleared on the on->off edge, and the detector is not run while off** (`Pipeline._was_active`). Not run
  = no CPU spent and no chance of a stale detection leaking into the off phase. The smoother is also reset when off or
  when the object is lost, so the first point of a new stroke is not dragged from the old position.
- **Segments, not one polyline.** `Trace` starts a new segment when the object was unseen for `gap_s` (0.25 s), so a
  lost track is not drawn as a straight line to wherever it reappears. A single missed frame does not break the line.
- **Output is mirrored by default**, the convention the old cv/ service used: x is flipped in the payload (`Pipeline._nx`) and the
  overlay flips the frame to match, so the trail lines up with a selfie view. Detection always runs on the raw frame.
- **Trace is stored normalised**, not in pixels, so it is independent of capture size and can be sent as-is later.
- **`Camera` lives here** (carried over from the deleted cv/ service), so this project has no dependency outside itself.
- **Own venv on the x86_64 Python** (see first gotcha).
- **Jump = whole-picture motion going up then down, not a face, not a marker** (`tracker/motion.py`, `tracker/jump.py`). Chosen by the user
  from three options. A face detector was ruled out partly by the environment: OpenCV 5.0 in this venv has no `CascadeClassifier` and no
  cascade files (only the `FaceDetectorYN` API, which needs a downloaded ONNX model). Farneback flow on 160x120 costs ~6 ms and idle
  noise is a median 0.37 px/frame (p95 0.55). `JumpDetector` finds an UP run (vy <= -`jump_up_speed` for >= `jump_min_frames`, rising
  >= `jump_min_height`) followed within `jump_max_gap_s` by a DOWN run, all within `jump_max_air_s`, mostly vertical, and with
  `min_ratio <= down/up displacement <= max_ratio` (a one-way move - standing up, sitting, bending - does not come back). It fires
  once the down run has ENDED (two frames without it), i.e. at the landing: only a finished fall can be compared with the rise, and
  firing earlier made `max_ratio` useless (a test caught that). Runs and 'ended' are counted in frames, not seconds (a time window
  made the end-of-run wait never complete in a short test series). **Measured on the dev camera (standing, ~1.5-2 m):** 5 real jumps
  moved 0.41-0.52 of the picture at a median |vy| of 0.79-1.21 picture-heights/s, rising 0.23-0.32 (peak 1.9), usually with a crouch
  first (a DOWN run before the UP run, ignored by the pairing). Ordinary movement (leaning, waving, bending, stepping) produced
  lookalike up-then-down pairs with area 0.12-0.20 and |vy| 0.39-0.52, and the first-guess thresholds (area 0.04, speed 0.4) fired
  twice on them in 30 s. Any `jump_min_area` from 0.20 to 0.40 gave 5/5 jumps and 0 false triggers at speeds 0.4-0.8; defaults are
  area 0.30 and speed 0.6, mid-gap on both sides. Same method as the slash: log the raw sensor values, replay offline.
- **A jump looked like a slash, so slashes are suppressed during whole-body motion.** Live: the landing dropped the phone from y 0.26
  to 0.89 in ~0.2 s and the slash detector fired mid-jump. `Pipeline` now passes `suppress=True` to `SlashDetector.update` while the
  motion area is >= `slash_suppress_area`=0.35 (a jump measured 0.41-0.52) and for `slash_suppress_hold_s`=0.3 s after; suppressed
  frames also clear the slash buffer so they cannot contribute to a later swing. **Not validated against real slashes**: the ordinary-
  movement recording had the phone tracked in only 11 % of frames, so the body-motion area during a real slash is unmeasured. If real
  slashes stop firing, log `motion.area` during one (`payload["motion"]`) and raise `slash_suppress_area`.
- **The phone is a separate, always-on track, not a fourth wand colour.** `Config.phone` is a `ColorSpec` outside `Config.colors`, so
  the wand loops, traces, shapes, `objects` and `previous` never see it, and the gate does not pause it (`Pipeline.process` converts
  to HSV when active *or* a phone is configured, and steps `phone_track` every frame). The per-colour tracking state was extracted
  from `Pipeline` into `ColorTrack` so both use the same strict-first / confirmation / smoothing rules; the 130 existing tests were
  the safety net for that refactor. No roundness test for the phone (a strip is not round). Default band is calibrated on the dev
  marker (bright lime tape): hue 31-43 (measured ~37), S>=70, V>=80, own min area 0.002.
- **`SlashDetector` judges the WHOLE stroke, not the last half second** (`tracker/slash.py`, all `Config.slash_*`). Over the last
  `slash_window_s`=1.5 s the highest point is the start and the newest point the end; it fires when the swing dropped
  >= `slash_min_drop`=0.30 frame heights, **peaked** at >= `slash_min_peak_speed`=4.5 frame-heights/s between two consecutive
  sightings, averaged >= `slash_min_speed`=0.3, stayed mostly vertical (sideways travel, x scaled by aspect, <=
  `slash_max_sideways`=0.6 x the drop) and mostly downward (>= `slash_down_frac`=0.8 of steps). `slash_min_points`=2 sightings
  suffice (a fast swing can leave only its two ends visible). A tracking gap > `slash_gap_s`=0.25 s forgets the motion (like
  `Trace`). After firing it holds `slash_hold_s`=2 s, ignores further slashes, then re-arms with a cleared buffer. It reads the
  **raw** centre, not the smoothed one (smoothing lags a frame or two).
  **Why this and not a 0.5 s window with an average speed (the first design):** measured on the dev camera with the lime tape,
  7 deliberate slashes each ran ~1.3 s from high (y 0.09-0.26) to low (y ~0.95): total drop **0.69-0.89**, peak **5.9-9.1**
  frame-heights/s, mean only 0.5-0.7. 22 downward runs of ordinary movement (typing, looking at the phone, waving it, lowering
  it) started mid-frame (y 0.48-0.62) and dropped **0.18-0.34** with a peak of **0.8-2.3**. A 0.5 s window sees only the middle
  of a slash, which looks exactly like a quick lowering, so the first version fired on 2 of those in 30 s (and raising the
  speed floor could not separate them: at 2.0 it lost 4 of 7 real slashes). Peak speed and total drop separate the two with a
  wide margin on both sides (4.5 sits between 2.3 and 5.9). The drop floor is deliberately low: lowering it from 0.40 to 0.30 caught a
  swing seen only in part (y 0.33 -> 0.64 in 2 frames, the marker lost in blur either side) and added no false trigger on the normal
  recording, because the peak speed is the real guard; values from 0.20 to 0.40 gave identical results on the recordings. Replayed:
  go2 7/7, opt1 4/5, final 1/5, normal 0 false, go1 1/1 (the misses are swings with no sighting at one end). `tests/test_slash.py` keeps a regression for the quick-lowering case and uses a slash-shaped
  (slow start, burst) profile; a plain linear ramp is NOT fast enough at its peak and deliberately does not fire.
- **Fourier descriptors, not corner counting.** The stroke is resampled to 64 points evenly by arc length, closed, and read as
  complex numbers; the magnitudes of harmonics -8..8 relative to the biggest one (read in its winding direction) are compared by
  Euclidean distance with the presets' descriptors. This is invariant to position, size, rotation, start point and drawing direction
  for free (circle = only c_1; triangle adds c_-2/c_4; square c_-3/c_5; a one-stroke pentagram winds twice so its biggest is c_2).
  Why not `approxPolyDP` vertex counting: the tracker's smoothing and hand speed round a drawn square's corners until it is ~10 %
  off a circle in radius, and a tolerance tight enough to see 4 corners also splits a circle into 6-7. The harmonic count barely
  matters (5-12 give the same accuracy; 8 kept).
- **A star has three templates**: the one-stroke pentagram and the outline with notch depth 0.382 and 0.5 (people draw both and vary
  the depth). All map to "star".
- **Not named until closed**: gap between first and last point <= `shape_closure` (0.15) of the path length, bounding box >=
  `shape_min_size` (0.12 frame heights), >= 12 points; until then the result is `None`. Half a circle looks like everything.
  Anything farther than `shape_max_dist` (0.5) from every preset is `shape: None` ("unknown"): out-and-back line 1.0, figure 8 1.5,
  random loop 0.74, ellipse 2:1 0.27 (still "circle"), 3:1 0.42.
- **Aspect matters**: normalised coordinates are 0-1 per axis, so the recogniser multiplies x by width/height first; otherwise a
  circle on a 4:3 frame is a 4:3 ellipse.
- **Longest unbroken stroke only** (`Pipeline._recognise`): a lost track starts a new segment, and joining segments would add a jump.
- **"Complete" is latched per colour for the rest of the round** (`Pipeline._done`). The live label only exists while the stroke is
  closed (gap between first and last point <= `shape_closure` of its length), so it vanished as soon as the ball moved on after closing
  the loop; worse, a circle plus a short tail reads as a *triangle*, so the live label can flip to a wrong shape. Once a colour's result
  equals the target it is stored, `shapes[name]` returns it for the remainder of the ON phase (that colour is no longer re-classified),
  and `complete[name]` is true. Cleared on the on->off edge (after being copied into `previous`). **Only matches latch**: a wrong closed
  shape stays live and disappears when the stroke opens, so the player can still redo it within the round; latching any closed shape
  would freeze a bad attempt. The latch stores a result the recogniser really produced, so it is not a prior.
- **The detected shape does not look at the target.** The target is only the prompt; the overlay marks "OK" when they match. Using the
  target as a prior would make the display agree with the prompt whatever was drawn.
- **Accuracy** was measured on a seeded simulator of human drawing (vertices +-8 %, wobble, corner rounding, +-18 % stretch, any
  rotation/start/direction, overshoot to -6..+10 %): circle/triangle/square ~99-100 %, star ~88-89 % (misses are inner notches
  deep enough that it reads as a square or circle, and a heavily rounded pentagram). **It has not been tried with a real hand and
  camera**; the thresholds are the first thing to tune if it misfires. `tests/test_shapes.py` carries a trimmed copy of the simulator.
- **Cycle**: `Pipeline._round` starts at 0 (circle) and increments on every off->on edge, wrapping over `Config.shapes`.

## Gotchas (each one cost time)

- **Windows on ARM64: the venv must use the x86_64 Python 3.12.** OpenCV has no `win_arm64` wheel; with the native ARM64
  Python `uv pip install` falls back to building `opencv-python` (and a pinned NumPy 2.0.2) from source and dies with
  "Unknown compiler(s)". The error mentions NumPy but the cause is OpenCV. Create it with
  `uv venv --python cpython-3.12-windows-x86_64-none .venv`. Runs fine under emulation (~27 fps, camera-limited).
  `requirements.txt` pins `numpy>=2.2` so `uv` never tries to compile NumPy either.
- **The hue bands are the main thing to tune, and they change between cameras/lighting.** OpenCV hue is 0-179; pure
  yellow is 30, blue 120, red 0/180, but webcam white balance moves them. The defaults were retuned on the dev camera/object
  (yellow 20-25 by hand; blue 103-115 S>=62 V>=88 and red 174-179 + 0-6 S>=117 V>=97 from `tools.tune` samples: 20 blue and
  9 red clicks across the frame, with one background click discarded). Measured on the dev camera: blue S drops to ~77 on the
  screen-right (bright) side vs ~110 elsewhere, and the red ball's hue sits right on the wrap (0, 1 and 179), so a red band
  that starts above 0 misses most of it. Use `tools.tune` (click the object where it is
  brightest, darkest and in the centre, press `p`) or the demo's `m` mask view. The tests do **not**
  hard-code colours: `tests/test_tracker.py::swatch` builds each synthetic ball from the middle of that colour's first
  default hue range, so retuning `Config` defaults does not break them. (An earlier hard-coded hue-30 ball made 8 tests
  fail the moment the yellow band was narrowed; later a retune put red over the old orange decoy and the old red-wrap hues
  fell outside it.) Test decoys are therefore green/cyan/magenta (far from every band) plus a skin tone, and the red
  test walks `Config().colors['red'].hue` instead of fixed hues. Don't retune a band so that two colours overlap.
  The skin test is inherently coupled to red's `s_min` (synthetic skin has S=104): lowering red's `s_min` below that fails it,
  which is the point.
- **Red vs lips/skin is solved by shape, not colour.** Measured on the dev camera with the ball out of view: lips are hue 3,
  S 124-129, V 104-111, area ~210 px, circularity 0.42-0.57, aspect 2.4-3.3. The red ball is hue 0/1/179, S 132-178, V 112-125,
  area in the thousands, round. Colour overlaps (S 129 vs 132, V 111 vs 112: no usable margin), shape does not, so
  `ColorSpec.min_circ` (red: 0.58; others 0 = off) rejects non-round blobs at *acquisition only* (`ColorDetector._largest`:
  the largest blob that passes, not "largest, then check"). Following has no shape test, so a ball partly covered by a hand is kept.
  Measured with the dev ball in view: circularity 0.65-0.76 (median 0.71, p10 0.65), solidity 0.93-0.98; lips (>=614 px) max 0.51, typically
  0.37-0.48, so 0.58 sits mid-gap (it was 0.62, only 0.03 under the ball's p10). Circularity is `4*pi*area/perimeter^2` on the CHAIN_APPROX_SIMPLE contour; the
  tests' synthetic strip is 4:1 because a smooth 3:1 ellipse is rounder (~0.6) than real lips. Limits: a red object that is
  not round (a stick end, a cube seen edge-on) will not be acquired - lower `YT_RED_MIN_CIRC`; a round red thing (a red cheek
  patch, a red nose close to the camera) still would be.
- **Red vs skin was already the weak spot.** Skin sits at hue ~5-15 with moderate saturation, right next to red. Red therefore has
  the highest default `s_min` (130) and a narrow hue band; a synthetic skin tone is rejected, but real skin under
  warm light may not be. Live smoke test on the dev machine: red flickered in and out with no red object in view. If red
  misfires, raise `YT_RED_S_MIN` / narrow `YT_RED_HUE` before anything else.
- **Skin, wood and warm-white walls sit just below yellow in hue** (~8-20) and leak in if `s_min`/`v_min` are low or the
  band reaches down. Raise saturation before widening anything.
- **A stick in any of the three colours would be detected as part of the object** (and shift the centroid). Use a
  neutral stick: grey, black or white (the tests use dark grey). A brown/wooden stick (hue ~10-20, saturated) falls inside
  red's or yellow's bands, and the relaxed following mask makes this worse (an earlier brown test stick turned the
  yellow centroid into the ball+stick midpoint).
- **Don't flip the frame before detection.** Only the output is mirrored. (Harmless for colour, but it keeps one
  convention: payload x is mirrored, raw frames never are.)
- **JSON-ness:** convert NumPy scalars with `float(...)` at the payload boundary (`Pipeline.process` does); a test
  `json.dumps`es the payload.
- **A leftover process can hold the webcam** (e.g. a previous demo that did not exit). Symptom:
  "Could not open camera 0" or a frozen feed. Check `Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*python*' }`.
- `Camera` uses DirectShow on Windows and AVFoundation on macOS (terminal/IDE needs camera permission on first run).

## Testing approach

Everything is testable without hardware. `tests/test_tracker.py` renders frames with OpenCV drawing calls and a fake clock.
Detector tests are parametrised over the three colours (finds the ball not the stick, none when absent, rejects
skin/green/orange, picks its colour among distractors, ignores the *other two* colours, ignores specks) plus red matching on
both sides of the hue wrap. Then: gate (alternation, countdown), trace (gap split, cap, clear), pipeline (each colour gets
its own trace and they don't contaminate each other, colours tracked independently when one disappears, **every trace
erased on every off edge over 3 cycles**, fresh start after turning on, no detector runs while off, lost track breaks the
line, mirroring + JSON, smoothing lag), config (defaults, `YT_COLORS`/hue/saturation env parsing, unknown colour rejected,
subset pipelines), overlay (draws in both states, `mask_view` paints each colour). `tests/test_shapes.py`: recogniser (ideal shapes in any rotation/start/direction/size, every star variant, aspect, seeded hand-drawn accuracy floors, unfinished/tiny/scribble not forced into a preset) and the pipeline (target cycle, end-to-end naming of each shape through synthetic ball frames, result kept after the erase, colours named independently). Live behaviour is checked by hand with
`tools.demo`; **the live trails/toggle have only been smoke-tested headless (fps + detections), not visually reviewed
across lighting conditions or object types, and blue/red thresholds have never been tuned against real objects.**

- **The pale strip cannot be tracked through a real slash (measured, dev webcam).** At rest the strip is hue 54-65, S 55-67, V 72-125.
  In a 15 s recording of ~6 deliberate slashes with a very loose colour test (hue 45-75, S>=18) a strip blob existed in only 13 % of
  frames and the tracker (S>=45) had it in 2 %: during fast motion S falls to 19-37 (motion blur: at 10+ frame-heights/s the strip
  smears over ~150 px against a ~28 px height, so each pixel sees it for a fraction of the exposure). The real down-swings took
  ~3 frames (0.07 s, 0.6 of the frame height); only 2 of ~6 left a sighting at all, up-motions were easy to tell apart by sign.
  Gap-tolerant matching of the top and bottom sightings does not rescue it (same 2 events). Lowering the saturation floor to ~18
  would be needed, which is close to grey. **OpenCV cannot change exposure on this camera** (DirectShow: `set` returns False,
  `get` returns -1 for exposure/gain/fps), so the blur can't be cut in software here. Levers: a **vivid, matte, larger marker**
  (blurred S scales with the original S), **more light** (auto exposure shortens), or a different cue (frame-difference motion in the
  left half, or a pose model's wrist). Re-calibrate with `tools.tune` (key 4) after changing the marker.
  Also: when held still/slow the phone is found in ~97 % of frames where the strip is visible, with 0 false detections in 221
  frames without it (the dull hue-30 patches in the background, S~50 V~40, are excluded by hue and V).
- **With the bright lime tape the marker is vivid (hue ~37, S 100-145, V 122-157, a ~160x80 px bar) and seen in 92 % of frames; the
  remaining problem is framing, not colour.** Live slash recording (tape tracked in 31 % of frames, y range 0.01-0.99): every visible
  stretch was an *upward* move, the tape rising from y~0.97 (entering at the bottom) to y 0.01-0.25 over 0.6-1.3 s, then it was **lost
  for 1.4-2.3 s and reappeared at the bottom**. The swing down happened inside that gap: with the camera framing head-and-shoulders,
  the phone goes up *above* the picture and the slash runs down through it in ~3 frames and out *below* it. Fixes: sit further back
  or tilt/zoom the camera so the swing (e.g. shoulder height to waist) stays inside the picture, and start/finish with a brief
  pause so there is a sighting at each end. Don't infer a slash from "vanished at the top, reappeared at the bottom": a slow
  lowering below the frame looks identical.
  **Final live check (30 s, mixed slashes and ordinary movement, live detector):** the tape was tracked in 57 % of frames; 1 of ~5
  slashes fired (t=16.1 s: a run y 0.01 -> 0.91 in 0.17 s, peak 8.5, with sightings at both ends) and the two other downward runs
  (peaks 1.2 and 1.4, mid-frame) correctly did not. The other ~4 slashes left no sighting at either end: each cycle was tape rising
  to the very top edge (y 0.01-0.10), lost for 1.5-2.3 s, then reappearing at the bottom (y 0.95-0.97). In the earlier recording where
  7/7 fired the top of the raise was y 0.07-0.21 (tape still in view). So recall depends on keeping the *start* of the swing in
  the picture, not on the thresholds. Considered but NOT built: inferring a slash from a hidden traversal (last sighting at the top,
  next one at the bottom, nothing between). It would also fire when the tape is simply turned away at the top and revealed at
  the bottom, and it adds latency (the first bottom sighting can come up to ~2 s after the swing), so it needs its own
  false-positive recording before anyone enables it.
  **Re-test with the swing kept in view (raise only to face/forehead height, 28 s, 5 slashes):** tape tracked in 71 %; live 3/5 fired
  (t=6.0, 10.0, 21.8: tape visible at the top and again at the bottom within 5-6 frames), 4/5 with the final thresholds in replay. The
  last miss (t~14.8): only two slow frames at the start (y 0.05 -> 0.15) were seen, then the tape was lost for 1.2 s. A fast swing's
  middle is blurred, so a swing is only caught if some of it is seen.
  Also: an earlier recording had only sideways sweeps (max downward speed 3 frame-heights/s), so check the motion in a log before
  blaming the detector.
- **OpenCV 5.0 has no classic face/body detector in this venv** (`cv2.CascadeClassifier` is absent, the `haarcascades` folder is empty,
  the `HOGDescriptor` people detector is absent). Anything face- or body-shaped needs a downloaded model.

## Not done / ideas
- Jump: validate the slash suppression against real slashes (see Decisions). A user who jumps from further away or in a plain shirt
  may need `jump_min_area` lowered (the area scales with how much of the picture the body fills); several people in view are not handled.

- Serve it: a FastAPI WebSocket (`/ws/...`, a newest-wins publisher slot so slow clients skip frames instead of queueing), and document the payload in
  `docs/api-contract.md` (not there yet, since nothing consumes it).
- `tools.tune` prints lines to paste; it could write them to a config file (or `.env`) that `Config.from_env` reads.
- Lock the webcam's auto exposure / white balance (`CAP_PROP_AUTO_EXPOSURE`, `CAP_PROP_AUTO_WB`; driver-dependent on
  DirectShow, untested here) to stop the whole picture shifting when an object enters.
- Tracking a specific blob across frames instead of "largest each frame". (Circularity filtering exists for red; shape *recognition* of the drawn path is in `shapes.py`.)
- Slash: get a vivid marker and re-run the swing recording (the replay approach: log `(t, x, y)` of the phone per frame, then feed
  `SlashDetector` variants offline); or add a motion-based cue. Tune the `slash_*` thresholds only after the phone is actually
  tracked through swings.
- Shapes: debounce the live label (it can change while a stroke is closing), more presets, an env var for `Config.shapes`, score the drawing against the target instead of only naming it.
- Tune blue and red against real objects and add more colours (a new colour is one `ColorSpec` in `default_colors()`).
- Velocity/prediction so the object can be bridged across brief occlusions.
- Frontend rendering of the payload's `trace` (it is already normalised and mirrored).
- `docs/cv-architecture.html` and the "CV service" section of `docs/api-contract.md` still describe the deleted cv/ pose
  service; reconcile or remove them once the project direction is settled.

## Conventions

- Match the surrounding style: type hints, `from __future__ import annotations`, short docstrings that say *why*, no
  inline narration.
- Keep time injectable (`now` parameters); never `sleep` in tests.
- If a payload field or endpoint is added, update `../docs/api-contract.md` and [../docs/yellow-tracker.html](../docs/yellow-tracker.html).
- Put scratch scripts outside the repo; `.venv/` is already in the root `.gitignore`.
