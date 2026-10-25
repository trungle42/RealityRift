import json
import queue

from tests.test_shapes import path_for, play
from tests.test_tracker import cfg, scene
from tools.publish import apply, listener
from tracker import shapes as S
from tracker.config import Config
from tracker.game import game_message
from tracker.overlay import draw as draw_overlay
from tracker.pipeline import Pipeline

FPS = 25
DT = 1 / FPS


def game(target: str | None = None, **kw) -> Pipeline:
    pipe = Pipeline(cfg(**kw))
    pipe.control(True, target)
    return pipe


def frames(pipe: Pipeline, points, t0: float, colour: str = "yellow") -> list[dict]:
    """The ball at each pixel position, one frame each at 25 fps from t0."""
    return [pipe.process(scene({colour: p}), t0 + i * DT) for i, p in enumerate(points)]


def rest(at: tuple[int, int], seconds: float = 0.6) -> list[tuple[int, int]]:
    return [at] * int(seconds * FPS)


def line(a: tuple[int, int], b: tuple[int, int], n: int = 20) -> list[tuple[int, int]]:
    return [(int(a[0] + (b[0] - a[0]) * i / (n - 1)), int(a[1] + (b[1] - a[1]) * i / (n - 1))) for i in range(n)]


# --- the game takes the wand --------------------------------------------------------

def test_in_game_mode_the_wand_stays_on_with_no_timer():
    pipe = game()
    outs = [pipe.process(scene(), t) for t in (0.0, 4.0, 6.0, 12.0, 30.0)]
    assert all(o["mode"] == "game" and o["active"] for o in outs)
    assert all(o["target"] is None and o["next"] is None and o["secondsLeft"] == 0.0 for o in outs)
    json.dumps(outs[-1])


def test_the_timer_mode_is_unchanged_until_the_game_takes_over():
    pipe = Pipeline(cfg())
    assert pipe.process(scene(), 1.0)["mode"] == "timer"
    assert not pipe.process(scene(), 6.0)["active"]


def test_any_preset_completes_when_no_target_is_named():
    for shape in S.SHAPES:
        out = play(game(), 0.0, shape)
        assert out["complete"]["yellow"] is True and out["shapes"]["yellow"]["shape"] == shape, shape


def test_a_named_target_only_completes_on_that_shape():
    wrong = play(game("triangle"), 0.0, "square")
    assert wrong["complete"]["yellow"] is False and wrong["shapes"]["yellow"]["shape"] == "square"
    right = play(game("triangle"), 0.0, "triangle")
    assert right["target"] == "triangle" and right["complete"]["yellow"] is True


def test_a_sloppy_star_casts_when_the_game_asks_for_a_star_though_it_reads_as_a_square_otherwise():
    """Through the whole pipeline (ball frames, tracking, smoothing): one of the simulator's stars, drawn without a request,
    is named a square; with a star requested it completes as a star. Before the fix it did nothing, labelled "square"."""
    import numpy as np

    from tests.test_shapes import ASPECT, hand_drawn
    rng, rec = np.random.default_rng(7), S.ShapeRecognizer(max_dist=0.5)
    sloppy = next(p for p in (hand_drawn("star", rng) for _ in range(300))
                  if rec.classify(p, ASPECT).shape == "square" and rec.classify(p, ASPECT, prefer="star").shape == "star"
                  and play_points(game(), p)["shapes"]["yellow"] is not None)
    free = play_points(game(), sloppy)
    assert free["shapes"]["yellow"]["shape"] == "square"
    asked = play_points(game("star"), sloppy)
    assert asked["complete"]["yellow"] is True and asked["shapes"]["yellow"]["shape"] == "star"
    assert play_points(game("triangle"), sloppy)["complete"]["yellow"] is False       # a different request is not forgiven


def test_a_clean_triangle_does_not_cast_a_requested_star():
    out = play(game("star"), 0.0, "triangle")
    assert out["complete"]["yellow"] is False and out["shapes"]["yellow"]["shape"] == "triangle"


def play_points(pipe: Pipeline, points) -> dict:
    """The ball follows normalised points at 25 fps; returns the last payload."""
    out = {}
    for i, (x, y) in enumerate(points):
        out = pipe.process(scene({"yellow": (int(x * 640), int(y * 480))}), i * DT)
    return out


def test_an_unknown_target_means_any_shape():
    out = play(game("hexagon"), 0.0, "circle")
    assert out["target"] is None and out["complete"]["yellow"] is True


def test_resting_the_wand_starts_a_new_stroke_so_a_lead_in_does_not_spoil_the_shape():
    circle = path_for("circle")
    lead_in = line((80, 80), circle[0])
    without_rest = frames(game(), lead_in + circle, 0.0)[-1]
    assert without_rest["complete"]["yellow"] is False
    with_rest = frames(game(), lead_in + rest(circle[0]) + circle, 0.0)[-1]
    assert with_rest["complete"]["yellow"] is True and with_rest["shapes"]["yellow"]["shape"] == "circle"


def test_drawing_speed_is_not_resting_but_a_crawl_is():
    # 3 px a frame (75 px/s, slow for a drawing hand) leaves the stillness radius within the pause window, so the stroke
    # keeps growing; 1 px a frame (25 px/s) stays inside it, which is close enough to resting to restart the stroke there.
    drawing = frames(game(), [(100 + 3 * i, 200) for i in range(30)], 0.0)[-1]
    assert len(drawing["traces"]["yellow"][-1]) == 30
    crawl = frames(game(), [(100 + i, 200) for i in range(30)], 0.0)[-1]
    assert len(crawl["traces"]["yellow"][-1]) < 30


def test_a_completed_shape_stays_complete_then_the_colour_starts_over():
    pipe = game()
    circle = path_for("circle")
    outs = frames(pipe, circle, 0.0)
    t_done = next(i for i, o in enumerate(outs) if o["complete"]["yellow"]) * DT
    end = circle[-1]
    held = frames(pipe, [end] * 10, len(circle) * DT)          # still within wand_rearm_s
    assert all(o["complete"]["yellow"] for o in held if o_time(o, held, len(circle) * DT) < t_done + 0.8)
    after = frames(pipe, rest(end, 1.0), len(circle) * DT + 0.4)[-1]
    assert after["complete"]["yellow"] is False and after["shapes"]["yellow"] is None
    assert sum(len(s) for s in after["traces"]["yellow"]) <= 2


def o_time(o: dict, outs: list[dict], t0: float) -> float:
    return t0 + outs.index(o) * DT


def test_the_wand_can_draw_again_after_it_starts_over():
    pipe = game()
    circle, square = path_for("circle"), path_for("square")
    frames(pipe, circle, 0.0)
    t = len(circle) * DT
    frames(pipe, rest(circle[-1], 1.0), t)                        # complete, then re-armed
    t += 1.0
    frames(pipe, line(circle[-1], square[0], 10) + rest(square[0]), t)
    t += 10 * DT + 0.6
    out = frames(pipe, square, t)[-1]
    assert out["complete"]["yellow"] is True and out["shapes"]["yellow"]["shape"] == "square"


def test_switching_off_stops_detection_and_on_again_starts_fresh():
    pipe = game()
    play(pipe, 0.0, "circle")
    pipe.control(False)
    off = pipe.process(scene({"yellow": (300, 200)}), 3.0)
    assert off["active"] is False and off["objects"]["yellow"] is None and off["traces"]["yellow"] == []
    pipe.control(True, "star")
    on = pipe.process(scene(), 3.1)
    assert on["active"] and on["target"] == "star" and on["complete"]["yellow"] is False


def test_changing_the_target_starts_a_fresh_round_but_repeating_it_does_not():
    pipe = game()
    pipe.process(scene({"yellow": (300, 200)}), 0.0)
    pipe.process(scene({"yellow": (310, 200)}), DT)
    pipe.control(True, None)                                     # same request: nothing cleared
    assert len(pipe.traces["yellow"]) == 2
    pipe.control(True, "circle")
    assert len(pipe.traces["yellow"]) == 0


def test_release_hands_the_wand_back_to_the_timer():
    pipe = game()
    play(pipe, 0.0, "circle")
    pipe.release()
    out = pipe.process(scene(), 3.0)
    assert out["mode"] == "timer" and out["target"] in S.SHAPES and out["traces"]["yellow"] == []
    assert pipe.traces["yellow"].max_points == Config().max_trace_points


def test_a_stroke_is_capped_in_game_mode():
    pipe = game(wand_trace_points=40)
    outs = frames(pipe, [(100 + 5 * i, 200 + (i % 2)) for i in range(80)], 0.0)
    assert sum(len(s) for s in outs[-1]["traces"]["yellow"]) == 40


def test_colours_complete_independently_in_game_mode():
    pipe = game()
    out = {}
    for i, (p, q) in enumerate(zip(path_for("circle"), path_for("square"))):
        out = pipe.process(scene({"yellow": p, "blue": q}), i * DT)
    assert out["complete"]["yellow"] and out["complete"]["blue"]
    assert out["shapes"]["yellow"]["shape"] == "circle" and out["shapes"]["blue"]["shape"] == "square"


def test_the_game_message_carries_game_mode():
    msg = game_message(play(game(), 0.0, "star"))
    assert msg["wand"]["target"] is None and msg["wand"]["next"] is None and msg["wand"]["complete"]["yellow"] is True
    json.dumps(msg)


def test_overlay_draws_game_mode_on_and_off():
    pipe = game("square")
    on = play(pipe, 0.0, "square")
    pipe.control(False)
    off = pipe.process(scene(), 3.0)
    free = game().process(scene(), 0.0)
    for payload in (on, off, free):
        assert draw_overlay(scene(), payload, 5.0, Config().colors).shape == scene().shape


# --- tools.publish applies what the game sends -----------------------------------------

def test_the_game_s_gate_messages_reach_the_pipeline():
    controls, pipe = queue.Queue(), Pipeline(cfg())
    on_message = listener(controls)
    on_message({"type": "peer", "role": "game", "state": "joined"})
    on_message({"type": "gate", "on": True, "target": "triangle"})
    on_message({"type": "gate", "on": "yes"})                     # malformed: ignored
    assert controls.qsize() == 1
    apply(pipe, controls.get_nowait())
    assert pipe.process(scene(), 0.0)["target"] == "triangle"
    on_message({"type": "peer", "role": "game", "state": "left"})
    apply(pipe, controls.get_nowait())
    assert pipe.process(scene(), 0.1)["mode"] == "timer"


def test_a_null_target_from_the_game_means_any_shape():
    pipe = Pipeline(cfg())
    apply(pipe, {"type": "gate", "on": True, "target": None})
    assert play(pipe, 0.0, "triangle")["complete"]["yellow"] is True
