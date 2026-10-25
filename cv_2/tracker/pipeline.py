from __future__ import annotations

import math
import time

import numpy as np

from .config import Config
from .detector import ColorDetector, Detection, to_hsv
from .trace import DetectionGate, Trace


class Pipeline:
    """frame -> gate -> per colour (detect -> smooth -> trace) -> payload. One gate drives every
    colour: while it is off no detector runs, and all traces are erased on the on->off edge."""

    def __init__(self, cfg: Config, detectors: dict[str, ColorDetector] | None = None):
        self.cfg = cfg
        self.detectors = detectors or {
            n: ColorDetector(s, cfg.min_area_frac, cfg.track_hue_margin, cfg.track_relax, cfg.track_max_growth,
                          cfg.track_min_shrink)
            for n, s in cfg.colors.items()
        }
        self.gate = DetectionGate(cfg.period_s)
        self.traces = {n: Trace(cfg.gap_s, cfg.max_trace_points) for n in self.detectors}
        self._smooth: dict[str, tuple[float, float] | None] = dict.fromkeys(self.detectors)
        # Last detection and when, per colour: the hint that switches a detector to following mode.
        self._last: dict[str, tuple[Detection, float] | None] = dict.fromkeys(self.detectors)
        # Candidate new object per colour: (detection, consecutive frames seen, time of last sighting).
        self._cand: dict[str, tuple[Detection, int, float] | None] = dict.fromkeys(self.detectors)
        self._was_active = True

    def _nx(self, x: float, w: int) -> float:
        v = x / w
        return float(round(1.0 - v if self.cfg.mirror else v, 4))

    @staticmethod
    def _continues(det: Detection, hint: Detection | None) -> bool:
        """Is det the object being followed? Near its last position, or (after a fast move) the same size.
        A lip-sized blip next to a ball is neither."""
        if hint is None:
            return False
        near = math.hypot(det.x - hint.x, det.y - hint.y) <= 2 * hint.radius + 10
        return near or 0.5 <= det.area / hint.area <= 2.0

    def _confirm(self, name: str, det: Detection, now: float) -> Detection | None:
        """A new object counts once seen acquire_frames times in a row, close together."""
        prev = self._cand[name]
        same = prev is not None and now - prev[2] <= 0.2 and math.hypot(det.x - prev[0].x, det.y - prev[0].y) <= max(100.0, 3 * det.radius)
        n = prev[1] + 1 if same else 1
        self._cand[name] = (det, n, now)
        return det if n >= self.cfg.acquire_frames else None

    def process(self, frame: np.ndarray, now: float | None = None) -> dict:
        now = time.monotonic() if now is None else now
        h, w = frame.shape[:2]
        active, remaining = self.gate.state(now)

        if self._was_active and not active:
            for t in self.traces.values():
                t.clear()
        self._was_active = active

        objects: dict[str, dict | None] = dict.fromkeys(self.detectors)
        if active:
            hsv = to_hsv(frame)
            a = self.cfg.smooth_alpha
            for name, detector in self.detectors.items():
                last = self._last[name]
                hint = last[0] if last and now - last[1] <= self.cfg.hold_s else None
                det = detector.detect(hsv, hint)
                if det is None:
                    self._cand[name] = None
                elif self.cfg.acquire_frames > 1 and not self._continues(det, hint):
                    det = self._confirm(name, det, now)
                if det is None:
                    self._smooth[name] = None
                    continue
                self._last[name] = (det, now)
                px, py = self._smooth[name] or (det.x, det.y)
                sx, sy = a * det.x + (1 - a) * px, a * det.y + (1 - a) * py
                self._smooth[name] = (sx, sy)
                self.traces[name].add(now, (self._nx(sx, w), float(round(sy / h, 4))))
                objects[name] = {
                    "x": self._nx(det.x, w), "y": float(round(det.y / h, 4)),
                    "radius": float(round(det.radius / w, 4)),
                }
        else:
            self._smooth = dict.fromkeys(self.detectors)
            self._last = dict.fromkeys(self.detectors)
            self._cand = dict.fromkeys(self.detectors)

        return {
            "active": active,
            "secondsLeft": float(round(remaining, 2)),
            "mirrored": self.cfg.mirror,
            "objects": objects,
            "traces": {n: [list(map(list, seg)) for seg in t.segments] for n, t in self.traces.items()},
        }
