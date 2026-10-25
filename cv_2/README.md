# Colour blob tracker (yellow, blue, red)

Webcam → find a yellow, a blue and a red object (e.g. balls on sticks) → draw each one's path in its own colour on the
live view. Detection **turns off and on every 5 seconds, and every trace is erased each time it turns off**.

No learned model: each object is found by HSV colour thresholding (`tracker/detector.py`), so there is
nothing to download and it costs ~1 ms per colour per frame.

User guide with diagrams: [../docs/yellow-tracker.html](../docs/yellow-tracker.html). Developer context
(decisions, gotchas, ideas): [CLAUDE.md](CLAUDE.md).

```
tracker/
  config.py    Config + ColorSpec table (yellow, blue, red) + from_env() (YT_* env vars)
  capture.py   Camera: newest-frame-wins webcam thread
  detector.py  ColorDetector: HSV mask (red = two hue ranges) -> blob -> centroid/radius; strict to find, relaxed to follow
  calibrate.py suggest(): HSV samples -> thresholds (used by tools/tune.py)
  shapes.py    ShapeRecognizer: closed path -> circle / triangle / square / star (Fourier descriptors) or unknown
  trace.py     DetectionGate (5 s on/off square wave), Trace (polyline segments, broken across lost-track gaps)
  pipeline.py  Pipeline.process(frame, now) -> payload; one gate for all colours; clears every trace on the on->off edge;
               advances the shape to draw (circle, triangle, square, star, ...) on every off->on edge and names each colour's drawing
  overlay.py   draw(...): per-colour fading trail + marker, ON/OFF banner + countdown bar, the shape to draw + detected shape; mask_view(...)
  game.py      game_message(payload): the small per-frame message the game receives
tools/demo.py  OpenCV window
tools/tune.py  click-to-calibrate window: sample your objects, get thresholds to paste
tools/publish.py  sends the tracker to the game through the backend relay
tests/         Synthetic frames and an injectable clock: no camera needed
```

## Jump

Stand about 1.5-2 m from the camera and jump: the demo shows **JUMPED!** for 2 seconds. It watches how much of the picture moves
(optical flow) and fires when a big, fast upward burst is followed by a downward one, at the landing. Leaning, bending, sitting,
standing up, waving and phone swings do not count. It is always on (independent of the wand's 5 s cycle); `YT_JUMP=0` turns it off and
`python -m tools.demo --debug` shows the live motion values. Thresholds are in `Config.jump_*` (see `CLAUDE.md` for how they were measured).

## Slash (phone)

Bright lime-green tape on the front of the phone, held in the left hand, is tracked on every frame (even while the wand is paused). A
big, fast downward swing (at least 30% of the picture height, with a burst of at least ~4.5 picture-heights/s) shows **SLASHED!** for 2 seconds; relaxed lowering and ordinary movement do not. **Framing matters:** a real slash takes ~3 frames, so
keep the whole swing (say shoulder height to waist) **inside the picture** and pause briefly at the top and bottom; if the phone
leaves the top of the frame the swing is not seen. Use a vivid, matte marker, good light, and re-run `tools.tune` (key `4`) if the
colour is off. See `CLAUDE.md` for the measurements.

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
python -m tools.demo                      # q quits, m shows the colour masks beside the view
python -m tools.demo --period 3           # different on/off period
python -m tools.demo --no-window --frames 90   # headless smoke test
python -m pytest
```

## Send it to the game

With the backend running (`backend/`, port 8000) and the game open:

```
python -m tools.publish                                   # ws://localhost:8000/ws/cv/storybound
python -m tools.publish --window                          # also show the tracker's view (q quits)
python -m tools.publish --api http://localhost:8020 --room demo
```

It runs the same tracker and sends a small message per frame through the backend relay (`/ws/cv/{room}`, see
[../docs/api-contract.md](../docs/api-contract.md)). In the game a **slash swings the sword**, a **jump makes the hero jump** and
**moving during the freeze spell** breaks it. The game must use the same room (`?room=demo` in its URL; both default to
`storybound`). The terminal prints when the backend connects, when the game joins, and each slash/jump. Slashes count again after
0.5 s here (`--slash-hold`), not the demo's 2 s. The wand round is sent too, read-only; shapes do not cast spells in the game yet.
The tracker holds the webcam, so test the game's scanner (X) on the demo laptop with it running: macOS shares the camera, Windows
may not.

## Tuning

**Best way: measure your own objects.** Webcam lighting is rarely even (on the dev laptop the brightness differs 2x from one
side of the frame to the other), so a ball gets washed out or dim toward one edge and a fixed threshold makes it flicker
or vanish there.

```
python -m tools.tune
```

Press `1` / `2` / `3` to pick yellow / blue / red, then **click the object in several places**: the side where it
disappears, the other side, and the middle. Press `p` to print PowerShell lines covering all the samples
(`$env:YT_BLUE_HUE=...`, `..._S_MIN`, `..._V_MIN`), paste them, and start the demo. `c` clears a colour's samples, `m` toggles
the mask panel.

Detection is also forgiving once it has found an object: it is acquired with the strict thresholds and then followed with
relaxed ones near its last position (`track_*`, `hold_s` in `Config`), so a ball that fades toward the bright or dark side
keeps its trail. Even lighting still helps most: face a light or window rather than having it to one side, use a
**matte** ball (shiny ones wash out), and turn off auto exposure / white balance in your camera settings if you can.

Manual tuning:

If it misses an object or picks up something else, press `m` in the demo: the right pane paints what each detector
counts as its colour (yellow, blue, red) on black. Adjust with env vars (OpenCV hue is 0-179: yellow ≈ 30,
blue ≈ 110, red ≈ 0 and wraps around to 179, so red takes two ranges):

| var | default | effect |
|---|---|---|
| `YT_COLORS` | `yellow,blue,red` | which colours run, e.g. `YT_COLORS=blue,red` |
| `YT_YELLOW_HUE` | `20-25` | hue band (narrow: tuned for the dev camera/object; widen towards 30 if yours is missed) |
| `YT_BLUE_HUE` | `103-115` | hue band (calibrated with `tools.tune` on the dev camera) |
| `YT_RED_HUE` | `174-179,0-6` | two ranges, comma separated (calibrated the same way) |
| `YT_<COLOR>_S_MIN` | 90 / 62 / 117 | yellow / blue / red minimum saturation; raise to reject pale things (skin, walls) |
| `YT_<COLOR>_V_MIN` | 90 / 88 / 97 | minimum brightness |
| `YT_<COLOR>_MIN_AREA` | 0 / 0 / 0.002 | this colour's own smallest blob (fraction of frame; 0 = use `YT_MIN_AREA`). Red's floor (~600 px) sits above lips (~200-400 px) and well below a ball |
| `YT_<COLOR>_MIN_CIRC` | 0 / 0 / 0.58 | roundness (1 = circle) a blob needs to be *found*; red uses it to ignore lips and skin, which are strips (~0.5). 0 = off |
| `YT_MIN_AREA` | 0.0006 | smallest blob, fraction of frame |
| `YT_PERIOD` | 5 | seconds per on/off phase |
| `YT_PHONE` | 1 | `0` turns the slash feature off |
| `YT_JUMP` | 1 | `0` turns jump detection off |
| `YT_PHONE_HUE` / `_S_MIN` / `_V_MIN` | `31-43` / 70 / 80 | the phone's lime tape (tune with `tools.tune`, key `4`) |
| `YT_MIRROR` | 1 | selfie-style view |

Notes: for each colour the largest blob wins, so keep other things of that colour out of view; sticks should not be any
of the three colours. Red is the touchiest: skin and lips match its colour, so red also requires a **round** blob to be found (`YT_RED_MIN_CIRC`). A lip-shaped strip is ignored; a ball partly covered by a hand is still followed once found. Red also ignores blobs under ~600 px (`YT_RED_MIN_AREA`), so keep the red object big enough in the picture. Use a round object, and lower `YT_RED_MIN_CIRC` if yours is not round.
A *new* object must be seen in 3 consecutive frames (`acquire_frames` in `Config`, about 0.1 s) before it is reported, so a one-frame blip of skin or clothing never starts a trace. Thresholds
were validated on synthetic frames and a quick live smoke test, not across lighting conditions.
