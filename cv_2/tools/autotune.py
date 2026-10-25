"""Automatic colour calibration for this camera and room, with no keys to press: just follow the prompts.

Run from cv_2/:  python -m tools.autotune          (q or Esc quits early; nothing is written then)

  1. "Hold the YELLOW WAND ball in the box"  - a countdown, then ~3 s of sampling
  2. "Hold the PHONE TAPE in the box"        - the same for the lime tape on the phone
  3. "Move the wand and the phone around"    - ~4 s with the new thresholds and the real tracker, then the result:
                                                "wand seen 96 %, tape seen 91 %"

The thresholds go to cv_2/tuned.env, which Config.from_env (so tools.publish, tools.demo, tools.tune) reads from then on.
Real YT_* environment variables still win; delete tuned.env to go back to the built-in values. The camera must be free:
stop tools.publish (or the demo launcher's tracker) first.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections.abc import Sequence
from pathlib import Path

import cv2
import numpy as np

from tracker.autotune import MIN_PIXELS, Sampler, band, centre_box, env_text, overlap, rate
from tracker.capture import Camera
from tracker.config import TUNED_ENV, Config
from tracker.detector import ColorDetector, to_hsv
from tracker.track import ColorTrack

FONT = cv2.FONT_HERSHEY_SIMPLEX
WIN = "Storybound colour setup (q quits)"
# (config name, what the player sees, box width and height as fractions of the picture height). The ball is round; the tape
# is a strip across the phone, so its box is wider than tall.
STEPS = (("yellow", "Hold the YELLOW WAND ball in the box", 0.22, 0.22),
         ("phone", "Hold the PHONE TAPE in the box", 0.36, 0.18))
LABEL = {"yellow": "wand", "phone": "tape"}
GOOD = 0.7   # below this detection rate the result is flagged


class Quit(Exception):
    pass


def main() -> int:
    cfg = Config.from_env()
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    ap.add_argument("--camera", type=int, default=cfg.camera)
    ap.add_argument("--prep", type=float, default=3.0, help="countdown before each sample (s)")
    ap.add_argument("--sample", type=float, default=3.0, help="sampling time per object (s)")
    ap.add_argument("--check", type=float, default=4.0, help="validation time (s)")
    ap.add_argument("--out", type=Path, default=TUNED_ENV)
    ap.add_argument("--no-window", action="store_true", help="no window (prompts print here instead)")
    args = ap.parse_args()

    cam = Camera(args.camera, cfg.width, cfg.height).start()
    seq = 0

    def frames(seconds: float):
        """Newest camera frames for `seconds`, showing each one; q / Esc aborts."""
        nonlocal seq
        end = time.monotonic() + seconds
        while (now := time.monotonic()) < end:
            seq, frame = cam.read(seq)
            if frame is None:
                continue
            yield frame, end - now

    def show(frame: np.ndarray, box, title: str, detail: str, colour=(255, 255, 255), progress: float | None = None,
             marks: Sequence[tuple[float, float, tuple[int, int, int]]] = ()) -> None:
        if args.no_window:
            return
        view = cv2.flip(frame, 1) if cfg.mirror else frame.copy()
        w = view.shape[1]
        if box is not None:   # centred, so it is the same box in the mirrored view
            cv2.rectangle(view, (box.x0, box.y0), (box.x1, box.y1), (0, 0, 0), 6)
            cv2.rectangle(view, (box.x0, box.y0), (box.x1, box.y1), colour, 3)
        for x, y, c in marks:
            cv2.circle(view, (int(w - 1 - x if cfg.mirror else x), int(y)), 16, c, 3, cv2.LINE_AA)
        cv2.rectangle(view, (0, 0), (w, 64), (0, 0, 0), -1)
        cv2.putText(view, title, (12, 27), FONT, 0.75, colour, 2, cv2.LINE_AA)
        cv2.putText(view, detail, (12, 54), FONT, 0.55, (220, 220, 220), 1, cv2.LINE_AA)
        if progress is not None:
            cv2.rectangle(view, (0, 62), (int(w * progress), 66), colour, -1)
        cv2.imshow(WIN, view)
        if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
            raise Quit

    def say(text: str) -> None:
        print(text, flush=True)

    wrote = False
    try:
        bands: dict[str, dict] = {}
        for name, prompt, w_frac, h_frac in STEPS:
            colour = cfg.phone.bgr if name == "phone" and cfg.phone else (0, 215, 255)
            say(f"{prompt}: sampling starts in {args.prep:.0f} s.")
            box = None
            for frame, left in frames(args.prep):
                box = box or centre_box(frame.shape[1], frame.shape[0], w_frac, h_frac)
                show(frame, box, prompt, f"Sampling starts in {left:0.0f} s - fill the box with it", colour)
            sampler = None
            for frame, left in frames(args.sample):
                box = box or centre_box(frame.shape[1], frame.shape[0], w_frac, h_frac)
                sampler = sampler or Sampler(box)
                got = sampler.add(to_hsv(frame))
                show(frame, box, prompt, f"Sampling... keep it in the box ({got} px this frame)", colour, 1 - left / args.sample)
            pixels = sampler.pixels if sampler else np.zeros((0, 3), int)
            if len(pixels) < MIN_PIXELS:
                say(f"autotune: could not see the {LABEL[name]} in the box ({len(pixels)} coloured pixels, need {MIN_PIXELS}). "
                    "Hold it closer so it fills the box, in good light, and run again. Nothing was written.")
                return 1
            bands[name] = band(pixels)
            hue = ",".join(f"{a}-{b}" for a, b in bands[name]["hue"])
            say(f"  {LABEL[name]}: hue {hue}, S>={bands[name]['s_min']}, V>={bands[name]['v_min']} from {len(pixels)} pixels "
                f"over {sampler.frames if sampler else 0} frames")
        if overlap(bands["yellow"]["hue"], bands["phone"]["hue"]):
            say("autotune: warning - the wand and the tape came out the same colour, so one may be taken for the other. "
                "Use a yellow ball and lime-green tape, and check the result below.")

        args.out.write_text(env_text(bands, f"camera {args.camera}, {time.strftime('%Y-%m-%d %H:%M')}"), encoding="utf-8")
        wrote = True
        say(f"Saved {args.out}.")

        # Check: the real detector and tracking rules with the new thresholds (exactly what tools.publish will use).
        os.environ["YT_TUNED_ENV"] = str(args.out)
        tuned = Config.from_env()
        overridden = [k for k in env_text(bands).splitlines() if "=" in k and os.getenv(k.split("=")[0])]
        if overridden:
            say("autotune: note - environment variables override part of tuned.env: " + ", ".join(k.split("=")[0] for k in overridden))
        specs = {n: s for n, s in (("yellow", tuned.colors.get("yellow")), ("phone", tuned.phone)) if s}
        tracks = {n: ColorTrack(tuned, ColorDetector(s, tuned.min_area_frac, tuned.track_hue_margin, tuned.track_relax,
                                                     tuned.track_max_growth, tuned.track_min_shrink)) for n, s in specs.items()}
        seen: dict[str, list[bool]] = {n: [] for n in tracks}
        say(f"Now move the wand and the phone around in view for {args.check:.0f} s ...")
        for frame, left in frames(args.check):
            hsv, now, marks = to_hsv(frame), time.monotonic(), []
            for n, track in tracks.items():
                det = track.step(hsv, now)
                seen[n].append(det is not None)
                if det is not None:
                    marks.append((det.x, det.y, specs[n].bgr))
            live = ", ".join(f"{LABEL[n]} {rate(seen[n]):.0%}" for n in tracks)
            show(frame, None, "Move the wand and the phone around", f"Checking the new colours: {live}", progress=1 - left / args.check, marks=marks)
        result = ", ".join(f"{LABEL[n]} seen {rate(seen[n]):.0%}" for n in tracks)
        weak = [LABEL[n] for n in tracks if rate(seen[n]) < GOOD]
        say(f"Result: {result}." + (f" The {' and '.join(weak)} was hard to see: run again closer to the camera or in better light"
                                    " (or delete tuned.env to use the built-in colours)." if weak else " Ready."))
        return 0
    except Quit:
        say("autotune: stopped" + (f" (the new colours are saved in {args.out})." if wrote else ". Nothing was written."))
        return 130
    finally:
        cam.stop()
        if not args.no_window:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    sys.exit(main())
