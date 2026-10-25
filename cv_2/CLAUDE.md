# cv_2/: yellow-object path tracker

Context for anyone (human or agent) continuing work here. User-facing setup is in [README.md](README.md); diagrams and a
user guide are in [../docs/yellow-tracker.html](../docs/yellow-tracker.html). It replaces the earlier `cv/` pose/zone
service (RTMPose over ONNX Runtime, port 8001, `/ws/cv`), which was **deleted from the working tree and never committed**,
so it is not recoverable from git. This project is self-contained: its own venv, its own copy of `Camera`.

## What this is

A standalone webcam program. It finds a **yellow object (a ball/blob on a stick)**, draws the **path it moves along** over
the live view, and **toggles detection on/off every 5 s; each time it turns off the drawn path is erased**. There is no
server, WebSocket or frontend integration yet: the only consumer is `tools/demo.py` (OpenCV window).

## Commands (run from `cv_2/`; Windows venv python is `.venv\Scripts\python.exe`)

```
python -m tools.demo                           # window; q quits, m shows the colour mask beside the view
python -m tools.demo --period 3                # different on/off period
python -m tools.demo --no-window --frames 90   # headless smoke test, prints fps + last result
python -m pytest                               # 17 tests, no camera needed
```

Env knobs (`yellow_tracker/config.py`): `YT_CAMERA, YT_WIDTH, YT_HEIGHT, YT_H_MIN, YT_H_MAX, YT_S_MIN, YT_V_MIN,
YT_MIN_AREA, YT_PERIOD, YT_MIRROR`. Everything else is a `Config` dataclass field.

## Code map

```
yellow_tracker/
  config.py    Config dataclass + from_env(). All tunables live here (HSV band, period, smoothing, gap, cap).
  capture.py   Camera: thread that keeps only the newest frame. Carried over from the old cv/ service.
  detector.py  YellowDetector: blur -> HSV -> inRange -> open/close -> largest contour -> Detection(x,y,radius,area).
               mask() is public so the demo can show it.
  trace.py     DetectionGate (on/off square wave, time passed in), Trace (polyline segments, gap break, point cap).
  pipeline.py  Pipeline.process(frame, now) -> payload dict. The only place stages are wired together.
  overlay.py   draw(frame, payload, period_s): fading trail, marker, ON/OFF banner, countdown bar, red border when off.
tools/demo.py  Window + --no-window smoke test + mask view.
tests/         Synthetic frames (grey room, ball on a stick, skin/blue/orange distractors); injectable clock.
```

Data flow: `Camera -> Pipeline.process -> gate.state(now) -> [on: detect -> EMA smooth -> trace.add] / [off: nothing] ->
payload -> overlay.draw`.

Payload: `{active, secondsLeft, mirrored, object: {x, y, radius} | null, trace: [[[x, y], ...], ...]}`. All coordinates
are normalised 0-1 (radius is a fraction of frame **width**), x already mirrored when `mirrored`, plain Python floats.

## Decisions and why (don't undo without reading)

- **Colour thresholding, not a neural model.** The target is defined by colour alone, so HSV `inRange` is ~1 ms/frame,
  needs no download and avoids the ARM64 PyTorch/MediaPipe wheel problems the old cv/ service ran into (it used ONNX Runtime for that reason). The cost is that it is
  only as good as the colour contrast: anything else in the band is a candidate (see Gotchas). If a *shape* is ever needed
  (stick vs. ball, several objects), add contour filtering (circularity/solidity) before reaching for a model.
- **Largest blob wins**, a single object only. Simplest rule that matches "a yellow object"; it is also why other yellow
  things in view steal the trace.
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
- **The hue band is the main thing to tune, and it changes between cameras/lighting.** OpenCV hue is 0-179; pure yellow
  is 30, but webcam white balance moves it (the band was narrowed to 20-25 for the dev camera/object). Use the demo's `m`
  mask view. The tests do **not** hard-code a colour: `tests/test_tracker.py::_band_centre_bgr` builds the synthetic
  ball from the middle of the default band, so retuning `Config` defaults does not break them. (An earlier hard-coded
  hue-30 ball made 8 tests fail the moment the band was narrowed.)
- **Skin, wood and warm-white walls sit just below yellow in hue** (~8-20) and leak in if `s_min`/`v_min` are low or the
  band reaches down. Raise saturation before widening anything.
- **A yellow stick would be detected as part of the object** (and shift the centroid). Use a non-yellow stick.
- **Don't flip the frame before detection.** Only the output is mirrored. (Harmless for colour, but it keeps one
  convention: payload x is mirrored, raw frames never are.)
- **JSON-ness:** convert NumPy scalars with `float(...)` at the payload boundary (`Pipeline.process` does); a test
  `json.dumps`es the payload.
- **A leftover process can hold the webcam** (e.g. a previous demo that did not exit). Symptom:
  "Could not open camera 0" or a frozen feed. Check `Get-CimInstance Win32_Process | ? { $_.CommandLine -like '*python*' }`.
- `Camera` uses DirectShow on Windows and AVFoundation on macOS (terminal/IDE needs camera permission on first run).

## Testing approach

Everything is testable without hardware. `tests/test_tracker.py` renders frames with OpenCV drawing calls and a fake clock:
detector (finds the ball not the stick, none when absent, rejects skin/blue/orange, picks yellow among distractors,
ignores specks), gate (alternation, countdown), trace (gap split, cap, clear), pipeline (path follows the object, **erased
on every off edge over 3 cycles**, fresh start after turning on, detector not called while off, lost track breaks the
line, mirroring + JSON, smoothing lag) and overlay (draws in both states). Live behaviour is checked by hand with
`tools.demo`; **the live trail/toggle has only been smoke-tested headless (fps + a detection), not visually reviewed
across lighting conditions or object types.**

## Not done / ideas

- Serve it: a FastAPI WebSocket (`/ws/...`, a newest-wins publisher slot so slow clients skip frames instead of queueing), and document the payload in
  `docs/api-contract.md` (not there yet, since nothing consumes it).
- Click-to-calibrate: sample HSV from the object under the cursor and set the band automatically, instead of env vars.
- Shape filtering (circularity/solidity) and tracking a specific blob across frames instead of "largest each frame".
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
