from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default, cast=str):
    raw = os.getenv(name)
    return default if raw is None or raw == "" else cast(raw)


def _bool(s: str) -> bool:
    return s.strip().lower() not in ("0", "false", "no", "off")


def _hue(s: str) -> tuple[tuple[int, int], ...]:
    """'20-25' or, for a band that wraps around 0 like red, '0-6,174-179'."""
    return tuple((int(a), int(b)) for a, b in (r.split("-") for r in s.split(",")))


@dataclass(frozen=True)
class ColorSpec:
    name: str
    # OpenCV hue is 0-179. Red needs two ranges because hue wraps around 0.
    hue: tuple[tuple[int, int], ...]
    s_min: int
    v_min: int
    # BGR colour used to draw this colour's trail and marker.
    bgr: tuple[int, int, int]
    # Roundness (4*pi*area/perimeter^2: 1 = circle, a lip-shaped strip ~0.5) a blob needs to be *found*;
    # 0 disables. Only applied when acquiring, so a ball that is partly covered is still followed.
    min_circ: float = 0.0
    # Smallest blob for this colour as a fraction of the frame; 0 = use Config.min_area_frac. Red sets its own because
    # lips measure ~200-400 px (0.0007-0.0013) against a ball of thousands.
    min_area_frac: float = 0.0


def default_colors() -> dict[str, ColorSpec]:
    # Webcam auto white balance shifts hue, so retune per camera (demo: press m). Raise s_min/v_min
    # if skin or walls leak in; red is the touchiest because skin sits just above it in hue.
    return {c.name: c for c in (
        ColorSpec("yellow", ((20, 25),), 90, 90, (0, 215, 255)),
        ColorSpec("blue", ((103, 115),), 62, 88, (255, 120, 30)),
        ColorSpec("red", ((174, 179), (0, 6)), 117, 97, (60, 60, 235), 0.62, 0.002),
    )}

@dataclass
class Config:
    camera: int = 0
    width: int = 640
    height: int = 480
    colors: dict[str, ColorSpec] = field(default_factory=default_colors)
    # Smallest blob that counts, as a fraction of the frame area (rejects specks of noise).
    min_area_frac: float = 0.0006
    # Detection alternates on/off with this period; every trace is erased each time it turns off.
    period_s: float = 5.0
    # Hysteresis: once an object is found it is followed with relaxed thresholds (hue band widened by
    # track_hue_margin, saturation/brightness floors scaled by track_relax) and a lost object is searched
    # for near its last position for hold_s. relax=1 and margin=0 turn this off.
    track_hue_margin: int = 4
    track_relax: float = 0.5
    # A followed blob must be between track_min_shrink and track_max_growth times the area of the last
    # detection. Bigger is the relaxed mask flooding into skin or a wall; much smaller is a different, small
    # thing (lips) near the object. Either is rejected and strict acquisition runs instead.
    track_max_growth: float = 2.0
    track_min_shrink: float = 0.3
    # A *new* object (not a continuation of the one being followed) must be found in this many consecutive
    # frames before it is reported, so a single-frame blip of skin or clothing cannot start a trace. 1 = off.
    acquire_frames: int = 3
    hold_s: float = 0.5
    # EMA weight of the newest centroid (1 = no smoothing).
    smooth_alpha: float = 0.6
    # A line is broken (not joined across the gap) when its object is unseen for this long.
    gap_s: float = 0.25
    max_trace_points: int = 2000
    # Output x is mirrored (selfie view); the frame is flipped to match when drawing.
    mirror: bool = True

    @classmethod
    def from_env(cls) -> "Config":
        """YT_COLORS=yellow,red picks which colours run. Per colour: YT_<NAME>_HUE ('20-25' or
        '0-6,174-179'), YT_<NAME>_S_MIN, YT_<NAME>_V_MIN, YT_<NAME>_MIN_CIRC,
        YT_<NAME>_MIN_AREA (this colour's own minimum blob size)."""
        d = cls()
        names = [n.strip().lower() for n in _env("YT_COLORS", ",".join(d.colors)).split(",") if n.strip()]
        unknown = [n for n in names if n not in d.colors]
        if unknown:
            raise ValueError(f"YT_COLORS has unknown colour(s) {unknown}; choose from {list(d.colors)}")
        colors = {}
        for n in names:
            s, p = d.colors[n], f"YT_{n.upper()}_"
            colors[n] = ColorSpec(
                n, _env(p + "HUE", s.hue, _hue), _env(p + "S_MIN", s.s_min, int),
                _env(p + "V_MIN", s.v_min, int), s.bgr, _env(p + "MIN_CIRC", s.min_circ, float),
                _env(p + "MIN_AREA", s.min_area_frac, float),
            )
        return cls(
            camera=_env("YT_CAMERA", d.camera, int),
            width=_env("YT_WIDTH", d.width, int),
            height=_env("YT_HEIGHT", d.height, int),
            colors=colors,
            min_area_frac=_env("YT_MIN_AREA", d.min_area_frac, float),
            period_s=_env("YT_PERIOD", d.period_s, float),
            mirror=_env("YT_MIRROR", d.mirror, _bool),
        )
