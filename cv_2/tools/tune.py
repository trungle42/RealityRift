"""Click-to-calibrate: measure your real objects and get thresholds for them.

Run from cv_2/:  python -m tools.tune
  1 / 2 / 3   choose yellow / blue / red (the order of the configured colours)
  click       sample the HSV of the object under the cursor (a 7x7 patch, median)
  p           print PowerShell lines for the chosen colour from all its samples
  c           forget the chosen colour's samples
  m           toggle the mask panel (what the *strict* detector counts as that colour)
  q           quit

Sample the object in the places where it is hardest to see: the brightest side, the darkest
side and the centre of the frame. The suggestion then covers all of them.
"""
from __future__ import annotations

import argparse

import cv2
import numpy as np

from tracker.calibrate import env_lines, suggest
from tracker.capture import Camera
from tracker.config import Config
from tracker.detector import ColorDetector, to_hsv

FONT = cv2.FONT_HERSHEY_SIMPLEX


def main() -> None:
    cfg = Config.from_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=cfg.camera)
    args = ap.parse_args()

    names = list(cfg.colors)
    detectors = {n: ColorDetector(s, cfg.min_area_frac, cfg.track_hue_margin, cfg.track_relax, cfg.track_max_growth,
                                     cfg.track_min_shrink)
                 for n, s in cfg.colors.items()}
    samples: dict[str, list[tuple[int, int, int]]] = {n: [] for n in names}
    marks: dict[str, list[tuple[int, int]]] = {n: [] for n in names}
    state = {"sel": 0, "hsv": None, "mask": True, "last": None}  # hsv = latest frame's HSV

    def on_mouse(event, x, y, *_):
        if event != cv2.EVENT_LBUTTONDOWN or state["hsv"] is None:
            return
        hsv = state["hsv"]
        h, w = hsv.shape[:2]
        if x >= w or y >= h:  # click landed on the mask panel
            return
        rx = w - 1 - x if cfg.mirror else x  # the window shows the mirrored frame
        patch = hsv[max(0, y - 3):y + 4, max(0, rx - 3):rx + 4].reshape(-1, 3)
        # Median per channel; hue is circular, so take it in the shifted space (see calibrate.suggest).
        hh = int((np.median((patch[:, 0].astype(int) + 90) % 180) - 90) % 180)
        sample = (hh, int(np.median(patch[:, 1])), int(np.median(patch[:, 2])))
        name = names[state["sel"]]
        samples[name].append(sample)
        marks[name].append((x, y))
        state["last"] = (name, sample)
        print(f"{name}: sampled H={sample[0]} S={sample[1]} V={sample[2]} at screen x={x} y={y} ({len(samples[name])} samples)")

    win = "Tune colours (1/2/3 colour, click sample, p print, q quit)"
    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)
    cam = Camera(args.camera, cfg.width, cfg.height).start()
    seq = 0
    try:
        while True:
            seq, frame = cam.read(seq)
            if frame is None:
                continue
            state["hsv"] = hsv = to_hsv(frame)
            name = names[state["sel"]]
            view = cv2.flip(frame, 1) if cfg.mirror else frame.copy()
            for n in names:
                for pt in marks[n]:
                    cv2.circle(view, pt, 9, cfg.colors[n].bgr, 2, cv2.LINE_AA)
            cv2.rectangle(view, (0, 0), (view.shape[1], 30), (0, 0, 0), -1)
            msg = f"colour: {name} ({len(samples[name])} samples)"
            if state["last"]:
                n, (h, s, v) = state["last"]
                msg += f"   last {n}: H={h} S={s} V={v}"
            cv2.putText(view, msg, (8, 21), FONT, 0.55, cfg.colors[name].bgr, 2, cv2.LINE_AA)
            if state["mask"]:
                m = detectors[name].mask(hsv)
                m = cv2.flip(m, 1) if cfg.mirror else m
                panel = np.zeros_like(frame)
                panel[m > 0] = cfg.colors[name].bgr
                view = cv2.hconcat([view, panel])
            cv2.imshow(win, view)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key in (ord("1"), ord("2"), ord("3")) and key - ord("1") < len(names):
                state["sel"] = key - ord("1")
            elif key == ord("m"):
                state["mask"] = not state["mask"]
            elif key == ord("c"):
                samples[name].clear(), marks[name].clear()
            elif key == ord("p"):
                if not samples[name]:
                    print(f"{name}: no samples yet - click on the object first")
                else:
                    sug = suggest(samples[name])
                    print(f"\n# {name}: from {len(samples[name])} samples, H {sorted(s[0] for s in samples[name])}")
                    print("\n".join(env_lines(name, sug)) + "\n")
    finally:
        cam.stop()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
