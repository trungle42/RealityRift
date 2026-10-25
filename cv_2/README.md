# Yellow object tracker

Webcam → find the yellow object (e.g. a ball on a stick) → draw the path it moves along on the live view.
Detection **turns off and on every 5 seconds, and the trace is erased each time it turns off**.

No learned model: the object is found by HSV colour thresholding (`yellow_tracker/detector.py`), so there is
nothing to download and it costs ~1 ms per frame.
User guide with diagrams: [../docs/yellow-tracker.html](../docs/yellow-tracker.html). Developer context
(decisions, gotchas, ideas): [CLAUDE.md](CLAUDE.md).

```
yellow_tracker/
  config.py    Config dataclass + from_env() (YT_* env vars)
  capture.py   Camera: newest-frame-wins webcam thread
  detector.py  YellowDetector: HSV mask -> largest blob -> centroid/radius
  trace.py     DetectionGate (5 s on/off square wave), Trace (polyline segments, broken across lost-track gaps)
  pipeline.py  Pipeline.process(frame, now) -> payload; clears the trace on the on->off edge, skips detection while off
  overlay.py   draw(frame, payload, period_s): fading trail, marker on the object, ON/OFF banner + countdown bar
tools/demo.py  OpenCV window
tests/         Synthetic frames and an injectable clock: no camera needed
```

## Run

Self-contained venv. On Windows on ARM64 it **must use the x86_64 Python 3.12** (runs under emulation):
OpenCV publishes no `win_arm64` wheel, so a native ARM64 venv makes `uv` try to compile OpenCV and NumPy and fail.
On a Mac or x64 machine a plain `uv venv --python 3.12 .venv` is fine.

```
uv venv --python cpython-3.12-windows-x86_64-none .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
```

Then, from `cv_2/` (use `.venv\Scripts\python.exe`):

```
python -m tools.demo                      # q quits, m shows the colour mask beside the view
python -m tools.demo --period 3           # different on/off period
python -m tools.demo --no-window --frames 90   # headless smoke test
python -m pytest
```

## Tuning

If it misses the object or picks up something else, press `m` in the demo: the right pane is what counts as
yellow. Adjust with env vars (OpenCV hue is 0-179, yellow ≈ 30):

| var | default | effect |
|---|---|---|
| `YT_H_MIN` / `YT_H_MAX` | 20 / 25 | hue band (narrow: tuned for the dev camera/object; widen towards 30 if yours is missed) |
| `YT_S_MIN` / `YT_V_MIN` | 90 / 90 | raise to reject pale/dark yellowish things (skin, wood, walls) |
| `YT_MIN_AREA` | 0.0006 | smallest blob, fraction of frame |
| `YT_PERIOD` | 5 | seconds per on/off phase |
| `YT_MIRROR` | 1 | selfie-style view |

Notes: the largest yellow blob wins, so keep other yellow things out of view; the stick should not be yellow.
Thresholds were validated on synthetic frames and a quick live smoke test, not across lighting conditions.
