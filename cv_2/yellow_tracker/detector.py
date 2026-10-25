from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import Config

_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))


@dataclass(frozen=True)
class Detection:
    x: float  # centroid, pixels
    y: float
    radius: float
    area: float


class YellowDetector:
    """Finds the largest yellow blob by HSV thresholding. No learned model: the object is
    defined by colour alone, so it needs no download and costs ~1 ms per frame."""

    def __init__(self, cfg: Config):
        self.lo = np.array([cfg.h_min, cfg.s_min, cfg.v_min], np.uint8)
        self.hi = np.array([cfg.h_max, 255, 255], np.uint8)
        self.min_area_frac = cfg.min_area_frac

    def mask(self, frame: np.ndarray) -> np.ndarray:
        hsv = cv2.cvtColor(cv2.GaussianBlur(frame, (7, 7), 0), cv2.COLOR_BGR2HSV)
        m = cv2.inRange(hsv, self.lo, self.hi)
        # Open removes speckle, close fills holes from highlights on a shiny object.
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, _KERNEL)
        return cv2.morphologyEx(m, cv2.MORPH_CLOSE, _KERNEL)

    def detect(self, frame: np.ndarray) -> Detection | None:
        contours, _ = cv2.findContours(self.mask(frame), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        best = max(contours, key=cv2.contourArea)
        area = cv2.contourArea(best)
        if area < self.min_area_frac * frame.shape[0] * frame.shape[1]:
            return None
        m = cv2.moments(best)
        (_, _), radius = cv2.minEnclosingCircle(best)
        return Detection(m["m10"] / m["m00"], m["m01"] / m["m00"], float(radius), float(area))
