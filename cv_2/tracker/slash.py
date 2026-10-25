from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class SlashState:
    active: bool          # a slash was detected and "slashed" is still showing
    seconds_left: float   # until it stops showing (0 when not active)
    count: int            # slashes detected since the start


class SlashDetector:
    """Detects the phone being swung down: a big, fast-peaking, mostly vertical drop of its marker.

    Fed one point per frame (normalised x, y with y down, or None when the marker is not seen). It judges the WHOLE stroke:
    over the last window_s seconds the highest point is the start of the swing and the newest point the end. It fires when
      - the swing dropped at least min_drop (frame heights);
      - at some moment it moved at least min_peak_speed (frame heights per second): the stroke is fast at its fastest;
      - on average it was at least min_speed, so a long meander is not a stroke;
      - sideways travel is no more than max_sideways times the drop (x scaled by the frame aspect);
      - at least down_frac of the steps heading down, so wobble, or raising and lowering, does not count.
    Why the whole stroke and a peak speed: on the dev camera a real slash is ~1.3 s from high (y~0.1) to low (y~0.95), 0.7-0.9
    of the frame, with a peak of 6-9 frame-heights/s, while ordinary phone movement drops at most ~0.34 at a peak of ~2.3. A
    0.5 s window with only an average speed saw the middle of a slash, which looks exactly like a quick lowering, and fired on
    normal movement too. Marker smear can leave just the two ends of a fast swing visible (min_points=2, up to gap_s of blur).

    After firing it is "active" for hold_s and ignores further slashes until then. Time is an argument, never read from a clock,
    so it is testable without sleeping."""

    def __init__(self, window_s: float = 1.5, min_drop: float = 0.30, min_speed: float = 0.3, max_sideways: float = 0.6,
                 down_frac: float = 0.8, gap_s: float = 0.25, hold_s: float = 2.0, min_points: int = 2,
                 min_peak_speed: float = 4.5):
        self.window_s, self.min_drop, self.min_speed = window_s, min_drop, min_speed
        self.max_sideways, self.down_frac, self.gap_s, self.hold_s = max_sideways, down_frac, gap_s, hold_s
        self.min_points, self.min_peak_speed = min_points, min_peak_speed
        self._pts: deque[tuple[float, float, float]] = deque()  # (t, x, y)
        self._until = 0.0
        self._count = 0

    def _state(self, now: float) -> SlashState:
        left = max(0.0, self._until - now)
        return SlashState(left > 0.0, left, self._count)

    def update(self, now: float, point: tuple[float, float] | None, aspect: float = 1.0,
               suppress: bool = False) -> SlashState:
        """suppress=True (the whole body is moving: a jump) forgets the motion and cannot fire."""
        if suppress:
            self._pts.clear()
            return self._state(now)
        if point is None:
            # A lost marker is not a slash; if it stays lost the motion so far is forgotten, so reappearing lower down
            # is never read as one long drop.
            if self._pts and now - self._pts[-1][0] > self.gap_s:
                self._pts.clear()
            return self._state(now)
        if self._pts and now - self._pts[-1][0] > self.gap_s:
            self._pts.clear()
        self._pts.append((now, point[0] * aspect, point[1]))
        while self._pts and now - self._pts[0][0] > self.window_s:
            self._pts.popleft()
        if now >= self._until and self._swung_down():
            self._until = now + self.hold_s
            self._count += 1
            self._pts.clear()       # the next slash needs fresh motion
        return self._state(now)

    def _swung_down(self) -> bool:
        pts = list(self._pts)
        if len(pts) < self.min_points:
            return False
        i = min(range(len(pts)), key=lambda k: pts[k][2])   # the highest point in the window
        (t0, x0, y0), (t1, x1, y1) = pts[i], pts[-1]
        drop, dt = y1 - y0, t1 - t0
        if i == len(pts) - 1 or dt <= 0 or drop < self.min_drop or drop / dt < self.min_speed:
            return False
        if abs(x1 - x0) > self.max_sideways * drop:
            return False
        seg = pts[i:]
        steps = [(b[2] - a[2], b[0] - a[0]) for a, b in zip(seg, seg[1:])]
        if sum(dy >= -0.005 for dy, _ in steps) < self.down_frac * len(steps):
            return False
        return max(dy / dt_ for dy, dt_ in steps if dt_ > 0) >= self.min_peak_speed
