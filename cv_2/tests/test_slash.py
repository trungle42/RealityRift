import json

import cv2
import numpy as np

from tests.test_tracker import H, W, cfg, hsv_bgr, scene
from tracker.config import Config
from tracker.overlay import draw
from tracker.pipeline import Pipeline
from tracker.slash import SlashDetector

FPS = 30
DT = 1 / FPS

# Per-frame fractions of a real slash on the dev camera: a slow start, then a burst (peak ~0.2 of the drop in one frame).
BURST = [0.01, 0.02, 0.04, 0.08, 0.14, 0.2, 0.2, 0.12, 0.05, 0.02]


def track(det: SlashDetector, path, t0: float = 0.0, aspect: float = 1.0):
    """Feed (x, y) points, one per frame, starting at t0; returns every state."""
    return [det.update(t0 + i * DT, p, aspect) for i, p in enumerate(path)]


def slash(y0: float = 0.15, y1: float = 0.95, x: float = 0.5, dx: float = 0.0, profile=BURST):
    """A real-looking swing: y0 -> y1 following `profile` (fractions of the drop per frame). Includes the start point.
    BURST over 0.8 of the frame peaks at ~5.5 frame-heights/s, like the recorded slashes (5.9-9.1)."""
    total = sum(profile)
    ys = [y0]
    for f in profile:
        ys.append(ys[-1] + (y1 - y0) * f / total)
    return [(x + dx * i / (len(ys) - 1), y) for i, y in enumerate(ys)]


def linear(y0: float, y1: float, frames: int, x: float = 0.5, dx: float = 0.0):
    return [(x + dx * i / (frames - 1), y0 + (y1 - y0) * i / (frames - 1)) for i in range(frames)]


def still(n: int, x: float = 0.5, y: float = 0.15):
    return [(x, y)] * n


def fired(states) -> bool:
    return any(s.active for s in states)


# --- the detector alone: real slashes ------------------------------------------------

def test_a_real_looking_slash_fires():
    states = track(SlashDetector(), still(6) + slash())
    assert not states[5].active
    assert states[-1].active and states[-1].count == 1


def test_it_fires_part_way_through_the_swing_not_after_it_ends():
    states = track(SlashDetector(), still(6) + slash())
    first = next(i for i, s in enumerate(states) if s.active)
    assert first < len(states) - 2


def test_it_shows_for_the_hold_time_then_clears():
    det = SlashDetector(hold_s=2.0)
    states = track(det, still(6) + slash())
    t_fire = next(i for i, s in enumerate(states) if s.active) * DT
    assert det.update(t_fire + 1.9, (0.5, 0.95)).active
    cleared = det.update(t_fire + 2.05, (0.5, 0.95))
    assert not cleared.active and cleared.seconds_left == 0.0


def test_seconds_left_counts_down():
    det = SlashDetector(hold_s=2.0)
    states = track(det, still(6) + slash())
    fired_state = next(s for s in states if s.active)
    assert 1.9 <= fired_state.seconds_left <= 2.0
    assert det.update(1.5, (0.5, 0.95)).seconds_left < fired_state.seconds_left


def test_a_second_slash_while_showing_is_ignored_then_it_rearms():
    det = SlashDetector(hold_s=2.0)
    track(det, still(6) + slash())
    track(det, slash(), t0=0.7)                            # during the hold: ignored
    assert det.update(1.2, (0.5, 0.95)).count == 1
    track(det, still(8, y=0.15), t0=3.0)                   # hold over
    states = track(det, slash(), t0=3.3)
    assert states[-1].count == 2 and states[-1].active


def test_a_short_hold_does_not_count_the_rest_of_the_same_swing():
    # A fast swing fires once a third of the way down; what it moves after that must not be a second slash once a short
    # hold (the game's) is over. With the 2 s default the window had long forgotten it, so this only showed with short holds.
    for hold in (0.2, 0.5, 1.0, 2.0):
        states = track(SlashDetector(hold_s=hold), still(6) + linear(0.05, 0.97, 7) + still(60, y=0.97))
        assert states[-1].count == 1, hold


def test_a_short_hold_rearms_for_the_next_swing():
    det = SlashDetector(hold_s=0.5)
    track(det, still(6) + slash())
    track(det, linear(0.95, 0.15, 12) + still(4), t0=0.8)   # raise again
    states = track(det, slash(), t0=1.4)
    assert states[-1].count == 2


def test_raise_then_swing_down_is_a_slash():
    path = linear(0.9, 0.12, 25) + still(4, y=0.12) + slash(0.12, 0.95)
    assert fired(track(SlashDetector(), path))


def test_a_slightly_slanted_swing_is_a_slash():
    assert fired(track(SlashDetector(), slash(x=0.5, dx=0.08), aspect=4 / 3))


def test_a_swing_seen_only_at_its_two_ends_is_a_slash():
    """The real swing can be ~3 frames and the marker is smeared in the middle: one sighting before, one after."""
    det = SlashDetector()
    track(det, still(4, y=0.5))
    assert det.update(3 * DT + 2 * DT, (0.5, 0.93)).active       # one blurred frame in between: 0.43 lower, 6.4 fh/s


def test_a_single_missed_frame_does_not_break_a_swing():
    path = still(6) + slash()
    path[10] = None
    assert fired(track(SlashDetector(), path))


def test_it_is_driven_by_time_not_frame_count():
    """The same swing sampled at 15 fps (half as many frames) still counts."""
    det = SlashDetector()
    path = still(3) + slash(profile=[0.03, 0.12, 0.34, 0.25, 0.07])
    states = [det.update(i * 2 * DT, p) for i, p in enumerate(path)]
    assert states[-1].active


# --- the detector alone: things that must NOT fire ---------------------------------------

def test_a_slow_lowering_is_not_a_slash():
    assert not fired(track(SlashDetector(), linear(0.15, 0.95, 60)))                # 2 s


def test_a_big_drop_without_a_fast_stroke_is_not_a_slash():
    """0.8 in 1.3 s with no burst: peak ~0.6 frame-heights/s."""
    assert not fired(track(SlashDetector(), linear(0.15, 0.95, 40)))


def test_a_quick_lowering_like_normal_movement_is_not_a_slash():
    """Regression from a live recording: ordinary movement dropped 0.3-0.34 in ~0.3 s (peak ~2.3) and fired the old detector."""
    quick = slash(0.53, 0.87, profile=[0.05, 0.1, 0.18, 0.22, 0.2, 0.15, 0.1])
    assert not fired(track(SlashDetector(), still(4, y=0.53) + quick))
    assert not fired(track(SlashDetector(), slash(0.5, 0.82, profile=[0.1, 0.2, 0.2, 0.2, 0.15, 0.1, 0.05])))


def test_a_fast_but_small_drop_is_not_a_slash():
    assert not fired(track(SlashDetector(), still(4) + slash(0.15, 0.4)))            # 0.25, below min_drop


def test_raising_is_not_a_slash():
    assert not fired(track(SlashDetector(), slash(0.95, 0.15)))


def test_a_sideways_swing_is_not_a_slash():
    assert not fired(track(SlashDetector(), linear(0.5, 0.5, 10, x=0.1, dx=0.8)))


def test_a_diagonal_swing_is_not_a_slash():
    assert not fired(track(SlashDetector(), slash(0.15, 0.9, x=0.2, dx=0.5), aspect=4 / 3))


def test_wobbling_up_and_down_is_not_a_slash():
    path = [(0.5, 0.45 + 0.12 * (1 if (i // 2) % 2 else -1)) for i in range(40)]
    assert not fired(track(SlashDetector(), path))


def test_noise_while_holding_still_is_not_a_slash():
    rng = np.random.default_rng(0)
    path = [(0.5 + rng.normal(0, 0.004), 0.5 + rng.normal(0, 0.004)) for _ in range(120)]
    assert not fired(track(SlashDetector(), path))


def test_losing_the_marker_mid_swing_forgets_the_motion():
    det = SlashDetector()
    track(det, still(4) + slash(0.15, 0.3)[:4])
    assert not det.update(0.9, (0.5, 0.95)).active         # reappears far lower after a long gap: not one drop


def test_two_sightings_far_apart_in_time_are_not_a_swing():
    det = SlashDetector()
    det.update(0.0, (0.5, 0.2))
    assert not det.update(0.6, (0.5, 0.8)).active          # a 0.6 s gap forgets the first sighting


def test_a_single_sighting_never_fires():
    assert not SlashDetector().update(0.0, (0.5, 0.9)).active


def test_nothing_seen_means_no_slash():
    assert not fired(track(SlashDetector(), [None] * 30))


# --- settings ----------------------------------------------------------------------

def test_the_thresholds_are_settings():
    path = still(4) + slash()
    assert fired(track(SlashDetector(), path))
    assert not fired(track(SlashDetector(min_drop=0.9), path))
    assert not fired(track(SlashDetector(min_peak_speed=9.0), path))
    quick = slash(0.5, 0.82, profile=[0.1, 0.2, 0.2, 0.2, 0.15, 0.1, 0.05])
    assert fired(track(SlashDetector(min_drop=0.3, min_peak_speed=1.0), quick))


def test_the_point_floor_is_a_setting():
    det = SlashDetector(min_points=3)
    det.update(0.0, (0.5, 0.5))
    assert not det.update(0.07, (0.5, 0.93)).active
    two = SlashDetector(min_points=2)
    two.update(0.0, (0.5, 0.5))
    assert two.update(0.07, (0.5, 0.93)).active


# --- through the pipeline --------------------------------------------------------------

def strip(frame: np.ndarray, x: int, y: int, w: int = 70, h: int = 14) -> np.ndarray:
    """The phone's marker centred at (x, y)."""
    lo, hi = Config().phone.hue[0]
    cv2.rectangle(frame, (x - w // 2, y - h // 2), (x + w // 2, y + h // 2), hsv_bgr((lo + hi) // 2, 255, 255), -1)
    return frame


def swing(pipe: Pipeline, t0: float, x: int = 160, y0: int = 80, y1: int = 400, still_frames: int = 8):
    """The marker waits at the top, then drops to y1 in a real-looking burst at 30 fps. Returns the payloads."""
    ys = [y0] * still_frames + [int(y * H) for _, y in slash(y0 / H, y1 / H)]
    return [pipe.process(strip(scene(), x, y), t0 + i * DT) for i, y in enumerate(ys)]


def test_the_phone_is_found_and_reported():
    out = Pipeline(cfg()).process(strip(scene(), 300, 200), 0.0)
    assert out["phone"] is not None and abs(out["phone"]["x"] - 300 / W) < 0.02 and abs(out["phone"]["y"] - 200 / H) < 0.02
    assert out["slash"] == {"active": False, "secondsLeft": 0.0, "count": 0}
    json.dumps(out)


def test_a_fast_swing_down_makes_the_pipeline_report_slashed():
    outs = swing(Pipeline(cfg()), 0.0)
    assert not outs[7]["slash"]["active"] and outs[-1]["slash"]["active"] and outs[-1]["slash"]["count"] == 1
    assert 1.5 <= outs[-1]["slash"]["secondsLeft"] <= 2.0


def test_it_works_with_the_normal_three_frame_confirmation():
    outs = swing(Pipeline(Config(mirror=False, smooth_alpha=1.0)), 0.0, still_frames=8)
    assert outs[-1]["slash"]["active"]


def test_a_slow_lowering_does_not_make_the_pipeline_report_slashed():
    pipe, last = Pipeline(cfg()), {}
    for i in range(70):
        last = pipe.process(strip(scene(), 160, 80 + int(320 * i / 69)), i * DT)
    assert not last["slash"]["active"] and last["slash"]["count"] == 0


def test_a_slash_still_counts_while_the_wand_is_paused():
    """Wand detection is OFF from 5 s to 10 s; the slash detector is separate and keeps running."""
    pipe = Pipeline(cfg(period_s=5.0))
    pipe.process(scene(), 0.0)                              # starts the gate's clock: ON until 5 s, OFF until 10 s
    outs = swing(pipe, 6.0)
    assert not outs[-1]["active"] and outs[-1]["traces"]["yellow"] == []
    assert outs[-1]["slash"]["active"]


def test_the_wand_is_unaffected_by_the_phone():
    pipe = Pipeline(cfg())
    out = {}
    for i in range(8):
        out = pipe.process(strip(scene({"yellow": (300 + 10 * i, 240)}), 160, 80 + 30 * i), i * DT)
    assert out["objects"]["yellow"] is not None and len(out["traces"]["yellow"][0]) == 8
    assert set(out["objects"]) == set(out["traces"]) == set(out["shapes"]) == {"yellow", "blue", "red"}
    assert out["phone"] is not None


def test_the_wand_colours_are_not_mistaken_for_the_phone():
    out = Pipeline(cfg()).process(scene({"yellow": (200, 200), "blue": (300, 200), "red": (400, 200)}), 0.0)
    assert out["phone"] is None and not out["slash"]["active"]


def test_a_wand_swinging_down_is_not_a_slash():
    pipe, last = Pipeline(cfg()), {}
    for i, (_, y) in enumerate(slash(0.15, 0.9)):
        last = pipe.process(scene({"yellow": (300, int(y * H))}), i * DT)
    assert not last["slash"]["active"]


def test_the_feature_can_be_turned_off():
    pipe = Pipeline(cfg(phone=None))
    outs = swing(pipe, 0.0)
    assert all(o["phone"] is None and not o["slash"]["active"] for o in outs)
    assert pipe.phone_detector is None


def test_env_can_disable_or_retune_the_phone(monkeypatch):
    monkeypatch.setenv("YT_PHONE", "0")
    assert Config.from_env().phone is None
    monkeypatch.setenv("YT_PHONE", "1")
    monkeypatch.setenv("YT_PHONE_HUE", "50-70")
    monkeypatch.setenv("YT_PHONE_S_MIN", "130")
    c = Config.from_env()
    assert c.phone.hue == ((50, 70),) and c.phone.s_min == 130 and c.phone.v_min == Config().phone.v_min


def test_the_phone_is_not_a_wand_colour_in_the_config():
    c = Config()
    assert "phone" not in c.colors and c.phone.name == "phone" and c.slash_hold_s == 2.0
    assert c.slash_min_peak_speed == 4.5 and c.slash_min_drop == 0.30 and c.slash_window_s == 1.5


def test_the_phone_keeps_being_tracked_whatever_the_wand_gate_does():
    pipe = Pipeline(cfg(period_s=5.0))
    seen = [pipe.process(strip(scene(), 160, 80), t)["phone"] is not None for t in (1.0, 4.9, 5.1, 9.9, 10.1)]
    assert all(seen)


def test_the_overlay_shows_the_phone_and_the_slashed_banner():
    c = cfg()
    colors = {**c.colors, "phone": c.phone}
    before = Pipeline(c).process(strip(scene(), 160, 80), 0.0)
    outs = swing(Pipeline(c), 0.0)
    base = strip(scene(), 160, 80)
    plain = draw(base, before, 5.0, colors)
    slashed = draw(strip(scene(), 160, 400), outs[-1], 5.0, colors, c.slash_hold_s)
    assert (plain != base).any() and (slashed != plain).any()
    assert (slashed[H // 2 - 30:H // 2 + 30, W // 2 - 40:W // 2 + 40] == 0).any()      # the banner's black box
    draw(base, before, 5.0, c.colors)                      # still fine without a phone entry in `colors`
