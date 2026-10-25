import os

os.environ["OFFLINE"] = "1"

import json  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.joystick import clean_move  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def test_clean_move_clamps_to_unit_disc():
    assert clean_move({"type": "move", "x": 3, "y": 4}) == {"type": "move", "x": 0.6, "y": 0.8, "sprint": False}
    assert clean_move({"type": "move", "x": 0.5, "y": -0.25, "sprint": True})["sprint"] is True


def test_clean_move_rejects_garbage():
    for bad in (None, [], "x", {"type": "cast"}, {"type": "move", "x": "a"}, {"type": "move", "x": float("nan"), "y": 0},
                {"type": "move", "x": float("inf"), "y": 0}):
        assert clean_move(bad) is None
    # "sprint" must be a real boolean, not a truthy string.
    assert clean_move({"type": "move", "x": 0, "y": 0, "sprint": "yes"})["sprint"] is False


def test_joystick_page_is_served():
    res = client.get("/joystick")
    assert res.status_code == 200 and "Storybound" in res.text and "/ws/joystick/" in res.text
    assert "lan_ip" in client.get("/joystick/info").json()


def test_phone_move_reaches_the_game_only_sanitized():
    with client.websocket_connect("/ws/joystick/t1?role=game") as game:
        with client.websocket_connect("/ws/joystick/t1?role=phone") as phone:
            assert json.loads(game.receive_text()) == {"type": "peer", "role": "phone", "state": "joined"}
            assert json.loads(phone.receive_text())["role"] == "game"  # newcomer learns the game is already here
            phone.send_text(json.dumps({"type": "move", "x": 9, "y": 0, "evil": "payload"}))
            assert json.loads(game.receive_text()) == {"type": "move", "x": 1.0, "y": 0.0, "sprint": False}
            phone.send_text("not json")
            phone.send_text(json.dumps({"type": "spell"}))
            phone.send_text(json.dumps({"type": "move", "x": 0, "y": 1, "sprint": True}))
            assert json.loads(game.receive_text()) == {"type": "move", "x": 0.0, "y": 1.0, "sprint": True}


def test_rooms_are_isolated():
    with client.websocket_connect("/ws/joystick/roomB?role=game") as game_b:
        with client.websocket_connect("/ws/joystick/roomA?role=phone") as phone_a:
            phone_a.send_text(json.dumps({"type": "move", "x": 1, "y": 0}))
        with client.websocket_connect("/ws/joystick/roomB?role=phone") as phone_b:
            assert json.loads(game_b.receive_text())["state"] == "joined"  # first thing roomB's game hears is roomB's phone
            phone_b.send_text(json.dumps({"type": "move", "x": 0, "y": 1}))
            assert json.loads(game_b.receive_text())["y"] == 1.0


def test_a_game_socket_cannot_send_moves_to_phones():
    with client.websocket_connect("/ws/joystick/roomC?role=phone") as phone:
        with client.websocket_connect("/ws/joystick/roomC?role=game") as game:
            assert json.loads(phone.receive_text())["role"] == "game"
            game.send_text(json.dumps({"type": "move", "x": 1, "y": 0}))
            game.send_text(json.dumps({"type": "move", "x": 0, "y": 0, "sprint": False}))
        assert json.loads(phone.receive_text())["state"] == "left"  # nothing but the peer notice came through


def test_bad_room_or_role_is_refused():
    for url in ("/ws/joystick/bad room!?role=phone", "/ws/joystick/ok?role=admin"):
        try:
            with client.websocket_connect(url):
                raise AssertionError("connection should have been refused")
        except Exception as error:  # starlette raises WebSocketDisconnect on close code 1008
            assert "1008" in str(error) or "Disconnect" in type(error).__name__
