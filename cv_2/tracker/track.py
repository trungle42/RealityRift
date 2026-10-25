from __future__ import annotations

import math

import numpy as np

from .config import Config
from .detector import ColorDetector, Detection


class ColorTrack:
    """One colour's object over time: detect (strict first, relaxed fallback) -> confirm a new object over several
    frames -> smooth. Owns the state that makes detection a track: the hint, the candidate and the smoothed point.
    The wand colours and the phone marker each have one, so they follow exactly the same rules."""

    def __init__(self, cfg: Config, detector: ColorDetector):
        self.cfg, self.detector = cfg, detector
        self.smoothed: tuple[float, float] | None = None
        # (detection, time of last sighting of any kind, time of last strict sighting)
        self._last: tuple[Detection, float, float] | None = None
        # Candidate new object: (detection, consecutive frames seen, time of last sighting).
        self._cand: tuple[Detection, int, float] | None = None

    def reset(self) -> None:
        self.smoothed = self._last = self._cand = None

    @staticmethod
    def _continues(det: Detection, hint: Detection | None) -> bool:
        """Is det the object being followed? Near its last position, or (after a fast move) the same size.
        A lip-sized blip next to a ball is neither."""
        if hint is None:
            return False
        near = math.hypot(det.x - hint.x, det.y - hint.y) <= 2 * hint.radius + 10
        return near or 0.5 <= det.area / hint.area <= 2.0

    def _confirm(self, det: Detection, now: float) -> Detection | None:
        """A new object counts once seen acquire_frames times in a row, close together."""
        prev = self._cand
        same = (prev is not None and now - prev[2] <= 0.2
                and math.hypot(det.x - prev[0].x, det.y - prev[0].y) <= max(100.0, 3 * det.radius))
        n = prev[1] + 1 if same else 1
        self._cand = (det, n, now)
        return det if n >= self.cfg.acquire_frames else None

    def step(self, hsv: np.ndarray, now: float) -> Detection | None:
        """Advance one frame; returns the detection to report (None while lost or still unconfirmed)."""
        last = self._last
        # Follow only while the object was seen recently AND strictly confirmed not too long ago, so a relaxed lock
        # cannot sit on skin indefinitely after the ball is gone.
        hint = last[0] if last and now - last[1] <= self.cfg.hold_s and now - last[2] <= self.cfg.track_relaxed_s else None
        det = self.detector.detect(hsv, hint)
        if det is None:
            self._cand = None
        elif self.cfg.acquire_frames > 1 and not self._continues(det, hint):
            det = self._confirm(det, now)
        if det is None:
            self.smoothed = None
            return None
        self._last = (det, now, now if det.strict else (last[2] if last else now))
        a = self.cfg.smooth_alpha
        px, py = self.smoothed or (det.x, det.y)
        self.smoothed = (a * det.x + (1 - a) * px, a * det.y + (1 - a) * py)
        return det
