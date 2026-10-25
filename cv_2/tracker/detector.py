from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

from .config import ColorSpec

_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
Bands = list[tuple[np.ndarray, np.ndarray]]


@dataclass(frozen=True)
class Detection:
    x: float  # centroid, pixels
    y: float
    radius: float
    area: float
    # True when found with the strict thresholds, False when only the relaxed (following) ones matched.
    strict: bool = True
    # Area of the last strict detection of this object. Following limits are measured against it, not against the
    # previous frame, so a relaxed blob cannot creep outward (ball -> hand -> face) by up to 2x every frame.
    ref_area: float = 0.0


def to_hsv(frame: np.ndarray) -> np.ndarray:
    """Blur then convert once per frame; every colour's detector shares the result."""
    return cv2.cvtColor(cv2.GaussianBlur(frame, (7, 7), 0), cv2.COLOR_BGR2HSV)


def _bands(hue: tuple[tuple[int, int], ...], s_min: int, v_min: int) -> Bands:
    return [(np.array([lo, s_min, v_min], np.uint8), np.array([hi, 255, 255], np.uint8)) for lo, hi in hue]


class ColorDetector:
    """Finds a blob of one colour by HSV thresholding. No learned model: the object is defined
    by colour alone, so it needs no download and costs ~1 ms per colour per frame.

    Hysteresis: an object is *acquired* with the strict thresholds (the largest blob), but once
    it is being tracked (a `hint` from the previous frame) it is *followed* with relaxed ones
    (hue widened by hue_margin, saturation/brightness scaled by relax) and only the blob next
    to the hint counts. Uneven lighting washes a ball out or darkens it across the frame, which
    would otherwise make it flicker on and off at the thresholds; relaxing only near the last
    position keeps it tracked without letting skin or walls elsewhere in."""

    def __init__(self, spec: ColorSpec, min_area_frac: float, hue_margin: int = 4, relax: float = 0.5,
                 max_growth: float = 2.0, min_shrink: float = 0.3):
        self.spec, self.min_area_frac = spec, min_area_frac
        self.max_growth, self.min_shrink = max_growth, min_shrink
        self._strict = _bands(spec.hue, spec.s_min, spec.v_min)
        wide = tuple((max(0, lo - hue_margin), min(179, hi + hue_margin)) for lo, hi in spec.hue)
        self._loose = _bands(wide, int(spec.s_min * relax), int(spec.v_min * relax))

    @staticmethod
    def _mask(hsv: np.ndarray, bands: Bands) -> np.ndarray:
        m = cv2.inRange(hsv, *bands[0])
        for lo, hi in bands[1:]:
            m |= cv2.inRange(hsv, lo, hi)
        # Open removes speckle, close fills holes from highlights on a shiny object.
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, _KERNEL)
        return cv2.morphologyEx(m, cv2.MORPH_CLOSE, _KERNEL)

    def mask(self, hsv: np.ndarray) -> np.ndarray:
        """The strict (acquisition) mask: what the demo's mask view shows."""
        return self._mask(hsv, self._strict)

    def _min_area(self, hsv: np.ndarray) -> float:
        return (self.spec.min_area_frac or self.min_area_frac) * hsv.shape[0] * hsv.shape[1]

    @staticmethod
    def _detection(contour: np.ndarray, strict: bool = True, ref_area: float = 0.0) -> Detection:
        m = cv2.moments(contour)
        (_, _), radius = cv2.minEnclosingCircle(contour)
        area = float(cv2.contourArea(contour))
        return Detection(m["m10"] / m["m00"], m["m01"] / m["m00"], float(radius), area, strict,
                         area if strict else ref_area)

    def _round_enough(self, contour: np.ndarray) -> bool:
        if self.spec.min_circ <= 0:
            return True
        per = cv2.arcLength(contour, True)
        return per > 0 and 4 * math.pi * cv2.contourArea(contour) / per**2 >= self.spec.min_circ

    def _largest(self, hsv: np.ndarray) -> Detection | None:
        """Acquisition: the largest blob that is big enough and, if the colour asks for it, round
        enough. Red needs the roundness test because lips and skin match its colour but are strips."""
        contours, _ = cv2.findContours(self.mask(hsv), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = self._min_area(hsv)
        ok = [c for c in contours if cv2.contourArea(c) >= min_area and self._round_enough(c)]
        return self._detection(max(ok, key=cv2.contourArea)) if ok else None

    def _near(self, hsv: np.ndarray, hint: Detection, bands: Bands, strict: bool) -> Detection | None:
        """The blob of the given mask that contains, or is closest to, the previous position, with an area between
        min_shrink and max_growth times the hint's reference area. Bigger is a mask leaking into skin or a wall
        (lips -> whole face); much smaller is some other small thing beside the object (lips beside a ball)."""
        ref = hint.ref_area or hint.area
        contours, _ = cv2.findContours(self._mask(hsv, bands), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        reach = 2 * hint.radius + 10  # how far the object may have moved since the last frame, px
        best, best_d = None, -reach
        for c in contours:
            area = cv2.contourArea(c)
            if area < self._min_area(hsv) or not self.min_shrink * ref <= area <= self.max_growth * ref:
                continue
            d = cv2.pointPolygonTest(c, (hint.x, hint.y), True)  # >0 inside, <0 outside
            if d > best_d:
                best, best_d = c, d
        return None if best is None else self._detection(best, strict, ref)

    def detect(self, hsv: np.ndarray, hint: Detection | None = None) -> Detection | None:
        """Without a hint: acquire the largest round-enough strict blob. With one: follow the object, preferring its
        own strict-colour blob (so the centre stays on the ball even when skin touches it) and falling back to the
        relaxed mask only when the strict blob is gone (the ball faded). Failing both, try to acquire afresh."""
        if hint is not None:
            found = self._near(hsv, hint, self._strict, True) or self._near(hsv, hint, self._loose, False)
            if found is not None:
                return found
        return self._largest(hsv)
