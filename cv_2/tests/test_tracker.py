import json

import cv2
import numpy as np

from yellow_tracker.config import Config
from yellow_tracker.detector import YellowDetector
from yellow_tracker.overlay import draw
from yellow_tracker.pipeline import Pipeline
from yellow_tracker.trace import DetectionGate, Trace

W, H = 640, 480

def _band_centre_bgr() -> tuple[int, int, int]:
    """Fully saturated colour in the middle of the default hue band, so the tests keep
    meaning "yellow" when the band is retuned for a particular camera or object."""
    c = Config()
    px = cv2.cvtColor(np.uint8([[[(c.h_min + c.h_max) // 2, 255, 255]]]), cv2.COLOR_HSV2BGR)[0, 0]
    return tuple(int(v) for v in px)


YELLOW = _band_centre_bgr()  # BGR


def scene(x: int | None, y: int = 240, distractors: bool = False) -> np.ndarray:
    """Grey room; a yellow ball on a brown stick at (x, y) when x is given."""
    f = np.full((H, W, 3), 110, np.uint8)
    if distractors:
        cv2.circle(f, (100, 100), 40, (130, 160, 220), -1)   # skin tone
        cv2.circle(f, (540, 100), 40, (200, 80, 30), -1)     # blue
        cv2.circle(f, (540, 400), 40, (40, 120, 240), -1)    # orange
    if x is not None:
        cv2.line(f, (x, y), (x, min(H - 1, y + 150)), (40, 70, 110), 10)
        cv2.circle(f, (x, y), 25, YELLOW, -1)
    return f


def cfg(**kw) -> Config:
    return Config(mirror=False, smooth_alpha=1.0, **kw)


# --- detector ---------------------------------------------------------------

def test_finds_yellow_ball_not_the_stick():
    d = YellowDetector(cfg()).detect(scene(320, 200))
    assert d is not None
    assert abs(d.x - 320) < 3 and abs(d.y - 200) < 3
    assert 20 < d.radius < 32


def test_no_object_no_detection():
    assert YellowDetector(cfg()).detect(scene(None)) is None


def test_ignores_skin_blue_and_orange():
    assert YellowDetector(cfg()).detect(scene(None, distractors=True)) is None


def test_picks_the_yellow_among_distractors():
    d = YellowDetector(cfg()).detect(scene(400, 300, distractors=True))
    assert d is not None and abs(d.x - 400) < 3 and abs(d.y - 300) < 3


def test_specks_below_min_area_are_ignored():
    f = scene(None)
    cv2.circle(f, (300, 300), 3, YELLOW, -1)
    assert YellowDetector(cfg()).detect(f) is None


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

def test_trace_follows_the_object():
    p = Pipeline(cfg())
    for i in range(10):
        out = p.process(scene(100 + i * 40), now=i * 0.1)
    pts = out["trace"][0]
    assert len(pts) == 10
    xs = [x for x, _ in pts]
    assert xs == sorted(xs) and abs(xs[0] - 100 / W) < 0.01 and abs(xs[-1] - 460 / W) < 0.01


def test_trace_erased_each_time_detection_turns_off():
    p = Pipeline(cfg(period_s=5.0))
    for cycle in range(3):
        base = cycle * 10.0
        for i in range(10):  # on phase
            out = p.process(scene(100 + i * 30), now=base + i * 0.4)
        assert out["active"] and out["trace"], f"cycle {cycle}: trace should exist while on"
        out = p.process(scene(300), now=base + 5.0)  # first off frame
        assert not out["active"] and out["trace"] == []
        out = p.process(scene(300), now=base + 9.0)  # still off
        assert not out["active"] and out["trace"] == [] and out["object"] is None


def test_new_trace_starts_fresh_after_turning_back_on():
    p = Pipeline(cfg(period_s=5.0))
    for i in range(10):
        p.process(scene(100 + i * 30), now=i * 0.4)
    p.process(scene(300), now=5.5)  # off
    out = p.process(scene(500), now=10.0)  # on again
    assert out["active"] and len(out["trace"]) == 1 and len(out["trace"][0]) == 1


def test_detector_not_run_while_off():
    calls = []

    class Spy(YellowDetector):
        def detect(self, frame):
            calls.append(1)
            return super().detect(frame)

    p = Pipeline(cfg(period_s=5.0), Spy(cfg()))
    p.process(scene(300), now=0.0)
    p.process(scene(300), now=6.0)
    p.process(scene(300), now=7.0)
    assert len(calls) == 1


def test_lost_object_breaks_line_instead_of_joining_it():
    p = Pipeline(cfg())
    p.process(scene(100), now=0.0)
    p.process(scene(110), now=0.1)
    p.process(scene(None), now=0.5)
    out = p.process(scene(500), now=0.9)
    assert [len(s) for s in out["trace"]] == [2, 1]


def test_mirror_flips_x_and_payload_is_json():
    p = Pipeline(Config(mirror=True, smooth_alpha=1.0))
    out = p.process(scene(160), now=0.0)
    assert out["mirrored"] and abs(out["object"]["x"] - 0.75) < 0.01
    json.dumps(out)


def test_smoothing_lags_a_jump():
    p = Pipeline(Config(mirror=False, smooth_alpha=0.5))
    p.process(scene(100), now=0.0)
    out = p.process(scene(300), now=0.05)
    assert abs(out["trace"][0][-1][0] - 200 / W) < 0.01


def test_overlay_draws_without_error_in_both_states():
    p = Pipeline(cfg(period_s=5.0))
    for t in (0.0, 0.1, 0.2, 6.0):
        frame = scene(300)
        out = draw(frame, p.process(frame, now=t), 5.0)
        assert out.shape == frame.shape
