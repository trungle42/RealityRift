import os

os.environ["OFFLINE"] = "1"

import json  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.cv import MAX_POINTS, clean_control, clean_tracker, clean_wand  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    # One TestClient context runs every socket on one event loop. A bare TestClient gives each websocket_connect its own
    # loop and thread, and a message one handler sends to another session's socket can then fail to wake that session's
    # pending receive: these tests hung in about 1 run in 10 under load.
    with TestClient(app) as c:
        yield c

WAND = {
    "active": True, "secondsLeft": 3.21, "target": "circle", "next": "triangle",
    "shapes": {"yellow": {"shape": "circle", "score": 0.12}, "blue": {"shape": None, "score": 0.7}, "red": None},
    "complete": {"yellow": True, "blue": False, "red": False},
    "traces": {"yellow": [[[0.5, 0.4], [0.52, 0.41]]], "blue": [], "red": []},
}


def frame(**extra):
    return {"type": "cv", "slash": 2, "jump": 1, "motion": 0.04, "wand": WAND, **extra}


def test_clean_tracker_keeps_a_valid_frame_as_is():
    assert clean_tracker(frame()) == frame()
    assert clean_tracker(frame(motion=None, wand=None))["motion"] is None


def test_clean_tracker_rejects_garbage():
    for bad in (None, [], "x", {"type": "move"}, {"type": "cv"}, frame(slash=-1), frame(slash=1.5), frame(jump="2"),
                frame(slash=True), frame(jump=float("nan"))):
        assert clean_tracker(bad) is None


def test_extra_fields_are_dropped_and_values_clamped():
    out = clean_tracker(frame(evil="payload", motion=7))
    assert "evil" not in out and out["motion"] == 1.0
    traces = clean_wand({**WAND, "traces": {"yellow": [[[2, -1], "x", [0.1], [0.3, "y"]]]}})["traces"]
    assert traces == {"yellow": [[[1.0, 0.0]]]}


def test_a_bad_wand_block_does_not_lose_slash_and_jump():
    for bad in ("x", {"active": "yes", "secondsLeft": 1}, {"active": True}):
        out = clean_tracker(frame(wand=bad))
        assert out["wand"] is None and out["slash"] == 2 and out["jump"] == 1


def test_wand_names_and_sizes_are_limited():
    w = clean_wand({**WAND, "target": "<script>", "complete": {"Yellow!": True, "blue": "yes"},
                    "shapes": {"yellow": {"shape": "a" * 40, "score": 1}},
                    "traces": {"yellow": [[[0.5, 0.5]] * (MAX_POINTS + 50)]}})
    assert w["target"] is None and w["complete"] == {"blue": False}
    assert w["shapes"]["yellow"]["shape"] is None
    assert sum(len(s) for s in w["traces"]["yellow"]) == MAX_POINTS


def test_clean_control():
    assert clean_control({"type": "gate", "on": True, "target": "star"}) == {"type": "gate", "on": True, "target": "star"}
    assert clean_control({"type": "gate", "on": False}) == {"type": "gate", "on": False, "target": None}
    for bad in (None, {"type": "gate"}, {"type": "gate", "on": 1}, {"type": "cv", "on": True}):
        assert clean_control(bad) is None


def test_tracker_frames_reach_the_game_only_sanitized(client):
    with client.websocket_connect("/ws/cv/c1?role=game") as game:
        with client.websocket_connect("/ws/cv/c1?role=tracker") as tracker:
            assert json.loads(game.receive_text()) == {"type": "peer", "role": "tracker", "state": "joined"}
            assert json.loads(tracker.receive_text())["role"] == "game"  # newcomer learns the game is already here
            tracker.send_text(json.dumps(frame(evil=1)))
            assert json.loads(game.receive_text()) == frame()
            tracker.send_text("not json")
            tracker.send_text(json.dumps({"type": "move", "x": 1, "y": 0}))
            tracker.send_text(json.dumps(frame(slash=3)))
            assert json.loads(game.receive_text())["slash"] == 3
            # Close inside the block: leaving it cancels the server handler, which can then die before saying "left".
            tracker.close()
            assert json.loads(game.receive_text()) == {"type": "peer", "role": "tracker", "state": "left"}


def test_the_game_can_send_control_messages_to_the_tracker(client):
    with client.websocket_connect("/ws/cv/c2?role=tracker") as tracker:
        with client.websocket_connect("/ws/cv/c2?role=game") as game:
            assert json.loads(tracker.receive_text())["role"] == "game"
            assert json.loads(game.receive_text())["role"] == "tracker"
            game.send_text(json.dumps(frame()))  # a game cannot pretend to be the tracker
            game.send_text(json.dumps({"type": "gate", "on": True, "target": "square", "x": 1}))
            assert json.loads(tracker.receive_text()) == {"type": "gate", "on": True, "target": "square"}


def test_rooms_are_isolated_from_each_other_and_from_the_joystick(client):
    with client.websocket_connect("/ws/cv/roomB?role=game") as game_b:
        with client.websocket_connect("/ws/cv/roomA?role=tracker") as tracker_a:
            tracker_a.send_text(json.dumps(frame()))
        with client.websocket_connect("/ws/joystick/roomB?role=phone") as phone:
            phone.send_text(json.dumps({"type": "move", "x": 1, "y": 0}))
        with client.websocket_connect("/ws/cv/roomB?role=tracker") as tracker_b:
            assert json.loads(game_b.receive_text())["state"] == "joined"  # roomB's own tracker is the first thing it hears
            tracker_b.send_text(json.dumps(frame(jump=9)))
            assert json.loads(game_b.receive_text())["jump"] == 9


def test_bad_room_or_role_is_refused(client):
    for url in ("/ws/cv/bad room!?role=tracker", "/ws/cv/ok?role=phone"):
        try:
            with client.websocket_connect(url):
                raise AssertionError("connection should have been refused")
        except Exception as error:  # starlette raises WebSocketDisconnect on close code 1008
            assert "1008" in str(error) or "Disconnect" in type(error).__name__
