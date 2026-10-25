"""Webcam demo: traces a yellow object's path; detection toggles on/off every 5 s and each
time it turns off the trace is erased.

Run from the cv_2/ folder:  python -m tools.demo          (q quits, m toggles the colour-mask view)
Headless smoke test:        python -m tools.demo --no-window --frames 60
"""
from __future__ import annotations

import argparse
import time

import cv2

from yellow_tracker.capture import Camera
from yellow_tracker.config import Config
from yellow_tracker.overlay import draw
from yellow_tracker.pipeline import Pipeline


def main() -> None:
    cfg = Config.from_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=cfg.camera)
    ap.add_argument("--period", type=float, default=cfg.period_s, help="seconds per on/off phase")
    ap.add_argument("--frames", type=int, default=0, help="stop after N frames (0 = until q)")
    ap.add_argument("--no-window", action="store_true")
    args = ap.parse_args()
    cfg.camera, cfg.period_s = args.camera, args.period

    pipe = Pipeline(cfg)
    cam = Camera(cfg.camera, cfg.width, cfg.height).start()
    seq, n, start, last, show_mask = 0, 0, time.monotonic(), None, False
    try:
        while not args.frames or n < args.frames:
            seq, frame = cam.read(seq)
            if frame is None:
                continue
            last = pipe.process(frame)
            n += 1
            if not args.no_window:
                view = draw(frame, last, cfg.period_s)
                if show_mask:
                    mask = pipe.detector.mask(frame)
                    mask = cv2.flip(mask, 1) if cfg.mirror else mask
                    view = cv2.hconcat([view, cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)])
                cv2.imshow("Yellow tracker (q quit, m mask)", view)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                if key == ord("m"):
                    show_mask = not show_mask
    finally:
        cam.stop()
        cv2.destroyAllWindows()
    dt = time.monotonic() - start
    print(f"{n} frames in {dt:.1f}s = {n / dt:.1f} fps")
    if last:
        print(f"active={last['active']} object={last['object']} "
              f"trace_points={sum(len(s) for s in last['trace'])}")


if __name__ == "__main__":
    main()
