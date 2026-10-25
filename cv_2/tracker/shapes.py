from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

SHAPES = ("circle", "triangle", "square", "star")
POINTS = 64     # samples on the resampled loop
HARMONICS = 8   # highest Fourier harmonic compared; above this a hand-drawn line is mostly noise
# Leniency toward the shape the game asked for (classify(prefer=...), game mode only): a closed stroke counts as the requested
# shape when that shape is within this distance of the best match (and within max_dist). Measured on the seeded hand-drawing
# simulator (tests/test_shapes.py hand_drawn, 600 per shape): a requested star goes from 89 % to 96 % recognised at 0.05 (its
# misses read as square or triangle), with no circle or triangle and 0.2 % of squares accepted as a star; 0.08 would let in
# ~5 % of circles and squares. Circle, triangle and square are already recognised 99.5-100 %, and any margin lets circle and
# square swallow each other (60 % at 0.05), so they get none.
PREFER_MARGIN = {"star": 0.05}


@dataclass(frozen=True)
class ShapeResult:
    shape: str | None  # None: a closed loop that resembles none of the presets
    score: float       # distance to the nearest preset (0 = identical); lower is better


def _resample(path: np.ndarray, n: int = POINTS) -> np.ndarray:
    """n points evenly spaced by arc length along the closed loop path[0] -> ... -> path[-1] -> path[0]."""
    closed = np.vstack([path, path[:1]])
    s = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(closed, axis=0).T))])
    t = np.linspace(0.0, s[-1], n, endpoint=False)
    return np.column_stack([np.interp(t, s, closed[:, 0]), np.interp(t, s, closed[:, 1])])


def _descriptor(loop: np.ndarray) -> np.ndarray:
    """Fourier descriptor of a closed loop, invariant to position, size, rotation, start point and drawing direction.

    Write the loop as complex numbers z(t) = x + iy and take its DFT c_k. Moving it only changes c_0, scaling
    multiplies every c_k by one real factor, rotating or starting elsewhere only turns their phases, and
    drawing the other way round swaps k with -k. So the magnitudes |c_k| relative to the biggest one, read in
    the biggest one's winding direction, identify the shape: a circle is only c_1; a regular n-gon adds
    harmonics at 1 - n and 1 + n (triangle -2 and 4, square -3 and 5); a one-stroke pentagram winds twice, so
    its biggest harmonic is c_2. Why this and not corner counting: pen speed and smoothing round the corners
    of a drawn square until it is only ~10% off a circle in radius, but its c_-3 is still there."""
    c = np.fft.fft(loop[:, 0] + 1j * loop[:, 1]) / len(loop)
    c[0] = 0.0
    ks = np.arange(-HARMONICS, HARMONICS + 1)
    mags = np.abs(c[ks % len(loop)])
    top = ks[int(np.argmax(mags))]
    if mags.max() < 1e-12:
        return np.zeros(len(ks))
    return np.abs(c[(np.sign(top) * ks) % len(loop)]) / mags.max()


def _polygon(vertices: list[tuple[float, float]]) -> np.ndarray:
    return _resample(np.array(vertices))


def _ngon(n: int, r: float = 1.0, step: int = 1) -> list[tuple[float, float]]:
    """Vertices of a regular n-gon visited every step-th corner (step 2 on 5 corners is the pentagram)."""
    return [(r * math.cos(math.radians(90 + 360 * i * step / n)), r * math.sin(math.radians(90 + 360 * i * step / n)))
            for i in range(n)]


def _star(inner: float) -> list[tuple[float, float]]:
    """Outline of a five-point star: outer and inner vertices alternating."""
    out = []
    for i in range(10):
        r = 1.0 if i % 2 == 0 else inner
        a = math.radians(90 + 36 * i)
        out.append((r * math.cos(a), r * math.sin(a)))
    return out


def _templates() -> dict[str, list[np.ndarray]]:
    """Ideal drawings per preset. A star is either the outline or the one-stroke pentagram, and the outline's
    notch depth varies a lot between people, hence several."""
    circle = np.array([(math.cos(a), math.sin(a)) for a in np.linspace(0, 2 * math.pi, POINTS, endpoint=False)])
    return {
        "circle": [circle],
        "triangle": [_polygon(_ngon(3))],
        "square": [_polygon(_ngon(4))],
        "star": [_polygon(_ngon(5, step=2)), _polygon(_star(0.382)), _polygon(_star(0.5))],
    }


def outline(shape: str) -> np.ndarray:
    """The preset's ideal outline as (x, y) points in a unit circle with y up, for drawing a guide."""
    return _templates()[shape][-1 if shape == "star" else 0]


class ShapeRecognizer:
    """Names the preset shape a drawn path most resembles.

    A path counts as a drawing once it is big enough and has (nearly) come back to where it started; until then
    classify() returns None, because half a circle looks like a lot of things. A closed loop is compared with
    every preset by Fourier descriptor and rejected as unknown (shape=None) when none is close enough."""

    def __init__(self, closure: float = 0.15, min_size: float = 0.12, min_points: int = 12, max_dist: float = 0.45):
        # closure: largest gap between the first and last point, as a fraction of the path length.
        # min_size: smallest bounding-box diagonal, in frame heights. max_dist: nearest-preset distance beyond which
        # the loop is "unknown".
        self.closure, self.min_size, self.min_points, self.max_dist = closure, min_size, min_points, max_dist
        self._ref = [(name, _descriptor(t)) for name, ts in _templates().items() for t in ts]

    def classify(self, points, aspect: float = 1.0, prefer: str | None = None) -> ShapeResult | None:
        """points: the path in order, as normalised (x, y); aspect = frame width / height, so a circle drawn on a
        4:3 frame is round here instead of 4:3 squashed. prefer: the shape the game asked for, read as that shape when it is
        within PREFER_MARGIN of the best match (see there); None (no request) is the plain nearest preset."""
        p = np.asarray(points, float).reshape(-1, 2) * (aspect, 1.0)
        if len(p) < self.min_points:
            return None
        length = float(np.hypot(*np.diff(p, axis=0).T).sum())
        if np.hypot(*np.ptp(p, axis=0)) < self.min_size or math.hypot(*(p[-1] - p[0])) > self.closure * length:
            return None
        d = _descriptor(_resample(p))
        dist: dict[str, float] = {}
        for n, r in self._ref:
            dist[n] = min(dist.get(n, math.inf), float(np.linalg.norm(d - r)))
        best_name = min(dist, key=dist.__getitem__)
        best = dist[best_name]
        if prefer in dist and dist[prefer] <= min(best + PREFER_MARGIN.get(prefer, 0.0), self.max_dist):
            return ShapeResult(prefer, round(dist[prefer], 3))
        return ShapeResult(best_name if best <= self.max_dist else None, round(best, 3))
