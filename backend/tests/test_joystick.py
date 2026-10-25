import os

os.environ["OFFLINE"] = "1"

import json  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.joystick import clean_move, clean_phone  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    # One TestClient context runs every socket on one event loop; a bare TestClient gives each websocket_connect its own,
    # and a relayed message could then fail to wake the other session's pending receive (an occasional hang).
    with TestClient(app) as c:
        yield c


def test_clean_move_clamps_to_unit_disc():
    assert clean_move({"type": "move", "x": 3, "y": 4}) == {"type": "move", "x": 0.6, "y": 0.8, "sprint": False}
    assert clean_move({"type": "move", "x": 0.5, "y": -0.25, "sprint": True})["sprint"] is True


def test_clean_move_rejects_garbage():
    for bad in (None, [], "x", {"type": "cast"}, {"type": "move", "x": "a"}, {"type": "move", "x": float("nan"), "y": 0},
                {"type": "move", "x": float("inf"), "y": 0}):
        assert clean_move(bad) is None
    # "sprint" must be a real boolean, not a truthy string.
    assert clean_move({"type": "move", "x": 0, "y": 0, "sprint": "yes"})["sprint"] is False


def test_joystick_page_is_served(client):
    res = client.get("/joystick")
    assert res.status_code == 200 and "Storybound" in res.text and "/ws/joystick/" in res.text
    assert "lan_ip" in client.get("/joystick/info").json()


def test_phone_move_reaches_the_game_only_sanitized(client):
    with client.websocket_connect("/ws/joystick/t1?role=game") as game:
        with client.websocket_connect("/ws/joystick/t1?role=phone") as phone:
            assert json.loads(game.receive_text()) == {"type": "peer", "role": "phone", "state": "joined", "player": 0}
            assert json.loads(phone.receive_text()) == {"type": "slot", "player": 0}
            assert json.loads(phone.receive_text())["role"] == "game"  # newcomer learns the game is already here
            phone.send_text(json.dumps({"type": "move", "x": 9, "y": 0, "evil": "payload", "player": 1}))
            assert json.loads(game.receive_text()) == {"type": "move", "x": 1.0, "y": 0.0, "sprint": False, "player": 0}
            phone.send_text("not json")
            phone.send_text(json.dumps({"type": "spell"}))
            phone.send_text(json.dumps({"type": "move", "x": 0, "y": 1, "sprint": True}))
            assert json.loads(game.receive_text()) == {"type": "move", "x": 0.0, "y": 1.0, "sprint": True, "player": 0}


def test_rooms_are_isolated(client):
    with client.websocket_connect("/ws/joystick/roomB?role=game") as game_b:
        with client.websocket_connect("/ws/joystick/roomA?role=phone") as phone_a:
            phone_a.send_text(json.dumps({"type": "move", "x": 1, "y": 0}))
        with client.websocket_connect("/ws/joystick/roomB?role=phone") as phone_b:
            assert json.loads(game_b.receive_text())["state"] == "joined"  # first thing roomB's game hears is roomB's phone
            phone_b.send_text(json.dumps({"type": "move", "x": 0, "y": 1}))
            assert json.loads(game_b.receive_text())["y"] == 1.0


def test_a_game_socket_cannot_send_moves_to_phones(client):
    with client.websocket_connect("/ws/joystick/roomC?role=phone") as phone:
        assert json.loads(phone.receive_text())["type"] == "slot"
        with client.websocket_connect("/ws/joystick/roomC?role=game") as game:
            assert json.loads(phone.receive_text())["role"] == "game"
            game.send_text(json.dumps({"type": "move", "x": 1, "y": 0}))
            game.send_text(json.dumps({"type": "move", "x": 0, "y": 0, "sprint": False}))
            game.close()  # inside the block: leaving it cancels the server handler before it can say "left"
            assert json.loads(phone.receive_text())["state"] == "left"  # nothing but the peer notice came through


def test_bad_room_or_role_is_refused(client):
    for url in ("/ws/joystick/bad room!?role=phone", "/ws/joystick/ok?role=admin"):
        assert refused(client, url)


def refused(client, url, headers=None) -> bool:
    try:
        with client.websocket_connect(url, **({"headers": headers} if headers else {})):
            return False
    except Exception as error:  # starlette raises WebSocketDisconnect on close code 1008
        return "1008" in str(error) or "Disconnect" in type(error).__name__


def test_clean_phone_keeps_the_buttons_and_moves_only():
    for kind in ("action", "scan", "roll", "slash"):
        assert clean_phone({"type": kind, "evil": "payload"}) == {"type": kind}
    assert clean_phone({"type": "move", "x": 1, "y": 0}) == {"type": "move", "x": 1.0, "y": 0.0, "sprint": False}
    for bad in (None, "action", {"type": "spell"}, {"type": "gate", "on": True}, {"type": ["action"]}):
        assert clean_phone(bad) is None


def test_phone_buttons_reach_the_game(client):
    with client.websocket_connect("/ws/joystick/b1?role=game") as game:
        with client.websocket_connect("/ws/joystick/b1?role=phone") as phone:
            assert json.loads(game.receive_text())["role"] == "phone"
            assert json.loads(phone.receive_text())["type"] == "slot"
            assert json.loads(phone.receive_text())["role"] == "game"
            phone.send_text(json.dumps({"type": "action", "x": 1}))
            assert json.loads(game.receive_text()) == {"type": "action", "player": 0}
            phone.send_text(json.dumps({"type": "teleport"}))
            phone.send_text(json.dumps({"type": "scan"}))
            assert json.loads(game.receive_text()) == {"type": "scan", "player": 0}
            phone.send_text(json.dumps({"type": "roll"}))
            assert json.loads(game.receive_text()) == {"type": "roll", "player": 0}
            phone.send_text(json.dumps({"type": "slash"}))
            assert json.loads(game.receive_text()) == {"type": "slash", "player": 0}


def test_only_this_laptop_s_game_page_may_join_as_the_game(monkeypatch):
    # Phones join from the Wi-Fi; the game side is this laptop's own page, so nobody else can read or spoof the controls.
    for name in ("CV_ALLOW_REMOTE", "CORS_ORIGINS", "CORS_ORIGIN_REGEX"):
        monkeypatch.delenv(name, raising=False)
    with TestClient(app, client=("192.168.1.77", 51000)) as other_laptop:
        assert refused(other_laptop, "/ws/joystick/g1?role=game")
        with other_laptop.websocket_connect("/ws/joystick/g1?role=phone"):
            pass                                                     # a phone on the Wi-Fi still joins
    with TestClient(app) as here:
        assert refused(here, "/ws/joystick/g2?role=game", {"Origin": "https://evil.example"})
        with here.websocket_connect("/ws/joystick/g2?role=game", headers={"Origin": "http://localhost:5173"}):
            pass
        with here.websocket_connect("/ws/joystick/g2?role=phone", headers={"Origin": "http://192.168.1.5:8000"}):
            pass                                                     # the phone page's own origin is fine for a phone


def test_three_phones_get_player_slots_and_a_fourth_is_told_the_room_is_full(client):
    with client.websocket_connect("/ws/joystick/p2?role=game") as game:
        with client.websocket_connect("/ws/joystick/p2?role=phone") as one:
            assert json.loads(one.receive_text()) == {"type": "slot", "player": 0}
            assert json.loads(game.receive_text()) == {"type": "peer", "role": "phone", "state": "joined", "player": 0}
            with client.websocket_connect("/ws/joystick/p2?role=phone") as two, client.websocket_connect("/ws/joystick/p2?role=phone") as pip:
                assert json.loads(two.receive_text()) == {"type": "slot", "player": 1}
                assert json.loads(pip.receive_text()) == {"type": "slot", "player": 2}
                assert [json.loads(game.receive_text())["player"] for _ in range(2)] == [1, 2]
                with client.websocket_connect("/ws/joystick/p2?role=phone") as fourth:
                    assert json.loads(fourth.receive_text()) == {"type": "full"}
                    with pytest.raises(Exception):
                        fourth.receive_text()                        # and it is closed
                pip.send_text(json.dumps({"type": "slash"}))
                assert json.loads(game.receive_text()) == {"type": "slash", "player": 2}
                two.send_text(json.dumps({"type": "slash"}))
                assert json.loads(game.receive_text()) == {"type": "slash", "player": 1}
                one.send_text(json.dumps({"type": "move", "x": 0, "y": 1}))
                assert json.loads(game.receive_text())["player"] == 0
                two.close()
                # Player 2 leaves; the next phone takes the freed slot, the lowest free one.
                assert json.loads(game.receive_text()) == {"type": "peer", "role": "phone", "state": "left", "player": 1}
            with client.websocket_connect("/ws/joystick/p2?role=phone") as again:
                assert json.loads(again.receive_text()) == {"type": "slot", "player": 1}


def test_a_game_that_joins_late_hears_every_phone_with_its_slot(client):
    with client.websocket_connect("/ws/joystick/p3?role=phone") as one, client.websocket_connect("/ws/joystick/p3?role=phone") as two:
        assert json.loads(one.receive_text())["player"] == 0 and json.loads(two.receive_text())["player"] == 1
        with client.websocket_connect("/ws/joystick/p3?role=game") as game:
            heard = [json.loads(game.receive_text()) for _ in range(2)]
            assert heard == [{"type": "peer", "role": "phone", "state": "joined", "player": n} for n in (0, 1)]


# ---- the internet tunnel (demo.sh --tunnel): only the phone page and a phone's socket answer through it ----
TUNNEL = {"cf-connecting-ip": "203.0.113.9", "cf-ray": "8a1b2c3d4e5f-DFW", "x-forwarded-for": "203.0.113.9"}


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/health"), ("GET", "/api/leaderboard"), ("GET", "/api/stats"), ("POST", "/api/artifact"),
    ("POST", "/api/provider/next"), ("GET", "/docs"), ("GET", "/openapi.json"), ("GET", "/joystick/info"),
    ("POST", "/joystick"), ("GET", "/joystick/"), ("OPTIONS", "/api/artifact"),
])
def test_the_tunnel_refuses_everything_but_the_phone_page(client, method, path):
    assert client.request(method, path, headers=TUNNEL).status_code == 403


@pytest.mark.parametrize("header", ["cf-connecting-ip", "cf-ray", "x-forwarded-for"])
def test_any_one_tunnel_header_is_enough_to_lock_down(client, header):
    assert client.get("/api/health", headers={header: "1"}).status_code == 403
    assert client.get("/api/health").status_code == 200          # the same request from this laptop is fine


@pytest.mark.parametrize("url", [
    "/ws/joystick/t9?role=game", "/ws/joystick/t9?role=phone&role=game", "/ws/joystick/t9?role=admin",
    "/ws/cv/t9?role=game", "/ws/cv/t9?role=tracker", "/ws/other",
])
def test_the_tunnel_refuses_every_socket_but_a_phone_s(client, url):
    assert refused(client, url, TUNNEL)


def test_a_phone_through_the_tunnel_gets_the_page_and_plays(client):
    page = client.get("/joystick", headers=TUNNEL)
    assert page.status_code == 200 and "/ws/joystick/" in page.text
    with client.websocket_connect("/ws/joystick/tun1?role=game") as game:       # the game, on this laptop
        with client.websocket_connect("/ws/joystick/tun1?role=phone", headers=TUNNEL) as phone:
            assert json.loads(phone.receive_text()) == {"type": "slot", "player": 0}
            assert json.loads(game.receive_text())["state"] == "joined"
            phone.send_text(json.dumps({"type": "slash"}))
            assert json.loads(game.receive_text()) == {"type": "slash", "player": 0}


def test_joystick_info_offers_the_tunnel_url_only_when_it_is_one(client, tmp_path, monkeypatch):
    from app import tunnel
    monkeypatch.delenv("PUBLIC_URL", raising=False)
    monkeypatch.setattr(tunnel, "PUBLIC_URL_FILE", tmp_path / ".public_url")
    assert client.get("/joystick/info").json()["public_url"] is None
    (tmp_path / ".public_url").write_text("https://calm-river-1234.trycloudflare.com/\n")
    assert client.get("/joystick/info").json()["public_url"] == "https://calm-river-1234.trycloudflare.com"
    for junk in ("http://plain.example", "javascript:alert(1)", "https://a.example/path?x=<b>"):
        (tmp_path / ".public_url").write_text(junk)
        assert client.get("/joystick/info").json()["public_url"] is None
