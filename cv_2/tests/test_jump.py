import json

import cv2
import numpy as np
import pytest

from tests.test_slash import swing
from tests.test_tracker import H, W, cfg, scene
from tracker.config import Config
from tracker.jump import JumpDetector
from tracker.motion import BodyMotion, MotionSample
from tracker.overlay import draw
from tracker.pipeline import Pipeline

DT = 1 / 30


# --- synthetic scene: a textured background and a textured, body-sized block that can move ------------

def texture(h: int, w: int, seed: int) -> np.ndarray:
    g = np.random.default_rng(seed).integers(0, 255, (h, w), dtype=np.uint8)
    g = cv2.GaussianBlur(g, (0, 0), 2.0)
    g = cv2.normalize(g, None, 40, 215, cv2.NORM_MINMAX)
    return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)


BG = texture(H, W, 1)
BODY = texture(360, 380, 2)          # ~45 % of the picture, like a person standing close


def person(dy: int = 0, dx: int = 0, brightness: int = 0) -> np.ndarray:
    f = BG.copy()
    f[90 + dy:450 + dy, 130 + dx:510 + dx] = BODY
    return np.clip(f.astype(np.int16) + brightness, 0, 255).astype(np.uint8)


def jump_offsets(rise: int = 6, apex: int = 3, fall: int = 6, step: int = 12):
    """Vertical offsets in pixels frame by frame: up, hang, down, ending where it started (negative = up)."""
    up = [-step * i for i in range(1, rise + 1)]
    return [0, 0] + up + [up[-1]] * apex + [up[-1] + step * i for i in range(1, fall + 1)] + [0, 0]


def run(pipe_or_motion, offsets, t0=0.0, **kw):
    """Feed person frames at 30 fps; returns what each call returned."""
    out = []
    for i, dy in enumerate(offsets):
        frame = person(dy, **kw)
        out.append(pipe_or_motion.update(frame, t0 + i * DT) if isinstance(pipe_or_motion, BodyMotion)
                   else pipe_or_motion.process(frame, t0 + i * DT))
    return out


# --- the sensor ---------------------------------------------------------------------------

def test_the_first_frame_has_nothing_to_compare_with():
    assert BodyMotion().update(person(), 0.0) is None


def test_a_still_scene_has_no_motion():
    m = BodyMotion()
    m.update(person(), 0.0)
    s = m.update(person(), DT)
    assert s.area < 0.005 and s.vy == 0.0


def test_a_block_moving_up_reads_as_negative_vertical_velocity():
    m = BodyMotion()
    m.update(person(0), 0.0)
    s = m.update(person(-12), DT)            # 12 px per frame at 480 px high = 0.75 picture heights/s
    assert s.vy < 0 and -1.1 < s.vy < -0.4 and s.area > 0.05 and abs(s.vx) < abs(s.vy) * 0.3


def test_a_block_moving_down_reads_as_positive():
    m = BodyMotion()
    m.update(person(0), 0.0)
    assert m.update(person(12), DT).vy > 0.4


def test_sideways_motion_is_horizontal():
    m = BodyMotion()
    m.update(person(), 0.0)
    s = m.update(person(dx=12), DT)
    assert abs(s.vx) > 0.4 and abs(s.vy) < abs(s.vx) * 0.3


def test_the_velocity_is_per_second_not_per_frame():
    a, b = BodyMotion(), BodyMotion()
    a.update(person(0), 0.0), b.update(person(0), 0.0)
    slow, fast = a.update(person(-12), DT * 2), b.update(person(-12), DT)
    assert abs(fast.vy / slow.vy - 2) < 0.4


def test_a_change_of_brightness_is_not_motion():
    m = BodyMotion()
    m.update(person(), 0.0)
    s = m.update(person(brightness=25), DT)
    assert s.area < 0.02


def test_reset_forgets_the_previous_frame():
    m = BodyMotion()
    m.update(person(), 0.0)
    m.reset()
    assert m.update(person(-12), DT) is None


# --- the detector alone ----------------------------------------------------------------

def samples(vy_list, area=0.45, vx=0.0):
    return [MotionSample(v, vx, area if v != 0 else 0.0) for v in vy_list]


def feed(det: JumpDetector, series, t0=0.0, step=DT):
    return [det.update(t0 + i * step, s) for i, s in enumerate(series)]


def jump_series(rise=6, apex=3, fall=6, speed=0.9, area=0.45, vx=0.0):
    return samples([0.0, 0.0] + [-speed] * rise + [0.0] * apex + [speed] * fall + [0.0, 0.0], area, vx)


def fired(states) -> bool:
    return any(s.active for s in states)


def test_a_clean_jump_fires_once():
    states = feed(JumpDetector(), jump_series())
    assert states[-1].active and states[-1].count == 1


def test_it_fires_around_the_landing_not_at_takeoff():
    states = feed(JumpDetector(), jump_series())
    first = next(i for i, s in enumerate(states) if s.active)
    assert first >= 2 + 6 + 3 + 6                # after the rise, the hang and the whole way down (the landing)


def test_it_shows_for_the_hold_time_then_clears_and_rearms():
    det = JumpDetector(hold_s=2.0)
    states = feed(det, jump_series())
    t_fire = next(i for i, s in enumerate(states) if s.active) * DT
    assert det.update(t_fire + 1.9, MotionSample(0, 0, 0)).active
    cleared = det.update(t_fire + 2.1, MotionSample(0, 0, 0))
    assert not cleared.active and cleared.seconds_left == 0.0
    again = feed(det, jump_series(), t0=3.0)
    assert again[-1].count == 2 and again[-1].active


def test_a_second_jump_while_showing_is_ignored():
    det = JumpDetector(hold_s=2.0)
    feed(det, jump_series())
    feed(det, jump_series(), t0=0.8)
    assert det.update(1.2, MotionSample(0, 0, 0)).count == 1


def test_a_crouch_before_the_jump_still_counts():
    series = samples([0.0] * 2 + [0.6] * 4 + [0.0] * 2) + jump_series(speed=1.0)
    assert fired(feed(JumpDetector(), series))


def test_jumps_of_different_sizes_count():
    for rise, speed in ((4, 1.0), (6, 0.9), (8, 0.7), (5, 1.4)):
        assert fired(feed(JumpDetector(), jump_series(rise=rise, fall=rise, speed=speed))), (rise, speed)


def test_it_is_driven_by_time_not_frame_count():
    """The same jump sampled at 15 fps (half as many frames) still counts."""
    series = samples([0.0] + [-0.9] * 3 + [0.0] * 2 + [0.9] * 3 + [0.0] * 3)
    assert fired(feed(JumpDetector(min_frames=2), series, step=2 * DT))


def test_a_single_noisy_frame_inside_the_rise_does_not_split_it():
    series = samples([0.0, 0.0] + [-0.9, -0.9, 0.0, -0.9, -0.9, -0.9] + [0.0] * 3 + [0.9] * 6 + [0.0] * 3)
    assert fired(feed(JumpDetector(), series))


# --- the detector alone: things that must NOT fire ------------------------------------------

def test_standing_up_is_not_a_jump():
    assert not fired(feed(JumpDetector(), samples([-0.8] * 8 + [0.0] * 20)))


def test_sitting_down_is_not_a_jump():
    assert not fired(feed(JumpDetector(), samples([0.8] * 8 + [0.0] * 20)))


def test_bending_down_and_up_is_not_a_jump():
    assert not fired(feed(JumpDetector(), samples([0.8] * 6 + [0.0] * 3 + [-0.8] * 6 + [0.0] * 5)))


def test_a_slow_bob_is_not_a_jump():
    assert not fired(feed(JumpDetector(), samples(([-0.15] * 8 + [0.15] * 8) * 4)))


def test_a_small_moving_area_is_not_a_jump():
    """A waving hand or a swinging phone: the right direction changes but little of the picture moves."""
    assert not fired(feed(JumpDetector(), jump_series(area=0.01)))


def test_sideways_motion_is_not_a_jump():
    assert not fired(feed(JumpDetector(), jump_series(vx=0.9)))


def test_up_then_down_far_apart_in_time_is_not_a_jump():
    series = samples([-0.9] * 6 + [0.0] * 20 + [0.9] * 6)
    assert not fired(feed(JumpDetector(), series))


def test_a_long_one_way_fall_after_a_small_rise_is_not_a_jump():
    series = samples([-0.9] * 3 + [0.0] * 2 + [0.9] * 14)
    assert not fired(feed(JumpDetector(max_ratio=2.0), series))


def test_a_tiny_hop_below_the_height_floor_is_not_a_jump():
    hop = jump_series(rise=3, fall=3, speed=0.5)               # a rise of 0.05 picture heights
    assert fired(feed(JumpDetector(), hop))
    assert not fired(feed(JumpDetector(min_height=0.06), hop))


def test_one_spike_frame_is_not_a_jump():
    assert not fired(feed(JumpDetector(), samples([0.0] * 5 + [-2.0] + [0.0] * 3 + [2.0] + [0.0] * 5)))


def test_idle_noise_is_not_a_jump():
    rng = np.random.default_rng(0)
    series = [MotionSample(float(rng.normal(0, 0.05)), float(rng.normal(0, 0.05)), 0.02) for _ in range(300)]
    assert not fired(feed(JumpDetector(), series))


def test_missing_samples_are_treated_as_no_motion():
    assert not fired(feed(JumpDetector(), [None] * 40))
    det = JumpDetector()
    series = jump_series()
    series[4] = None
    assert not det.update(0.0, None).active


def test_the_thresholds_are_settings():
    assert not fired(feed(JumpDetector(up_speed=2.0, down_speed=2.0), jump_series()))
    assert not fired(feed(JumpDetector(min_height=0.5), jump_series()))
    assert fired(feed(JumpDetector(min_area=0.01), jump_series(area=0.02)))


# --- through the pipeline ---------------------------------------------------------------------

def test_a_jump_makes_the_pipeline_report_jumped():
    outs = run(Pipeline(cfg()), jump_offsets())
    assert not outs[0]["jump"]["active"] and outs[-1]["jump"]["active"] and outs[-1]["jump"]["count"] == 1
    assert 1.5 <= outs[-1]["jump"]["secondsLeft"] <= 2.0
    assert outs[-1]["motion"] is not None
    json.dumps(outs[-1])


def test_a_still_scene_never_reports_a_jump():
    outs = run(Pipeline(cfg()), [0] * 60)
    assert not any(o["jump"]["active"] for o in outs)


def test_standing_up_in_the_scene_is_not_a_jump():
    outs = run(Pipeline(cfg()), [0, 0] + [-10 * i for i in range(1, 9)] + [-80] * 20)
    assert not any(o["jump"]["active"] for o in outs)


def test_a_brightness_flicker_is_not_a_jump():
    pipe, outs = Pipeline(cfg()), []
    for i in range(40):
        outs.append(pipe.process(person(brightness=25 if i % 2 else -25), i * DT))
    assert not any(o["jump"]["active"] for o in outs)


def test_a_phone_slash_is_not_a_jump():
    """A small marker swinging down: right direction, but far too little of the picture moves."""
    outs = swing(Pipeline(cfg()), 0.0)
    assert outs[-1]["slash"]["active"] and not any(o["jump"]["active"] for o in outs)


def test_a_jump_still_counts_while_the_wand_is_paused():
    pipe = Pipeline(cfg(period_s=5.0))
    pipe.process(scene(), 0.0)                                  # starts the gate's clock: OFF from 5 s to 10 s
    outs = run(pipe, jump_offsets(), t0=6.0)
    assert not outs[-1]["active"] and outs[-1]["traces"]["yellow"] == [] and outs[-1]["jump"]["active"]


def test_jump_detection_can_be_turned_off():
    pipe = Pipeline(cfg(jump=False))
    outs = run(pipe, jump_offsets())
    assert pipe.motion is None
    assert all(o["motion"] is None and not o["jump"]["active"] for o in outs)


def test_env_can_disable_jump_detection(monkeypatch):
    monkeypatch.setenv("YT_JUMP", "0")
    assert Config.from_env().jump is False
    monkeypatch.setenv("YT_JUMP", "1")
    assert Config.from_env().jump is True


def test_the_jump_defaults():
    c = Config()
    assert c.jump and c.jump_hold_s == 2.0 and c.jump_min_frames == 3


def test_the_overlay_shows_the_jumped_banner():
    c = cfg()
    outs = run(Pipeline(c), jump_offsets())
    base = person()
    plain = draw(base, outs[0], 5.0, c.colors)
    jumped = draw(base, outs[-1], 5.0, c.colors, c.slash_hold_s, c.jump_hold_s)
    assert (jumped != plain).any()
    assert (jumped[H // 4 - 20:H // 4 + 20, W // 2 - 40:W // 2 + 40] == 0).any()          # the banner's black box
    debug = draw(base, outs[-1], 5.0, c.colors, debug=True)
    assert (debug != draw(base, outs[-1], 5.0, c.colors)).any()


# --- a jump must not be read as a slash ---------------------------------------------------------

def person_with_phone(dy: int, phone_y: int) -> np.ndarray:
    from tests.test_slash import strip
    return strip(person(dy), 80, phone_y)


def test_the_phone_dropping_with_the_body_in_a_jump_is_not_a_slash():
    """Live: the landing dropped the phone fast enough to fire the slash detector. The whole picture is moving then."""
    pipe, outs = Pipeline(cfg()), []
    offsets = jump_offsets()
    for i, dy in enumerate(offsets):
        outs.append(pipe.process(person_with_phone(dy, 230 + dy * 2), i * DT))      # the phone moves twice as far as the body
    assert outs[-1]["jump"]["count"] == 1
    assert outs[-1]["slash"]["count"] == 0 and not any(o["slash"]["active"] for o in outs)


def test_slashes_are_ignored_for_a_moment_after_whole_body_motion():
    from tests.test_slash import swing
    pipe = Pipeline(cfg(slash_suppress_hold_s=1.0))
    run(pipe, jump_offsets())                                    # whole-body motion until ~0.7 s
    inside = swing(pipe, 0.8, still_frames=0)                    # a swing 0.1 s later is ignored (window runs to ~1.7 s)
    assert not inside[-1]["slash"]["active"]
    late = Pipeline(cfg(slash_suppress_hold_s=0.3))
    run(late, jump_offsets())
    assert swing(late, 2.0, still_frames=3)[-1]["slash"]["active"]      # well after the 0.3 s window: counts again


def test_a_slash_with_a_still_body_still_fires():
    from tests.test_slash import swing
    outs = swing(Pipeline(cfg()), 0.0)
    assert outs[-1]["slash"]["active"]


def test_the_slash_detector_ignores_suppressed_frames_and_forgets_them():
    from tracker.slash import SlashDetector
    from tests.test_slash import slash, still, track
    det = SlashDetector()
    pts = still(4) + slash()
    states = [det.update(i * DT, p, 1.0, suppress=True) for i, p in enumerate(pts)]
    assert not any(s.active for s in states)
    after = [det.update(1.0 + i * DT, p) for i, p in enumerate(still(4) + slash())]
    assert after[-1].active                                     # nothing suppressed leaked into the buffer; a fresh swing fires


# --- rise mode (YT_JUMP_MODE=rise, an experiment): fire on the way up, not at the landing ----------------

def rise_detector(**kw) -> JumpDetector:
    return JumpDetector(mode="rise", **kw)


def first_fire(states):
    return next((i for i, s in enumerate(states) if s.active), None)


def test_rise_mode_fires_on_the_way_up_well_before_full_mode():
    series = jump_series(speed=1.1)
    early, late = first_fire(feed(rise_detector(), series)), first_fire(feed(JumpDetector(), series))
    assert early is not None and early < 2 + 6                    # during the rise (3 frames after take-off)
    assert late >= 2 + 6 + 3 + 6 and (late - early) * DT >= 0.4    # full mode: after the hang and the fall


def test_rise_mode_fires_once_per_jump_the_landing_and_a_bounce_after_it_do_not_count():
    series = jump_series(speed=1.1) + samples([-1.1] * 4 + [0.0] * 30)     # land, straighten up quickly, stand
    assert feed(rise_detector(), series)[-1].count == 1


def test_rise_mode_rearms_after_the_refractory_so_two_quick_jumps_both_count():
    det = rise_detector()
    feed(det, jump_series(speed=1.1))
    assert feed(det, jump_series(speed=1.1), t0=1.0)[-1].count == 2   # 0.8 s refractory, not the 2 s hold
    full = JumpDetector(hold_s=2.0)
    feed(full, jump_series(speed=1.1))
    assert feed(full, jump_series(speed=1.1), t0=1.0)[-1].count == 1  # full mode unchanged


def test_rise_mode_wants_a_faster_rise_than_full_mode_since_no_fall_confirms_it():
    series = jump_series(speed=0.9)
    assert fired(feed(JumpDetector(), series)) and not fired(feed(rise_detector(), series))


def test_rise_mode_ignores_a_slow_stand_up_even_one_that_speeds_up_late():
    assert not fired(feed(rise_detector(), samples([-0.8] * 8 + [0.0] * 20)))                # peak too slow
    assert not fired(feed(rise_detector(), samples([-0.4] * 12 + [-1.2] * 4 + [0.0] * 10)))  # rising for 0.4 s first


def test_rise_mode_ignores_a_lean_a_sideways_move_and_a_single_spike():
    lean = jump_series(speed=1.1, area=0.15)                                     # a lean moved 0.12-0.20 of the picture
    assert not fired(feed(rise_detector(min_area=Config().jump_min_area), lean))
    assert not fired(feed(rise_detector(), jump_series(speed=1.1, vx=1.1)))
    assert not fired(feed(rise_detector(), samples([0.0, -1.5] + [0.0] * 10)))


def test_rise_mode_through_the_pipeline_fires_earlier_and_once():
    offsets = jump_offsets(rise=4, fall=4, step=20) + [0] * 30      # ~1.25 picture heights a second
    early, late = run(Pipeline(cfg(jump_mode="rise")), offsets), run(Pipeline(cfg()), offsets)
    at = lambda outs: next(i for i, o in enumerate(outs) if o["jump"]["count"])  # noqa: E731
    assert at(early) < at(late) and early[-1]["jump"]["count"] == late[-1]["jump"]["count"] == 1
    assert run(Pipeline(cfg(jump_mode="rise")), [0, 0] + [-10 * i for i in range(1, 9)] + [-80] * 20)[-1]["jump"]["count"] == 0


def test_the_jump_mode_comes_from_yt_jump_mode(monkeypatch):
    assert Config().jump_mode == "full"
    monkeypatch.setenv("YT_JUMP_MODE", "Rise")
    assert Config.from_env().jump_mode == "rise"
    monkeypatch.setenv("YT_JUMP_MODE", "sideways")
    with pytest.raises(ValueError):
        Config.from_env()
    with pytest.raises(ValueError):
        JumpDetector(mode="sideways")
