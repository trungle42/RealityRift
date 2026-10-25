from __future__ import annotations

Point = tuple[float, float]


class DetectionGate:
    """Square wave on the clock: on for period_s, off for period_s, repeating from the first
    call. Takes the time as an argument so tests can drive it without sleeping."""

    def __init__(self, period_s: float = 5.0, start_on: bool = True):
        self.period_s, self.start_on = period_s, start_on
        self._t0: float | None = None

    def state(self, now: float) -> tuple[bool, float]:
        """Returns (active, seconds until the next switch)."""
        if self._t0 is None:
            self._t0 = now
        phase, into = divmod(now - self._t0, self.period_s)
        return (phase % 2 == 0) == self.start_on, self.period_s - into


class Trace:
    """The path of the object as polyline segments. A segment ends when the object has been
    unseen for gap_s, so a hand-off across a lost track is not drawn as a straight jump."""

    def __init__(self, gap_s: float = 0.25, max_points: int = 2000):
        self.gap_s, self.max_points = gap_s, max_points
        self.segments: list[list[Point]] = []
        self._last_seen = float("-inf")
        self._count = 0

    def add(self, now: float, point: Point) -> None:
        if not self.segments or now - self._last_seen > self.gap_s:
            self.segments.append([])
        self.segments[-1].append(point)
        self._last_seen = now
        self._count += 1
        if self._count > self.max_points:  # drop the oldest point
            self.segments[0].pop(0)
            self._count -= 1
            if not self.segments[0]:
                self.segments.pop(0)

    def clear(self) -> None:
        self.segments, self._count, self._last_seen = [], 0, float("-inf")

    def __len__(self) -> int:
        return self._count
