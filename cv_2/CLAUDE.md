# cv_2/: yellow / blue / red blob path tracker

Context for anyone (human or agent) continuing work here. User-facing setup is in [README.md](README.md); diagrams and a
user guide are in [../docs/yellow-tracker.html](../docs/yellow-tracker.html). It replaces the earlier `cv/` pose/zone
service (RTMPose over ONNX Runtime, port 8001, `/ws/cv`), which was **deleted from the working tree and never committed**,
so it is not recoverable from git. This project is self-contained: its own venv, its own copy of `Camera`.

## What this is

A standalone webcam program. It finds a **yellow, a blue and a red object (a ball/blob on a stick each)**, draws the
**path each one moves along**, in its own colour, over the live view, and **toggles detection on/off every 5 s; each time
it turns off every drawn path is erased**. There is no server, WebSocket or frontend integration yet: the only consumer
is `tools/demo.py` (OpenCV window).

## Commands (run from `cv_2/`; Windows venv python is `.venv\Scripts\python.exe`)

```
python -m tools.demo                           # window; q quits, m shows the colour masks beside the view
python -m tools.demo --period 3                # different on/off period
python -m tools.demo --no-window --frames 90   # headless smoke test, prints fps + per-colour result
python -m tools.tune                           # click-to-calibrate: sample your objects, get YT_* lines (p)
python -m pytest                               # 55 tests, no camera needed
```

Env knobs (`tracker/config.py`): `YT_CAMERA, YT_WIDTH, YT_HEIGHT, YT_COLORS` (subset, e.g. `blue,red`),
`YT_<COLOR>_HUE` (`20-25`, or `174-179,0-6` for a wrapping band), `YT_<COLOR>_S_MIN`, `YT_<COLOR>_V_MIN`, `YT_<COLOR>_MIN_CIRC`, `YT_<COLOR>_MIN_AREA`, `YT_MIN_AREA`,
`YT_PERIOD, YT_MIRROR`. Everything else is a `Config` dataclass field. (The old single-colour `YT_H_MIN/H_MAX/S_MIN/V_MIN`
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
  trace.py     DetectionGate (on/off square wave, time passed in), Trace (polyline segments, gap break, point cap).
  pipeline.py  Pipeline.process(frame, now) -> payload dict. The only place stages are wired together.
  overlay.py   draw(frame, payload, period_s, colors): per-colour fading trail + marker + name, ON/OFF banner, countdown
               bar, red border when off. mask_view(): each detector's mask painted in its colour.
tools/demo.py  Window + --no-window smoke test + mask view.
tools/tune.py  Click-to-calibrate window: sample HSV of the object at several places, print suggested YT_* lines.
tests/         Synthetic frames (grey room, coloured balls on sticks, skin/green/orange distractors); injectable clock.
```

Data flow: `Camera -> Pipeline.process -> gate.state(now) -> [on: to_hsv once -> for each colour: detect -> EMA smooth ->
trace.add] / [off: nothing] -> payload -> overlay.draw`.

Payload: `{active, secondsLeft, mirrored, objects: {name: {x, y, radius} | null}, traces: {name: [[[x, y], ...], ...]}}`
with `name` in the configured colours (`yellow`, `blue`, `red` by default). All coordinates are normalised 0-1 (radius is a
fraction of frame **width**), x already mirrored when `mirrored`, plain Python floats. (Before blue/red were added this was
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
- **Hysteresis: acquire strict, follow relaxed** (`ColorDetector.detect(hsv, hint)`; `Pipeline._last` keeps the hint for
  `hold_s`=0.5 s). Found with the strict `ColorSpec` thresholds; while tracked, the blob nearest the last position is
  taken from a relaxed mask (hue band widened by `track_hue_margin`=4, saturation/brightness floors x `track_relax`=0.5).
  Why: lighting across the frame is uneven (measured on the dev webcam: mean brightness 164 on one side to 73 on the
  other, neutral colour cast), so a ball fades/washes out toward one edge and a single fixed threshold made it flicker
  and vanish there. Relaxing *only near the previous position* keeps it tracked without letting skin or walls elsewhere
  in, and relaxed thresholds are never used to acquire. Costs: ball and an adjacent relaxed-colour object (a wooden stick,
  a hand) can merge and drag the centroid, so the hue margin is small and sticks must be neutral. Off: `track_relax=1.0`,
  `track_hue_margin=0`.
- **Red has its own minimum blob size** (`ColorSpec.min_area_frac`=0.002, ~614 px at 640x480; 0 = global `min_area_frac`, which is
  ~184 px and still applies to yellow/blue). Lips measured 200-400 px; the dev ball is ~6000 px. It also applies to the relaxed
  following mask. Cost: a red ball under ~14 px radius (far from the camera) is not found.
- **A new object must be confirmed over `acquire_frames`=3 consecutive frames** (`Pipeline._confirm`), then it is followed
  without further checks. Exempt (`Pipeline._continues`): a detection near the followed object's last position, or of similar size
  (0.5-2x its area) after a fast move, so tracking and fast re-finds are not delayed. Why: after every other filter a live lips-only
  run still had one single-frame blip (~17 px radius, below the mouth, probably neck/clothing); confirmation removes that whole class
  rather than tuning colours per blip. Cost: ~0.1 s before a trace starts. Confirmation state is per colour, cleared on a gap or when
  the gate turns off. `Config(acquire_frames=1)` disables it (the tests do, except the dedicated ones).
- **Following is bounded to `track_min_shrink`=0.3x .. `track_max_growth`=2x the last detection's area** (`ColorDetector._near`).
  The lower bound came from a live timeline (ball swept past the mouth): while following, the nearest relaxed blob within reach
  of the ball's last position won for 1-3 frames even when it was a lip-sized strip (~7% of the ball's area), a brief marker
  jump to the chin/mouth. A *much smaller* blob is not the ball changing size, so it is skipped. A hand covering part of the
  ball (down to ~30% of its area) is still followed; below that the object is reported lost until strict acquisition re-finds it.
  The upper bound: Without it the relaxed
  mask is a runaway: lock onto lips (~250 px) and the relaxed red mask (S>=58) covers the whole face (~12,000 px) because skin
  passes it, the face blob is always there, and the hint keeps refreshing, so the "red object" became the face (measured: radius
  62 px at frame centre, 100% of frames, ball out of view). A blob over the cap is skipped and strict acquisition (with the shape
  test) runs instead, so a ball held against the face is still found by its strict, round blob. A real ball changes area
  gradually (test: ~1.3x/frame for a ball approaching the camera), so 2x is generous; widen it if a fast approach loses the object.
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
  `ColorSpec.min_circ` (red: 0.62; others 0 = off) rejects non-round blobs at *acquisition only* (`ColorDetector._largest`:
  the largest blob that passes, not "largest, then check"). Following uses the relaxed near-hint mask with no shape test, so
  a ball partly covered by a hand is kept. Circularity is `4*pi*area/perimeter^2` on the CHAIN_APPROX_SIMPLE contour; the
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
subset pipelines), overlay (draws in both states, `mask_view` paints each colour). Live behaviour is checked by hand with
`tools.demo`; **the live trails/toggle have only been smoke-tested headless (fps + detections), not visually reviewed
across lighting conditions or object types, and blue/red thresholds have never been tuned against real objects.**

## Not done / ideas

- Serve it: a FastAPI WebSocket (`/ws/...`, a newest-wins publisher slot so slow clients skip frames instead of queueing), and document the payload in
  `docs/api-contract.md` (not there yet, since nothing consumes it).
- `tools.tune` prints lines to paste; it could write them to a config file (or `.env`) that `Config.from_env` reads.
- Lock the webcam's auto exposure / white balance (`CAP_PROP_AUTO_EXPOSURE`, `CAP_PROP_AUTO_WB`; driver-dependent on
  DirectShow, untested here) to stop the whole picture shifting when an object enters.
- Shape filtering (circularity/solidity) and tracking a specific blob across frames instead of "largest each frame".
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
