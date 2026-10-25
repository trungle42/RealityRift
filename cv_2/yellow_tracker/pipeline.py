from __future__ import annotations

import time

import numpy as np

from .config import Config
from .detector import Detection, YellowDetector
from .trace import DetectionGate, Trace


class Pipeline:
    """frame -> gate -> (detect -> smooth -> trace) -> payload. While the gate is off the
    detector is not run at all, and the trace is erased on the on->off edge."""

    def __init__(self, cfg: Config, detector: YellowDetector | None = None):
        self.cfg = cfg
        self.detector = detector or YellowDetector(cfg)
        self.gate = DetectionGate(cfg.period_s)
        self.trace = Trace(cfg.gap_s, cfg.max_trace_points)
        self._was_active = True
        self._smooth: tuple[float, float] | None = None

    def _nx(self, x: float, w: int) -> float:
        v = x / w
        return float(round(1.0 - v if self.cfg.mirror else v, 4))

    def process(self, frame: np.ndarray, now: float | None = None) -> dict:
        now = time.monotonic() if now is None else now
        h, w = frame.shape[:2]
        active, remaining = self.gate.state(now)

        if self._was_active and not active:
            self.trace.clear()
        self._was_active = active

        det: Detection | None = None
        if active:
            det = self.detector.detect(frame)
            if det is None:
                self._smooth = None
            else:
                a = self.cfg.smooth_alpha
                px, py = self._smooth or (det.x, det.y)
                self._smooth = (a * det.x + (1 - a) * px, a * det.y + (1 - a) * py)
                self.trace.add(now, (self._nx(self._smooth[0], w), float(round(self._smooth[1] / h, 4))))
        else:
            self._smooth = None

        return {
            "active": active,
            "secondsLeft": float(round(remaining, 2)),
            "mirrored": self.cfg.mirror,
            "object": None if det is None else {
                "x": self._nx(det.x, w), "y": float(round(det.y / h, 4)),
                "radius": float(round(det.radius / w, 4)),
            },
            "trace": [list(map(list, seg)) for seg in self.trace.segments],
        }
