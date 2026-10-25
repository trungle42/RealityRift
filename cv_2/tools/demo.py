"""Webcam demo: traces the path of a yellow, a blue and a red object. Detection toggles on/off
every 5 s and each time it turns off all the traces are erased. Each ON phase asks for the next shape
(circle, triangle, square, star, then round again) and names the shape the recogniser sees you drawing.
Jump and it shows JUMPED! (--debug shows the motion values behind it).
Swing the phone (green strip) down fast and it shows SLASHED! for a couple of seconds, whatever the wand is doing.

Run from the cv_2/ folder:  python -m tools.demo          (q quits, m toggles the colour-mask view)
Headless smoke test:        python -m tools.demo --no-window --frames 60
"""
from __future__ import annotations

import argparse
import time

import cv2

from tracker.capture import Camera
from tracker.config import Config
from tracker.overlay import draw, mask_view
from tracker.pipeline import Pipeline


def main() -> None:
    cfg = Config.from_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=cfg.camera)
    ap.add_argument("--period", type=float, default=cfg.period_s, help="seconds per on/off phase")
    ap.add_argument("--frames", type=int, default=0, help="stop after N frames (0 = until q)")
    ap.add_argument("--no-window", action="store_true")
    ap.add_argument("--debug", action="store_true", help="show the live motion values used by jump detection")
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
                view = draw(frame, last, cfg.period_s, {**cfg.colors, **({"phone": cfg.phone} if cfg.phone else {})},
                            cfg.slash_hold_s, cfg.jump_hold_s, args.debug)
                if show_mask:
                    view = cv2.hconcat([view, mask_view(frame, {**pipe.detectors, **({"phone": pipe.phone_detector} if pipe.phone_detector else {})}, cfg.mirror)])
                cv2.imshow("Colour tracker (q quit, m mask)", view)
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
        print(f"active={last['active']}")
        for name, obj in last["objects"].items():
            pts = sum(len(s) for s in last["traces"][name])
            print(f"  {name}: object={obj} trace_points={pts} shape={last['shapes'][name]}")
        print(f"  target={last['target']} next={last['next']} previous={last['previous']}")
        print(f"  phone={last['phone']} slash={last['slash']}")
        print(f"  jump={last['jump']} motion={last['motion']}")


if __name__ == "__main__":
    main()
