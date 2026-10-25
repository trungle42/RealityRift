import json

import cv2
import numpy as np
import pytest

from tracker.calibrate import env_lines, suggest
from tracker.config import ColorSpec, Config
from tracker.detector import ColorDetector, to_hsv
from tracker.overlay import draw, mask_view
from tracker.pipeline import Pipeline
from tracker.trace import DetectionGate, Trace

W, H = 640, 480
NAMES = ("yellow", "blue", "red")


def hsv_bgr(h: int, s: int = 255, v: int = 255) -> tuple[int, int, int]:
    px = cv2.cvtColor(np.uint8([[[h, s, v]]]), cv2.COLOR_HSV2BGR)[0, 0]
    return tuple(int(c) for c in px)


def swatch(name: str) -> tuple[int, int, int]:
    """Fully saturated colour from the middle of the colour's first default hue range, so the
    tests keep meaning "yellow/blue/red" when the bands are retuned for a particular camera."""
    lo, hi = Config().colors[name].hue[0]
    return hsv_bgr((lo + hi) // 2)


def scene(balls: dict[str, tuple[int, int]] | None = None, distractors: bool = False) -> np.ndarray:
    """Grey room with a ball on a dark-grey stick per entry, e.g. {"yellow": (320, 200)}."""
    f = np.full((H, W, 3), 110, np.uint8)
    if distractors:
        cv2.circle(f, (100, 100), 40, (130, 160, 220), -1)   # skin tone
        cv2.circle(f, (540, 100), 40, hsv_bgr(60), -1)       # green
        cv2.circle(f, (540, 400), 40, hsv_bgr(90), -1)       # cyan
        cv2.circle(f, (320, 420), 40, hsv_bgr(150), -1)      # magenta
    for name, (x, y) in (balls or {}).items():
        cv2.line(f, (x, y), (x, min(H - 1, y + 150)), (50, 50, 50), 10)
        cv2.circle(f, (x, y), 25, swatch(name), -1)
    return f


def cfg(**kw) -> Config:
    """Pipeline tests report an object on its first frame, so confirmation is off unless a test asks for it."""
    kw.setdefault("acquire_frames", 1)
    return Config(mirror=False, smooth_alpha=1.0, **kw)


def detector(name: str) -> ColorDetector:
    return ColorDetector(Config().colors[name], Config().min_area_frac)


# --- detector ---------------------------------------------------------------

@pytest.mark.parametrize("name", NAMES)
def test_finds_ball_not_the_stick(name):
    d = detector(name).detect(to_hsv(scene({name: (320, 200)})))
    assert d is not None
    assert abs(d.x - 320) < 3 and abs(d.y - 200) < 3
    assert 20 < d.radius < 32


@pytest.mark.parametrize("name", NAMES)
def test_no_object_no_detection(name):
    assert detector(name).detect(to_hsv(scene())) is None


@pytest.mark.parametrize("name", NAMES)
def test_ignores_skin_green_cyan_and_magenta(name):
    assert detector(name).detect(to_hsv(scene(distractors=True))) is None


@pytest.mark.parametrize("name", NAMES)
def test_picks_its_colour_among_distractors(name):
    d = detector(name).detect(to_hsv(scene({name: (400, 300)}, distractors=True)))
    assert d is not None and abs(d.x - 400) < 3 and abs(d.y - 300) < 3


@pytest.mark.parametrize("name", NAMES)
def test_does_not_detect_the_other_colours(name):
    others = {n: (100 + 150 * i, 200) for i, n in enumerate(NAMES) if n != name}
    assert detector(name).detect(to_hsv(scene(others))) is None


@pytest.mark.parametrize("name", NAMES)
def test_specks_below_min_area_are_ignored(name):
    f = scene()
    cv2.circle(f, (300, 300), 3, swatch(name), -1)
    assert detector(name).detect(to_hsv(f)) is None


@pytest.mark.parametrize("band", range(len(Config().colors["red"].hue)))
def test_red_is_found_in_each_of_its_hue_ranges(band):
    """Red wraps around hue 0, so it has two ranges; a ball in the middle of either must be found."""
    lo, hi = Config().colors["red"].hue[band]
    f = scene()
    cv2.circle(f, (300, 240), 25, hsv_bgr((lo + hi) // 2), -1)
    assert detector("red").detect(to_hsv(f)) is not None


# --- gate -------------------------------------------------------------------

def test_gate_alternates_every_period():
    g = DetectionGate(5.0)
    states = [g.state(t)[0] for t in (100.0, 102.0, 104.9, 105.0, 109.9, 110.0, 115.0)]
    assert states == [True, True, True, False, False, True, False]


def test_gate_reports_time_to_next_switch():
    g = DetectionGate(5.0)
    g.state(10.0)
    assert g.state(12.0)[1] == 3.0


# --- trace ------------------------------------------------------------------

def test_trace_splits_segments_on_gap():
    t = Trace(gap_s=0.25)
    t.add(0.0, (0.1, 0.1))
    t.add(0.1, (0.2, 0.2))
    t.add(1.0, (0.8, 0.8))
    assert [len(s) for s in t.segments] == [2, 1]


def test_trace_is_capped_and_clearable():
    t = Trace(gap_s=1.0, max_points=10)
    for i in range(25):
        t.add(i * 0.01, (i / 100, 0.5))
    assert len(t) == 10
    t.clear()
    assert len(t) == 0 and t.segments == []


# --- pipeline ---------------------------------------------------------------

def three(i: int) -> dict[str, tuple[int, int]]:
    """Three balls moving right at different heights."""
    return {"yellow": (80 + i * 40, 100), "blue": (80 + i * 40, 240), "red": (80 + i * 40, 380)}


def npoints(out: dict, name: str) -> int:
    return sum(len(s) for s in out["traces"][name])


def test_each_colour_gets_its_own_trace():
    p = Pipeline(cfg())
    for i in range(10):
        out = p.process(scene(three(i)), now=i * 0.1)
    for name, y in (("yellow", 100), ("blue", 240), ("red", 380)):
        (seg,) = out["traces"][name]
        xs = [x for x, _ in seg]
        assert len(seg) == 10 and xs == sorted(xs)
        assert abs(xs[0] - 80 / W) < 0.01 and abs(xs[-1] - 440 / W) < 0.01
        assert all(abs(py - y / H) < 0.01 for _, py in seg), f"{name} trace picked up another colour"
        assert out["objects"][name] is not None


def test_colours_are_tracked_independently():
    p = Pipeline(cfg())
    p.process(scene({"yellow": (100, 100), "blue": (300, 200)}), now=0.0)
    out = p.process(scene({"blue": (320, 210), "red": (500, 300)}), now=0.1)
    assert out["objects"]["yellow"] is None and out["objects"]["blue"] and out["objects"]["red"]
    assert npoints(out, "yellow") == 1 and npoints(out, "blue") == 2 and npoints(out, "red") == 1


def test_every_trace_erased_each_time_detection_turns_off():
    p = Pipeline(cfg(period_s=5.0))
    for cycle in range(3):
        base = cycle * 10.0
        for i in range(10):  # on phase
            out = p.process(scene(three(i)), now=base + i * 0.4)
        assert out["active"] and all(npoints(out, n) for n in NAMES), f"cycle {cycle}: traces should exist while on"
        out = p.process(scene(three(5)), now=base + 5.0)  # first off frame
        assert not out["active"] and all(out["traces"][n] == [] for n in NAMES)
        out = p.process(scene(three(5)), now=base + 9.0)  # still off
        assert not out["active"] and all(out["traces"][n] == [] and out["objects"][n] is None for n in NAMES)


def test_new_traces_start_fresh_after_turning_back_on():
    p = Pipeline(cfg(period_s=5.0))
    for i in range(10):
        p.process(scene(three(i)), now=i * 0.4)
    p.process(scene(three(5)), now=5.5)  # off
    out = p.process(scene(three(9)), now=10.0)  # on again
    assert out["active"] and all(npoints(out, n) == 1 for n in NAMES)


def test_detectors_not_run_while_off():
    calls = []

    class Spy(ColorDetector):
        def detect(self, hsv, hint=None):
            calls.append(self.spec.name)
            return super().detect(hsv, hint)

    c = cfg(period_s=5.0)
    p = Pipeline(c, {n: Spy(s, c.min_area_frac, c.track_hue_margin, c.track_relax, c.track_max_growth, c.track_min_shrink) for n, s in c.colors.items()})
    p.process(scene(three(0)), now=0.0)
    p.process(scene(three(0)), now=6.0)
    p.process(scene(three(0)), now=7.0)
    assert sorted(calls) == sorted(NAMES)


def test_lost_object_breaks_line_instead_of_joining_it():
    p = Pipeline(cfg())
    p.process(scene({"blue": (100, 200)}), now=0.0)
    p.process(scene({"blue": (110, 200)}), now=0.1)
    p.process(scene(), now=0.5)
    out = p.process(scene({"blue": (500, 200)}), now=0.9)
    assert [len(s) for s in out["traces"]["blue"]] == [2, 1]


def test_mirror_flips_x_and_payload_is_json():
    p = Pipeline(Config(mirror=True, smooth_alpha=1.0, acquire_frames=1))
    out = p.process(scene({"red": (160, 240)}), now=0.0)
    assert out["mirrored"] and abs(out["objects"]["red"]["x"] - 0.75) < 0.01
    json.dumps(out)


def test_smoothing_lags_a_jump():
    p = Pipeline(Config(mirror=False, smooth_alpha=0.5, acquire_frames=1))
    p.process(scene({"yellow": (100, 240)}), now=0.0)
    out = p.process(scene({"yellow": (300, 240)}), now=0.05)
    assert abs(out["traces"]["yellow"][0][-1][0] - 200 / W) < 0.01


# --- config -----------------------------------------------------------------

def test_defaults_have_three_colours_and_red_wraps():
    c = Config()
    assert tuple(c.colors) == NAMES and len(c.colors["red"].hue) == 2


def test_env_picks_colours_and_overrides_bands(monkeypatch):
    monkeypatch.setenv("YT_COLORS", "Red, blue")
    monkeypatch.setenv("YT_RED_HUE", "0-3,177-179")
    monkeypatch.setenv("YT_BLUE_S_MIN", "150")
    c = Config.from_env()
    assert tuple(c.colors) == ("red", "blue")
    assert c.colors["red"].hue == ((0, 3), (177, 179)) and c.colors["blue"].s_min == 150
    assert c.colors["red"].s_min == Config().colors["red"].s_min


def test_env_rejects_unknown_colour(monkeypatch):
    monkeypatch.setenv("YT_COLORS", "yellow,purple")
    with pytest.raises(ValueError, match="purple"):
        Config.from_env()


def test_subset_pipeline_only_tracks_chosen_colours():
    c = Config(mirror=False, smooth_alpha=1.0, acquire_frames=1, colors={"blue": Config().colors["blue"]})
    out = Pipeline(c).process(scene(three(0)), now=0.0)
    assert list(out["objects"]) == ["blue"] and list(out["traces"]) == ["blue"]


# --- overlay ----------------------------------------------------------------

def test_overlay_draws_without_error_in_both_states():
    c = cfg(period_s=5.0)
    p = Pipeline(c)
    for t in (0.0, 0.1, 0.2, 6.0):
        frame = scene(three(1))
        out = draw(frame, p.process(frame, now=t), 5.0, c.colors)
        assert out.shape == frame.shape


def test_mask_view_paints_each_colour_in_its_own_colour():
    c = cfg()
    frame = scene({"yellow": (100, 240), "blue": (300, 240), "red": (500, 240)})
    view = mask_view(frame, Pipeline(c).detectors, mirror=False)
    for name, x in (("yellow", 100), ("blue", 300), ("red", 500)):
        assert tuple(view[240, x]) == c.colors[name].bgr
    assert tuple(view[10, 10]) == (0, 0, 0)


# --- hysteresis: following with relaxed thresholds ---------------------------

def faded(name: str, sat: int, val: int = 255, x: int = 320, y: int = 240) -> np.ndarray:
    """A ball of `name` washed out to the given saturation/brightness (bright or dim side of the room)."""
    lo, hi = Config().colors[name].hue[0]
    f = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(f, (x, y), 25, hsv_bgr((lo + hi) // 2, sat, val), -1)
    return f


def dull_sat(name: str) -> int:
    """A saturation between the relaxed (followed) and strict (acquired) floors."""
    s_min = Config().colors[name].s_min
    return (s_min + int(s_min * Config().track_relax)) // 2


@pytest.mark.parametrize("name", NAMES)
def test_washed_out_ball_is_not_acquired_but_is_followed(name):
    """Saturation fades 255 -> 70 as the ball moves toward the bright side: a fresh detector loses it
    at the strict floor, but the pipeline keeps following it down to the relaxed floor."""
    spec = Config().colors[name]
    dull = dull_sat(name)
    assert detector(name).detect(to_hsv(faded(name, dull))) is None
    p = Pipeline(cfg())
    sats = [255, 220, 180, spec.s_min + 10, dull, int(spec.s_min * Config().track_relax) + 4]
    outs = [p.process(faded(name, s, x=200 + 40 * i), now=i * 0.05) for i, s in enumerate(sats)]
    assert all(o["objects"][name] is not None for o in outs), [o["objects"][name] is not None for o in outs]
    assert [len(s) for s in outs[-1]["traces"][name]] == [len(sats)]  # one unbroken line


@pytest.mark.parametrize("name", NAMES)
def test_flicker_around_the_strict_threshold_does_not_flicker_the_output(name):
    spec = Config().colors[name]
    p = Pipeline(cfg())
    sats = [255] + [spec.s_min + d for d in (12, -12, 15, -15, 10, -10, 12, -12)]
    outs = [p.process(faded(name, s), now=i * 0.05) for i, s in enumerate(sats)]
    assert all(o["objects"][name] is not None for o in outs)


@pytest.mark.parametrize("name", NAMES)
def test_relaxed_thresholds_are_not_used_to_acquire(name):
    """A dim blob that was never seen at full strength (think skin, a wall) must not be picked up."""
    p = Pipeline(cfg())
    for i in range(5):
        out = p.process(faded(name, dull_sat(name)), now=i * 0.05)
        assert out["objects"][name] is None


def test_following_stays_on_the_ball_not_a_dim_blob_elsewhere():
    p = Pipeline(cfg())
    p.process(faded("blue", 255, x=150), now=0.0)
    f = faded("blue", 200, x=160)
    cv2.circle(f, (500, 240), 40, hsv_bgr(112, 70, 200), -1)  # big dim blue-ish blob, relaxed-only
    out = p.process(f, now=0.05)
    assert out["objects"]["blue"] is not None and out["objects"]["blue"]["x"] < 0.4


def test_hint_expires_after_hold_s():
    c = cfg(hold_s=0.5)
    p = Pipeline(c)
    dull = dull_sat("blue")
    p.process(faded("blue", 255), now=0.0)
    assert p.process(faded("blue", dull), now=0.3)["objects"]["blue"] is not None  # within hold_s: followed
    assert p.process(faded("blue", dull), now=0.7)["objects"]["blue"] is not None  # refreshed at 0.3, still held
    p.process(scene(), now=1.5)  # nothing for > hold_s
    assert p.process(faded("blue", dull), now=1.6)["objects"]["blue"] is None  # hint gone: strict again


def test_disabling_hysteresis_restores_strict_behaviour():
    c = cfg(track_hue_margin=0, track_relax=1.0)
    p = Pipeline(c)
    p.process(faded("blue", 255), now=0.0)
    assert p.process(faded("blue", dull_sat("blue")), now=0.05)["objects"]["blue"] is None


# --- calibration helper -------------------------------------------------------

def test_suggest_covers_all_samples_with_slack():
    sug = suggest([(112, 200, 220), (108, 150, 90), (118, 170, 160)])
    assert sug["hue"] == ((103, 123),) and sug["s_min"] == 135 and sug["v_min"] == 75


def test_suggest_handles_red_across_the_hue_wrap():
    sug = suggest([(177, 200, 200), (3, 180, 150), (178, 160, 120)])
    assert sug["hue"] == ((172, 179), (0, 8))


def test_suggest_single_range_and_floor_clamp():
    sug = suggest([(22, 10, 5)], hue_pad=3, floor_pad=15)
    assert sug["hue"] == ((19, 25),) and sug["s_min"] == 0 and sug["v_min"] == 0


def test_suggest_needs_samples():
    with pytest.raises(ValueError):
        suggest([])


def test_env_lines_are_powershell_assignments():
    sug = suggest([(177, 200, 200), (3, 180, 150)])
    assert env_lines("red", sug) == ['$env:YT_RED_HUE="172-179,0-8"', '$env:YT_RED_S_MIN="165"', '$env:YT_RED_V_MIN="135"']


# --- roundness filter (red vs lips) ---------------------------------------------

def lip(f: np.ndarray, name: str = "red", x: int = 200, y: int = 300) -> None:
    """A lip-shaped strip, 4:1 (real lips measured circularity 0.42-0.57), in the given colour."""
    cv2.ellipse(f, (x, y), (40, 10), 0, 0, 360, swatch(name), -1)


def test_red_rejects_a_lip_shaped_strip():
    f = scene()
    lip(f)
    assert detector("red").detect(to_hsv(f)) is None


def test_red_prefers_the_round_ball_even_when_a_strip_is_bigger():
    f = scene({"red": (450, 200)})
    cv2.ellipse(f, (200, 350), (80, 22), 0, 0, 360, swatch("red"), -1)  # bigger than the ball, but a strip
    d = detector("red").detect(to_hsv(f))
    assert d is not None and abs(d.x - 450) < 3 and abs(d.y - 200) < 3


@pytest.mark.parametrize("name", ["yellow", "blue"])
def test_roundness_filter_is_off_for_other_colours(name):
    f = scene()
    lip(f, name)
    assert detector(name).detect(to_hsv(f)) is not None


def test_a_round_ball_passes_the_roundness_filter():
    for r in (20, 25, 60):
        f = scene()
        cv2.circle(f, (320, 240), r, swatch("red"), -1)
        assert detector("red").detect(to_hsv(f)) is not None, f"radius {r}"


def test_a_partly_covered_ball_is_still_followed():
    """Once tracked, the shape test no longer applies (a hand over part of the ball must not drop it)."""
    p = Pipeline(cfg())
    p.process(scene({"red": (300, 200)}), now=0.0)
    f = scene({"red": (305, 200)})
    cv2.rectangle(f, (270, 150), (340, 196), (110, 110, 110), -1)  # hides the top ~45%: leaves a round-ish cap
    assert p.process(f, now=0.05)["objects"]["red"] is not None


def test_a_thin_sliver_is_not_acquired_from_scratch():
    f = scene({"red": (305, 200)})
    cv2.rectangle(f, (270, 150), (340, 214), (110, 110, 110), -1)  # all but a thin sliver hidden
    assert Pipeline(cfg()).process(f, now=0.0)["objects"]["red"] is None


def test_env_overrides_min_circ(monkeypatch):
    monkeypatch.setenv("YT_RED_MIN_CIRC", "0.8")
    assert Config.from_env().colors["red"].min_circ == 0.8
    assert Config.from_env().colors["blue"].min_circ == 0.0


# --- following must not flood into skin ------------------------------------------

def ball_in_skin(x: int = 300, y: int = 240) -> np.ndarray:
    """A strict-red ball sitting in a big patch that only the *relaxed* mask counts as red (skin-like:
    right hue, saturation between the relaxed and strict floors), so the two form one relaxed blob."""
    spec = Config().colors["red"]
    f = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(f, (x, y), 85, hsv_bgr(3, dull_sat("red"), 220), -1)  # the "face"
    cv2.circle(f, (x, y), 18, swatch("red"), -1)                      # the ball
    return f


def test_following_does_not_flood_into_skin():
    p = Pipeline(cfg())
    ball_only = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(ball_only, (300, 240), 18, swatch("red"), -1)
    p.process(ball_only, now=0.0)                    # locked on the ball
    out = p.process(ball_in_skin(), now=0.05)        # skin appears around it
    o = out["objects"]["red"]
    assert o is not None and o["radius"] * W < 30, f"tracked a {o['radius'] * W:.0f}px blob, not the ball"


def test_growth_cap_can_be_widened():
    c = cfg(track_max_growth=100.0)
    p = Pipeline(c)
    ball_only = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(ball_only, (300, 240), 18, swatch("red"), -1)
    p.process(ball_only, now=0.0)
    o = p.process(ball_in_skin(), now=0.05)["objects"]["red"]
    assert o is not None and o["radius"] * W > 60      # with no cap the relaxed blob swallows the face


def test_a_ball_that_grows_gradually_is_still_followed():
    p = Pipeline(cfg())
    for i, r in enumerate((18, 21, 25, 29, 34, 40, 46)):   # ~1.2-1.4x area per step: moving toward the camera
        f = np.full((H, W, 3), 110, np.uint8)
        cv2.circle(f, (300, 240), r, hsv_bgr(3, dull_sat("red"), 255) if i else swatch("red"), -1)
        o = p.process(f, now=i * 0.05)["objects"]["red"]
        assert o is not None, f"lost at radius {r}"


def test_a_lip_sized_blob_beside_the_ball_is_not_followed():
    """The ball vanishes (moved fast / left); a small red strip within reach of its last position
    must not be picked up by the relaxed near-hint search."""
    p = Pipeline(cfg())
    ball = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(ball, (300, 240), 40, swatch("red"), -1)
    assert p.process(ball, now=0.0)["objects"]["red"] is not None
    lips_only = np.full((H, W, 3), 110, np.uint8)
    cv2.ellipse(lips_only, (330, 300), (30, 11), 0, 0, 360, hsv_bgr(3, dull_sat("red"), 220), -1)  # relaxed-only strip
    assert p.process(lips_only, now=0.05)["objects"]["red"] is None


def test_min_shrink_can_be_disabled():
    c = cfg(track_min_shrink=0.0)
    p = Pipeline(c)
    ball = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(ball, (300, 240), 40, swatch("red"), -1)
    p.process(ball, now=0.0)
    small = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(small, (330, 270), 20, hsv_bgr(3, dull_sat("red"), 220), -1)  # round, ~25% of the ball, relaxed-only
    assert p.process(small, now=0.05)["objects"]["red"] is not None


# --- per-colour minimum blob size (red vs lips) ------------------------------------

def dot(name: str, r: int) -> np.ndarray:
    f = scene()
    cv2.circle(f, (320, 240), r, swatch(name), -1)
    return f


def test_red_ignores_a_small_round_blob_that_yellow_and_blue_accept():
    """Radius 10 = ~300 px: lip-sized. Over the global floor (184 px) but under red's own (~614 px)."""
    assert detector("red").detect(to_hsv(dot("red", 10))) is None
    for name in ("yellow", "blue"):
        assert detector(name).detect(to_hsv(dot(name, 10))) is not None


def test_red_still_finds_a_ball_just_over_its_floor():
    assert detector("red").detect(to_hsv(dot("red", 17))) is not None   # ~900 px


def test_a_small_blob_is_not_followed_either():
    """The per-colour floor applies to the relaxed following mask too."""
    p = Pipeline(cfg())
    ball = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(ball, (300, 240), 19, swatch("red"), -1)       # ~1100 px
    assert p.process(ball, now=0.0)["objects"]["red"] is not None
    tiny = np.full((H, W, 3), 110, np.uint8)
    cv2.circle(tiny, (305, 245), 10, swatch("red"), -1)       # shrank to ~28% and below red's floor
    assert p.process(tiny, now=0.05)["objects"]["red"] is None


def test_env_overrides_a_colours_min_area(monkeypatch):
    monkeypatch.setenv("YT_RED_MIN_AREA", "0.0005")
    c = Config.from_env()
    assert c.colors["red"].min_area_frac == 0.0005 and c.colors["blue"].min_area_frac == 0.0


# --- a new object must be confirmed over several frames ------------------------------

def ball_at(x: int, y: int = 240, name: str = "red", r: int = 30) -> np.ndarray:
    f = scene()
    cv2.circle(f, (x, y), r, swatch(name), -1)
    return f


def test_default_requires_three_consecutive_frames():
    assert Config().acquire_frames == 3


def test_new_object_is_reported_only_on_the_third_consecutive_frame():
    p = Pipeline(cfg(acquire_frames=3))
    seen = [p.process(ball_at(300 + i), now=i * 0.033)["objects"]["red"] is not None for i in range(5)]
    assert seen == [False, False, True, True, True]


def test_the_trace_starts_when_the_object_is_confirmed():
    p = Pipeline(cfg(acquire_frames=3))
    outs = [p.process(ball_at(300 + 5 * i), now=i * 0.033) for i in range(4)]
    assert [sum(len(s) for s in o["traces"]["red"]) for o in outs] == [0, 0, 1, 2]


def test_a_single_frame_blip_never_starts_a_trace():
    p = Pipeline(cfg(acquire_frames=3))
    frames = [scene(), ball_at(200), scene(), scene(), scene()]
    outs = [p.process(f, now=i * 0.033) for i, f in enumerate(frames)]
    assert all(o["objects"]["red"] is None and o["traces"]["red"] == [] for o in outs)


def test_a_gap_resets_the_count():
    p = Pipeline(cfg(acquire_frames=3))
    frames = [ball_at(300), ball_at(302), scene(), ball_at(304), ball_at(306)]
    seen = [p.process(f, now=i * 0.033)["objects"]["red"] is not None for i, f in enumerate(frames)]
    assert seen == [False, False, False, False, False]  # the gap restarted the count at the 4th frame


def test_blips_in_different_places_do_not_add_up():
    p = Pipeline(cfg(acquire_frames=3))
    frames = [ball_at(100), ball_at(400), ball_at(100), ball_at(400)]
    assert all(p.process(f, now=i * 0.033)["objects"]["red"] is None for i, f in enumerate(frames))


def test_a_followed_object_needs_no_reconfirmation():
    p = Pipeline(cfg(acquire_frames=3))
    for i in range(3):
        p.process(ball_at(300 + 4 * i), now=i * 0.033)
    assert p.process(ball_at(330), now=0.1)["objects"]["red"] is not None
    assert p.process(ball_at(345), now=0.133)["objects"]["red"] is not None


def test_a_fast_jump_of_the_same_sized_ball_is_not_delayed():
    p = Pipeline(cfg(acquire_frames=3))
    for i in range(3):
        p.process(ball_at(100 + 4 * i), now=i * 0.033)
    out = p.process(ball_at(560), now=0.12)             # far beyond reach, but the same size
    assert out["objects"]["red"] is not None and out["objects"]["red"]["x"] > 0.8


def test_reappearing_after_the_hold_time_needs_confirmation_again():
    p = Pipeline(cfg(acquire_frames=3, hold_s=0.5))
    for i in range(3):
        p.process(ball_at(300), now=i * 0.033)
    p.process(scene(), now=1.0)
    seen = [p.process(ball_at(300), now=1.1 + i * 0.033)["objects"]["red"] is not None for i in range(3)]
    assert seen == [False, False, True]


def test_confirmation_can_be_turned_off():
    p = Pipeline(cfg(acquire_frames=1))
    assert p.process(ball_at(300), now=0.0)["objects"]["red"] is not None
