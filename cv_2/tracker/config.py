from __future__ import annotations

import os
from dataclasses import dataclass, field

from .shapes import SHAPES


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
        ColorSpec("red", ((174, 179), (0, 6)), 117, 97, (60, 60, 235), 0.58, 0.002),
    )}

def default_phone() -> ColorSpec:
    """The marker on the phone: bright yellow-green (lime) tape. Not in Config.colors: it is not a wand, so it gets no trace or
    shape. No roundness test (a strip is not round). Calibrated on the dev webcam: hue ~37 (p5-p95 35-38; the probe floor was 35,
    so the true range reaches a little lower), S 100-145, V 122-157, a 160x80 px bar. Hue 31-43 stays clear of the yellow wand
    (20-25, followed to 29) and of the dull hue-30 patches in the room (S~50, V~40, excluded by S>=70 and V>=80). An earlier,
    pale green strip (hue 54-65, S~56) was smeared by motion blur to S 19-37 in a real swing and could not be tracked.
    min_area_frac 0.002 (~614 px) ignores specks."""
    return ColorSpec("phone", ((31, 43),), 70, 80, (60, 200, 60), 0.0, 0.002)


@dataclass
class Config:
    camera: int = 0
    width: int = 640
    height: int = 480
    colors: dict[str, ColorSpec] = field(default_factory=default_colors)
    # The phone marker tracked separately for the slash gesture; None turns the whole feature off.
    phone: ColorSpec | None = field(default_factory=default_phone)
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
    # Longest a relaxed-only lock may last without a strict sighting of the object (see ColorDetector.detect).
    track_relaxed_s: float = 1.5
    # EMA weight of the newest centroid (1 = no smoothing).
    smooth_alpha: float = 0.6
    # A line is broken (not joined across the gap) when its object is unseen for this long.
    gap_s: float = 0.25
    max_trace_points: int = 2000
    # Output x is mirrored (selfie view); the frame is flipped to match when drawing.
    mirror: bool = True
    # Jump: whole-picture motion (optical flow) going up and then down. See JumpDetector. jump=False turns it off.
    # Thresholds are in picture heights per second / of the picture. First guesses until tuned from recordings.
    # Measured on the dev camera (5 jumps vs 30 s of ordinary movement): a jump moves 0.41-0.52 of the picture at a median 0.8-1.2
    # picture-heights/s; the lookalikes (leaning, gesturing) 0.12-0.20 at 0.39-0.52. Any area 0.20-0.40 separated them.
    jump: bool = True
    jump_hold_s: float = 2.0
    jump_up_speed: float = 0.6
    jump_down_speed: float = 0.6
    jump_min_frames: int = 3
    jump_min_height: float = 0.04
    jump_min_area: float = 0.30
    jump_max_air_s: float = 1.2
    jump_max_gap_s: float = 0.3
    jump_min_ratio: float = 0.5
    jump_max_ratio: float = 2.0
    jump_max_sideways: float = 0.6
    # A jump drops the phone with the body and looked like a slash (live: it fired mid-jump). While the whole picture is moving
    # this much (a jump measured 0.41-0.52) and for slash_suppress_hold_s after, slashes are ignored.
    slash_suppress_area: float = 0.35
    slash_suppress_hold_s: float = 0.3
    # The presets the user is asked to draw, in order: the target advances each time detection turns on.
    # shape_closure / shape_min_size / shape_max_dist: see ShapeRecognizer.
    shapes: tuple[str, ...] = SHAPES
    shape_closure: float = 0.15
    shape_min_size: float = 0.12
    shape_max_dist: float = 0.5
    # Game mode (Pipeline.control, driven by the game through tools/publish.py): the wand stays on while the game says so,
    # instead of on the 5 s timer. A stroke starts where the wand was last held still (within wand_still_dist frame heights
    # for wand_pause_s), so a shape can be drawn at any moment without a stray lead-in, and is named when it comes back to
    # that point. A completed shape stays "complete" for wand_rearm_s (long enough for the game to see it), then that colour's
    # trace is erased and it can draw the next one. wand_trace_points caps a stroke (about 5 s at 30 fps).
    wand_pause_s: float = 0.4
    wand_still_dist: float = 0.025
    wand_rearm_s: float = 0.8
    wand_trace_points: int = 150
    # Slash: the phone marker moving DOWN, judged over the whole stroke (see SlashDetector). It must drop slash_min_drop
    # (fraction of frame height) within slash_window_s, peak at >= slash_min_peak_speed (frame heights per second) and average
    # >= slash_min_speed, stay mostly vertical (sideways travel <= slash_max_sideways x the drop) and mostly downward
    # (>= slash_down_frac of steps). Then "slashed" shows for slash_hold_s and further slashes are ignored until it ends.
    # A tracking gap over slash_gap_s forgets the motion so far. Measured on the dev camera: real slashes dropped 0.69-0.89
    # with a peak of 5.9-9.1; ordinary movement dropped at most 0.34 with a peak of 2.3. The peak speed is what separates them; the
    # drop floor is low (0.30) so that a swing seen only in part (the marker is lost in blur mid-swing) still counts.
    slash_window_s: float = 1.5
    slash_min_drop: float = 0.30
    slash_min_speed: float = 0.3
    slash_min_peak_speed: float = 4.5
    slash_max_sideways: float = 0.6
    slash_down_frac: float = 0.8
    slash_gap_s: float = 0.25
    slash_hold_s: float = 2.0
    # Sightings needed in the window. A real swing is ~3 frames and blurred in the middle, so often only its two ends are seen.
    slash_min_points: int = 2

    @classmethod
    def from_env(cls) -> "Config":
        """YT_COLORS=yellow,red picks which colours run. Per colour: YT_<NAME>_HUE ('20-25' or
        '0-6,174-179'), YT_<NAME>_S_MIN, YT_<NAME>_V_MIN, YT_<NAME>_MIN_CIRC,
        YT_<NAME>_MIN_AREA (this colour's own minimum blob size). The phone marker takes YT_PHONE_HUE / _S_MIN / _V_MIN /
        _MIN_AREA the same way, and YT_PHONE=0 disables slash detection and YT_JUMP=0 disables jump detection."""
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
        phone = None
        if _env("YT_PHONE", True, _bool):
            s = d.phone
            phone = ColorSpec("phone", _env("YT_PHONE_HUE", s.hue, _hue), _env("YT_PHONE_S_MIN", s.s_min, int),
                              _env("YT_PHONE_V_MIN", s.v_min, int), s.bgr, 0.0, _env("YT_PHONE_MIN_AREA", s.min_area_frac, float))
        return cls(
            camera=_env("YT_CAMERA", d.camera, int),
            width=_env("YT_WIDTH", d.width, int),
            height=_env("YT_HEIGHT", d.height, int),
            colors=colors,
            phone=phone,
            jump=_env("YT_JUMP", d.jump, _bool),
            min_area_frac=_env("YT_MIN_AREA", d.min_area_frac, float),
            period_s=_env("YT_PERIOD", d.period_s, float),
            mirror=_env("YT_MIRROR", d.mirror, _bool),
        )
