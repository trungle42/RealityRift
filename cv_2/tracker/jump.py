from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from .motion import MotionSample


@dataclass(frozen=True)
class JumpState:
    active: bool          # a jump was detected and "jumped" is still showing
    seconds_left: float   # until it stops showing (0 when not active)
    count: int            # jumps detected since the start


class JumpDetector:
    """Detects the user jumping from per-frame whole-picture motion (MotionSample).

    A jump is the body going UP and then DOWN again, as one big coherent motion:
      - an upward run (vy <= -up_speed for at least min_frames frames) rising at least min_height picture heights;
      - then, within max_gap_s, a downward run (vy >= down_speed) that comes back down at least min_ratio of that
        (and not more than max_ratio: a long one-way fall is not the other half of a jump);
      - the whole thing within max_air_s, over at least min_area of the picture moving, and mostly vertical
        (median |vx| <= max_sideways x median |vy|).
    Why up-then-down and not just "fast up": standing up, sitting down, leaning or bending go one way and do not come back,
    and a waving hand does not move enough of the picture. It fires once the downward half has finished (the body has stopped
    moving down: the landing), not while it is still going: only a finished fall can be compared with the rise, and firing
    earlier made max_ratio useless. After firing it is "active" for hold_s and ignores further jumps until then.

    Time is an argument, never read from a clock, so it is testable without sleeping. Thresholds are first guesses to be
    tuned from recordings (they live in Config.jump_*)."""

    def __init__(self, hold_s: float = 2.0, up_speed: float = 0.4, down_speed: float = 0.4, min_frames: int = 3,
                 min_height: float = 0.04, min_area: float = 0.04, max_air_s: float = 1.2, max_gap_s: float = 0.3,
                 min_ratio: float = 0.5, max_ratio: float = 2.0, max_sideways: float = 0.6, window_s: float = 1.6):
        self.hold_s, self.up_speed, self.down_speed, self.min_frames = hold_s, up_speed, down_speed, min_frames
        self.min_height, self.min_area, self.max_air_s, self.max_gap_s = min_height, min_area, max_air_s, max_gap_s
        self.min_ratio, self.max_ratio, self.max_sideways, self.window_s = min_ratio, max_ratio, max_sideways, window_s
        self._buf: deque[tuple[float, float, float, float, float]] = deque()   # (t, dt, vy, vx, area)
        self._until = 0.0
        self._count = 0

    def _state(self, now: float) -> JumpState:
        left = max(0.0, self._until - now)
        return JumpState(left > 0.0, left, self._count)

    def update(self, now: float, sample: MotionSample | None) -> JumpState:
        prev_t = self._buf[-1][0] if self._buf else now
        dt = min(max(now - prev_t, 0.0), 0.2)       # a stall of the camera is not a long motion
        s = sample or MotionSample(0.0, 0.0, 0.0)
        self._buf.append((now, dt, s.vy, s.vx, s.area))
        while self._buf and now - self._buf[0][0] > self.window_s:
            self._buf.popleft()
        if now >= self._until and self._jumped():
            self._until = now + self.hold_s
            self._count += 1
            self._buf.clear()
        return self._state(now)

    def _runs(self) -> list[dict]:
        """Maximal runs of frames moving up (-1) or down (+1) at least half the threshold speed, with some of the picture moving.
        Neighbouring runs in the same direction with one frame between them are joined (a single noisy frame must not split a
        rise). A run has ended once two frames have passed since its last one."""
        runs: list[dict] = []
        for i, (t, dt, vy, vx, area) in enumerate(self._buf):
            d = 0
            if area >= self.min_area / 2:
                if vy <= -self.up_speed / 2:
                    d = -1
                elif vy >= self.down_speed / 2:
                    d = 1
            if d == 0:
                continue
            if runs and runs[-1]["dir"] == d and i - runs[-1]["i1"] <= 2:
                runs[-1]["i1"] = i
            else:
                runs.append({"dir": d, "i0": i, "i1": i})
        return runs

    def _stats(self, run: dict, thr: float) -> tuple[int, float, float, float, float, float]:
        """(frames at full speed, displacement in picture heights, median |vy|, median |vx|, median area, end time)."""
        frames = list(self._buf)[run["i0"]:run["i1"] + 1]
        strong = sum(abs(f[2]) >= thr for f in frames)
        disp = sum(abs(f[2]) * f[1] for f in frames)
        med = lambda xs: sorted(xs)[len(xs) // 2]
        return strong, disp, med([abs(f[2]) for f in frames]), med([abs(f[3]) for f in frames]), med([f[4] for f in frames]), frames[-1][0]

    def _jumped(self) -> bool:
        runs = self._runs()
        for a, b in zip(runs, runs[1:]):
            if a["dir"] != -1 or b["dir"] != 1:
                continue
            ua, ub = self._stats(a, self.up_speed), self._stats(b, self.down_speed)
            t_up0, t_up1 = self._buf[a["i0"]][0], ua[5]
            t_dn0, t_end = self._buf[b["i0"]][0], ub[5]
            if t_dn0 - t_up1 > self.max_gap_s or t_end - t_up0 > self.max_air_s:
                continue
            if len(self._buf) - 1 - b["i1"] < 2:          # the downward run may still be going: wait for it to finish
                continue
            if ua[0] < self.min_frames or ub[0] < self.min_frames or ua[1] < self.min_height:
                continue
            if not self.min_ratio * ua[1] <= ub[1] <= self.max_ratio * ua[1]:
                continue
            if min(ua[4], ub[4]) < self.min_area:
                continue
            if max(ua[3], ub[3]) > self.max_sideways * min(ua[2], ub[2]):
                continue
            return True
        return False
