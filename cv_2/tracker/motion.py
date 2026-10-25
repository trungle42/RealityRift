from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class MotionSample:
    vy: float    # median vertical velocity of the moving pixels, in picture heights per second; NEGATIVE is up
    vx: float    # median horizontal velocity, same units (picture heights per second, so x and y are comparable)
    area: float  # fraction of the picture that is moving (0-1)


class BodyMotion:
    """Whole-picture motion from dense optical flow, as three numbers per frame (see MotionSample).

    A jump is the whole upper body going up and then down, which shows as a large, coherent vertical flow; this is the
    sensor under JumpDetector. No model and no marker: the frame is shrunk to 160x120 grey (about 6 ms per frame) and compared
    with the previous one. The global brightness is removed first, so a change of exposure or a flicker is not read as motion.
    Time is an argument (the flow is per frame, so it is divided by the real gap between frames), so it is testable without
    a clock."""

    def __init__(self, size: tuple[int, int] = (160, 120), move_px: float = 0.8, min_moving: float = 0.01):
        # move_px: flow magnitude (pixels per frame at `size`) above which a pixel counts as moving; idle sensor noise on the
        # dev webcam was a median 0.37, p95 0.55. min_moving: below this fraction of moving pixels there is no motion to report.
        self.size, self.move_px, self.min_moving = size, move_px, min_moving
        self._prev: np.ndarray | None = None
        self._prev_t = 0.0

    @staticmethod
    def _grey(frame: np.ndarray, size: tuple[int, int]) -> np.ndarray:
        g = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), size, interpolation=cv2.INTER_AREA).astype(np.float32)
        return np.clip(g - g.mean() + 128.0, 0, 255).astype(np.uint8)

    def update(self, frame: np.ndarray, now: float) -> MotionSample | None:
        """Motion since the previous call; None on the first frame (nothing to compare with)."""
        g = self._grey(frame, self.size)
        prev, prev_t, self._prev, self._prev_t = self._prev, self._prev_t, g, now
        if prev is None:
            return None
        dt = max(now - prev_t, 1e-3)
        flow = cv2.calcOpticalFlowFarneback(prev, g, None, 0.5, 2, 15, 2, 5, 1.1, 0)
        moving = np.hypot(flow[..., 0], flow[..., 1]) > self.move_px
        area = float(moving.mean())
        if area < self.min_moving:
            return MotionSample(0.0, 0.0, area)
        scale = 1.0 / (self.size[1] * dt)      # pixels per frame at this size -> picture heights per second
        return MotionSample(float(np.median(flow[..., 1][moving])) * scale, float(np.median(flow[..., 0][moving])) * scale, area)

    def reset(self) -> None:
        self._prev = None
