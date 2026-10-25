import json
import math

import numpy as np
import pytest

from tests.test_tracker import cfg, scene
from tracker import shapes as S
from tracker.config import Config
from tracker.overlay import draw as draw_overlay
from tracker.pipeline import Pipeline

ASPECT = 640 / 480


def hand_drawn(shape: str, rng: np.random.Generator) -> np.ndarray:
    """A human-like attempt at the shape, as normalised (x, y): corners and notches off by ~8%, a wobbly outline,
    corners rounded by pen smoothing, jitter, stretched up to ~18%, any rotation, start point and direction,
    overshooting the start by up to 10% or stopping up to 6% short."""
    if shape == "circle":
        v = np.array([(math.cos(a), math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40, endpoint=False)])
    elif shape == "star":
        kind = rng.integers(3)
        v = np.array(S._ngon(5, step=2) if kind == 0 else S._star(0.382 if kind == 1 else rng.uniform(0.38, 0.55)))
    else:
        v = np.array(S._ngon({"triangle": 3, "square": 4}[shape]))
    if shape != "circle":
        v = v * (1 + rng.normal(0, 0.08, (len(v), 1))) + rng.normal(0, 0.05, v.shape)
    closed = np.vstack([v, v[:1]])
    pts = np.vstack([a + (b - a) * np.linspace(0, 1, max(2, int(np.hypot(*(b - a)) * 14)), endpoint=False)[:, None]
                     for a, b in zip(closed[:-1], closed[1:])])
    extra = int(len(pts) * rng.uniform(-0.06, 0.1))
    pts = np.vstack([pts, pts[:extra]]) if extra > 0 else pts[:extra] if extra < 0 else pts
    th = np.linspace(0, 2 * math.pi, len(pts))
    pts = pts * (1 + sum(rng.normal(0, 0.025) * np.cos(k * th + rng.uniform(0, 6.28)) for k in (2, 3, 4)))[:, None]
    w = max(2, int(len(pts) * 0.06))
    pad = np.vstack([np.repeat(pts[:1], w, 0), pts, np.repeat(pts[-1:], w, 0)])
    pts = np.column_stack([np.convolve(pad[:, i], np.ones(w) / w, "same")[w:-w] for i in (0, 1)])
    pts = pts + rng.normal(0, 0.006, pts.shape)
    pts = pts[::-1] if rng.random() < 0.5 else pts
    a = rng.uniform(0, 2 * math.pi)
    rot = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    pts = (pts @ rot.T) * (rng.uniform(0.85, 1.18), 1.0)
    pts = pts[np.sort(rng.choice(len(pts), size=min(len(pts), int(rng.integers(50, 110))), replace=False))]
    out = pts * rng.uniform(0.15, 0.4) + rng.uniform(0.35, 0.65, 2)
    out[:, 0] /= ASPECT
    return out


def loop(shape: str, n: int = 80) -> np.ndarray:
    """An ideal drawing of the shape as a path of n points, centred in a 640x480 frame, in normalised x, y."""
    pts = S.outline(shape)
    closed = np.vstack([pts, pts[:1]])
    seg = np.hypot(*np.diff(closed, axis=0).T)
    t = np.linspace(0, seg.sum(), n, endpoint=False)
    s = np.concatenate([[0], np.cumsum(seg)])
    p = np.column_stack([np.interp(t, s, closed[:, 0]), np.interp(t, s, closed[:, 1])])
    return np.column_stack([0.5 + 0.3 * p[:, 0] / ASPECT, 0.5 + 0.3 * p[:, 1]])


def result(points, aspect: float = ASPECT):
    return S.ShapeRecognizer().classify(points, aspect)


# --- recogniser -------------------------------------------------------------

@pytest.mark.parametrize("shape", S.SHAPES)
def test_ideal_shapes_are_named(shape):
    r = result(loop(shape))
    assert r.shape == shape and r.score < 0.05


@pytest.mark.parametrize("shape", S.SHAPES)
def test_start_point_direction_and_rotation_do_not_matter(shape):
    p = loop(shape)
    a = math.radians(37)
    centred = (p - 0.5) * (ASPECT, 1.0)
    rot = centred @ np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]]).T
    rotated = rot / (ASPECT, 1.0) + 0.5
    for variant in (np.roll(p, 23, axis=0), p[::-1], rotated, np.roll(rotated[::-1], 11, axis=0)):
        assert result(variant).shape == shape


@pytest.mark.parametrize("shape", S.SHAPES)
def test_size_and_position_do_not_matter(shape):
    p = (loop(shape) - 0.5) * 0.5 + (0.25, 0.7)
    assert result(p).shape == shape


@pytest.mark.parametrize("star", [S._ngon(5, step=2), S._star(0.382), S._star(0.45)], ids=["pentagram", "outline.38", "outline.45"])
def test_both_ways_of_drawing_a_star_are_a_star(star):
    assert S.ShapeRecognizer().classify(S._resample(np.array(star)) * 0.2 + 0.5, 1.0).shape == "star"


def test_aspect_ratio_of_the_frame_is_accounted_for():
    """A circle on a 4:3 frame is 4:3 squashed in normalised coordinates; telling the recogniser the aspect undoes that."""
    c = loop("circle")
    right, wrong = result(c, ASPECT), result(c, 1.0)
    assert right.shape == "circle" and right.score < wrong.score


@pytest.mark.parametrize("shape", ["circle", "triangle", "square", "star"])
def test_hand_drawn_shapes_are_mostly_recognised(shape):
    """Seeded simulation of human drawing: wobbly, corner-rounded, stretched, rotated, overshooting or stopping short."""
    rng = np.random.default_rng(7)
    rec = S.ShapeRecognizer()
    got = [rec.classify(hand_drawn(shape, rng), ASPECT) for _ in range(150)]
    right = sum(r is not None and r.shape == shape for r in got) / len(got)
    assert right >= (0.85 if shape == "star" else 0.95), f"{shape}: {right:.0%}"


def test_hand_drawn_shapes_are_never_confused_circle_with_square_or_triangle():
    rng = np.random.default_rng(11)
    rec = S.ShapeRecognizer()
    mix = 0
    for shape in ("circle", "square", "triangle"):
        for _ in range(150):
            r = rec.classify(hand_drawn(shape, rng), ASPECT)
            mix += r is not None and r.shape in ("circle", "square", "triangle") and r.shape != shape
    assert mix <= 3


def test_an_unfinished_stroke_is_not_named():
    assert result(loop("circle")[:55]) is None
    assert result(loop("square")[:50]) is None


def test_too_little_data_or_too_small_is_not_named():
    assert result(loop("circle")[:8]) is None
    tiny = (loop("circle") - 0.5) * 0.1 + 0.5
    assert result(tiny) is None


def test_a_closed_scribble_is_unknown_not_forced_into_a_preset():
    out_and_back = np.column_stack([np.concatenate([np.linspace(0.2, 0.8, 40), np.linspace(0.8, 0.2, 40)]), np.full(80, 0.5)])
    r = result(out_and_back)
    assert r is not None and r.shape is None
    figure8 = np.column_stack([0.5 + 0.3 * np.sin(np.linspace(0, 2 * math.pi, 80)), 0.5 + 0.25 * np.sin(np.linspace(0, 4 * math.pi, 80))])
    assert result(figure8).shape is None


def test_standing_still_adds_no_weight_to_the_path():
    p = loop("triangle")
    held = np.vstack([p[:30], np.repeat(p[30:31], 25, axis=0), p[30:]])
    assert result(held).shape == "triangle"


def test_a_slightly_open_drawing_still_counts():
    p = loop("square", 200)
    assert result(p[:185]).shape == "square"


# --- pipeline: target cycle and end to end ----------------------------------

def path_for(shape: str, n: int = 70) -> list[tuple[int, int]]:
    """Pixel positions of a ball drawing the shape in a 640x480 frame."""
    return [(int(x * 640), int(y * 480)) for x, y in loop(shape, n)]


def play(pipe: Pipeline, t0: float, shape: str, colour: str = "yellow") -> dict:
    """The ball draws the shape at 25 fps from t0 (~3 s); returns the last payload."""
    out = {}
    for i, (x, y) in enumerate(path_for(shape)):
        out = pipe.process(scene({colour: (x, y)}), t0 + i * 0.04)
    return out


def test_target_cycles_through_the_presets_on_each_on_phase():
    pipe = Pipeline(cfg())
    seen = []
    for k in range(6):
        out = pipe.process(scene(), 10.0 * k + 1.0)          # ON phase k
        seen.append(out["target"])
        assert out["next"] == Config().shapes[(k + 1) % 4]
        pipe.process(scene(), 10.0 * k + 6.0)                # OFF phase
    assert seen == ["circle", "triangle", "square", "star", "circle", "triangle"]


def test_target_does_not_advance_within_a_phase_or_during_off():
    pipe = Pipeline(cfg())
    assert [pipe.process(scene(), t)["target"] for t in (0, 1, 4.9)] == ["circle"] * 3
    assert pipe.process(scene(), 6)["target"] == "circle"
    assert pipe.process(scene(), 7)["target"] == "circle"
    assert pipe.process(scene(), 10.5)["target"] == "triangle"


def test_the_ball_drawing_a_circle_is_named_a_circle():
    pipe = Pipeline(cfg())
    out = play(pipe, 0.0, "circle")
    assert out["shapes"]["yellow"]["shape"] == "circle"
    assert out["shapes"]["blue"] is None and out["shapes"]["red"] is None
    json.dumps(out)


def test_each_shape_is_named_through_the_whole_pipeline():
    for shape in S.SHAPES:
        out = play(Pipeline(cfg()), 0.0, shape)
        assert out["shapes"]["yellow"]["shape"] == shape, shape


def test_the_result_is_kept_after_the_traces_are_erased():
    pipe = Pipeline(cfg())
    play(pipe, 0.0, "circle")
    off = pipe.process(scene(), 5.5)
    assert not off["active"] and off["traces"]["yellow"] == []
    assert off["shapes"] == {"yellow": None, "blue": None, "red": None}
    assert off["previous"]["target"] == "circle"
    assert off["previous"]["shapes"]["yellow"]["shape"] == "circle"
    assert off["next"] == "triangle"
    json.dumps(off)


def test_the_detected_shape_is_independent_of_the_target():
    pipe = Pipeline(cfg())
    out = play(pipe, 0.0, "square")          # target is circle
    assert out["target"] == "circle" and out["shapes"]["yellow"]["shape"] == "square"


def test_a_new_round_starts_with_no_shape():
    pipe = Pipeline(cfg())
    play(pipe, 0.0, "circle")
    pipe.process(scene(), 5.5)
    fresh = pipe.process(scene(), 10.1)
    assert fresh["active"] and fresh["target"] == "triangle"
    assert fresh["shapes"]["yellow"] is None
    out = play(pipe, 10.1, "triangle")
    assert out["shapes"]["yellow"]["shape"] == "triangle"


def test_colours_are_named_independently():
    pipe = Pipeline(cfg())
    a, b = path_for("circle"), path_for("square")
    out = {}
    for i, (p, q) in enumerate(zip(a, b)):
        out = pipe.process(scene({"yellow": p, "blue": q}), i * 0.04)
    assert out["shapes"]["yellow"]["shape"] == "circle" and out["shapes"]["blue"]["shape"] == "square"


def test_custom_shape_order_and_single_shape():
    pipe = Pipeline(cfg(shapes=("star", "circle")))
    assert pipe.process(scene(), 0.5)["target"] == "star"
    pipe.process(scene(), 6)
    assert pipe.process(scene(), 10.5)["target"] == "circle"
    pipe.process(scene(), 16)
    assert pipe.process(scene(), 20.5)["target"] == "star"


def test_overlay_draws_the_shape_panel_in_every_state():
    pipe = Pipeline(cfg())
    frames = [play(pipe, 0.0, "circle"), pipe.process(scene(), 5.5), pipe.process(scene(), 10.5)]
    for payload in frames:
        out = draw_overlay(scene(), payload, 5.0, Config().colors)
        assert out.shape == scene().shape
    first = pipe.process(scene(), 11.0)
    assert (draw_overlay(scene(), first, 5.0, Config().colors) != scene()).any()


# --- the "complete" state stays on once the target is drawn --------------------------

def walk_on(pipe: Pipeline, t0: float, colour: str = "yellow", frames: int = 20) -> dict:
    """After drawing, the ball leaves the loop in a straight line (so the stroke is no longer closed)."""
    x, y = path_for("circle")[-1]
    out = {}
    for i in range(frames):
        out = pipe.process(scene({colour: (min(600, x + 12 * (i + 1)), y)}), t0 + i * 0.04)
    return out


def test_complete_is_off_before_the_drawing_is_closed_and_on_after():
    pipe = Pipeline(cfg())
    half = [pipe.process(scene({"yellow": p}), i * 0.04) for i, p in enumerate(path_for("circle")[:40])][-1]
    assert half["complete"]["yellow"] is False and half["shapes"]["yellow"] is None
    done = play(Pipeline(cfg()), 0.0, "circle")
    assert done["complete"]["yellow"] is True and done["shapes"]["yellow"]["shape"] == "circle"


def test_complete_stays_on_after_the_ball_moves_on():
    pipe = Pipeline(cfg())
    play(pipe, 0.0, "circle")
    later = walk_on(pipe, 2.9)
    assert later["active"] and later["complete"]["yellow"] is True
    assert later["shapes"]["yellow"]["shape"] == "circle"


def test_without_the_latch_moving_on_would_lose_or_change_the_label():
    """Guards the test above: the live recogniser alone stops calling it a circle once the stroke runs away from its start
    (it vanishes, or the circle plus its tail even reads as a different shape)."""
    pipe = Pipeline(cfg())
    play(pipe, 0.0, "circle")
    walk_on(pipe, 2.9)
    stroke = max(pipe.traces["yellow"].segments, key=len)
    live = pipe.recognizer.classify(stroke, 640 / 480)
    assert live is None or live.shape != "circle"


def test_complete_survives_losing_the_ball():
    pipe = Pipeline(cfg())
    play(pipe, 0.0, "circle")
    for i in range(10):
        out = pipe.process(scene(), 2.9 + i * 0.04)                  # ball out of view
    assert out["complete"]["yellow"] is True and out["objects"]["yellow"] is None
    back = pipe.process(scene({"yellow": (500, 100)}), 3.5)
    assert back["complete"]["yellow"] is True


def test_a_wrong_shape_is_not_latched_so_it_can_be_corrected():
    pipe = Pipeline(cfg())                                           # target is circle
    drawn = play(pipe, 0.0, "square")
    assert drawn["shapes"]["yellow"]["shape"] == "square" and drawn["complete"]["yellow"] is False
    after = walk_on(pipe, 2.9)
    assert after["complete"]["yellow"] is False and after["shapes"]["yellow"] is None


def test_complete_is_per_colour():
    pipe = Pipeline(cfg())
    out = {}
    for i, (p, q) in enumerate(zip(path_for("circle"), path_for("square"))):
        out = pipe.process(scene({"yellow": p, "blue": q}), i * 0.04)
    assert out["complete"] == {"yellow": True, "blue": False, "red": False}


def test_complete_resets_for_the_next_round_and_is_kept_in_previous():
    pipe = Pipeline(cfg())
    play(pipe, 0.0, "circle")
    off = pipe.process(scene(), 5.5)
    assert off["complete"] == {"yellow": False, "blue": False, "red": False}
    assert off["previous"]["shapes"]["yellow"]["shape"] == "circle"
    fresh = pipe.process(scene(), 10.1)
    assert fresh["target"] == "triangle" and fresh["complete"]["yellow"] is False
    done = play(pipe, 10.1, "triangle")
    assert done["complete"]["yellow"] is True


def test_the_latched_result_is_json_and_drawn_as_ok():
    pipe = Pipeline(cfg())
    play(pipe, 0.0, "circle")
    later = walk_on(pipe, 2.9)
    json.dumps(later)
    from tracker.overlay import _verdict
    assert _verdict(later["shapes"]["yellow"], later["target"])[0].endswith("OK")
    assert (draw_overlay(scene(), later, 5.0, Config().colors) != scene()).any()
