from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default, cast=str):
    raw = os.getenv(name)
    return default if raw is None or raw == "" else cast(raw)


def _bool(s: str) -> bool:
    return s.strip().lower() not in ("0", "false", "no", "off")


@dataclass
class Config:
    camera: int = 0
    width: int = 640
    height: int = 480
    # Yellow in OpenCV HSV (H is 0-179, so pure yellow is ~30). Webcam auto white balance
    # shifts hue a little, so retune the band per camera (demo: press m); raise s_min/v_min if skin or walls leak in.
    h_min: int = 20
    h_max: int = 25
    s_min: int = 90
    v_min: int = 90
    # Smallest blob that counts, as a fraction of the frame area (rejects specks of noise).
    min_area_frac: float = 0.0006
    # Detection alternates on/off with this period; the trace is erased every time it turns off.
    period_s: float = 5.0
    # EMA weight of the newest centroid (1 = no smoothing).
    smooth_alpha: float = 0.6
    # The line is broken (not joined across the gap) when the object is unseen for this long.
    gap_s: float = 0.25
    max_trace_points: int = 2000
    # Output x is mirrored (selfie view); the frame is flipped to match when drawing.
    mirror: bool = True

    @classmethod
    def from_env(cls) -> "Config":
        d = cls()
        return cls(
            camera=_env("YT_CAMERA", d.camera, int),
            width=_env("YT_WIDTH", d.width, int),
            height=_env("YT_HEIGHT", d.height, int),
            h_min=_env("YT_H_MIN", d.h_min, int),
            h_max=_env("YT_H_MAX", d.h_max, int),
            s_min=_env("YT_S_MIN", d.s_min, int),
            v_min=_env("YT_V_MIN", d.v_min, int),
            min_area_frac=_env("YT_MIN_AREA", d.min_area_frac, float),
            period_s=_env("YT_PERIOD", d.period_s, float),
            mirror=_env("YT_MIRROR", d.mirror, _bool),
        )
