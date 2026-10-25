import os

os.environ["OFFLINE"] = "1"

import json  # noqa: E402
import math  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.presence import clean_presence  # noqa: E402

TUNNEL = {"cf-connecting-ip": "203.0.113.9", "cf-ray": "8a1b2c3d4e5f-DFW", "x-forwarded-for": "203.0.113.9"}
STATE = {"type": "state", "x": 12.5, "y": 0, "z": -40.25, "heading": 1.2, "speed": 4, "anim": "run", "hp": 8}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def url(room: str, name: str, colour: str) -> str:
    return f"/ws/presence/{room}?name={name}&colour={colour}"


def test_welcome_gives_ids_in_order_and_everyone_hears_joins_and_leaves(client):
    with client.websocket_connect(url("p1", "Trung", "red")) as trung:
        assert json.loads(trung.receive_text()) == {"type": "welcome", "id": 0, "peers": []}
        with client.websocket_connect(url("p1", "Rishaan", "blue")) as rishaan:
            assert json.loads(rishaan.receive_text()) == {"type": "welcome", "id": 1, "peers": [{"id": 0, "name": "Trung", "colour": "red"}]}
            assert json.loads(trung.receive_text()) == {"type": "peer", "state": "joined", "id": 1, "name": "Rishaan", "colour": "blue"}
            with client.websocket_connect(url("p1", "haicil", "yellow")) as haicil:
                welcome = json.loads(haicil.receive_text())
                assert welcome["id"] == 2 and [p["id"] for p in welcome["peers"]] == [0, 1]
                for other in (trung, rishaan):
                    assert json.loads(other.receive_text())["name"] == "haicil"
                haicil.close()
                for other in (trung, rishaan):
                    assert json.loads(other.receive_text()) == {"type": "peer", "state": "left", "id": 2, "name": "haicil", "colour": "yellow"}
            # A freed id is the next one given out.
            with client.websocket_connect(url("p1", "Pip", "yellow")) as again:
                assert json.loads(again.receive_text())["id"] == 2


def test_state_and_fx_reach_the_others_sanitised_and_stamped_never_the_sender(client):
    with client.websocket_connect(url("p2", "A", "red")) as a, client.websocket_connect(url("p2", "B", "blue")) as b:
        a.receive_text(); b.receive_text(); a.receive_text()                         # welcomes, B's join
        b.send_text(json.dumps({**STATE, "id": 0, "x": 1e9, "heading": 3 * math.pi, "hp": 99, "evil": "<script>"}))
        got = json.loads(a.receive_text())
        assert got == {"type": "state", "x": 5000.0, "y": 0.0, "z": -40.25, "heading": round(math.pi, 3), "speed": 4.0, "anim": "run", "hp": 10.0, "id": 1}
        b.send_text(json.dumps({"type": "fx", "kind": "cast", "ability": "meteor", "element": "plasma", "x": 1, "y": 2, "z": 3, "dx": 5, "dz": -0.5}))
        assert json.loads(a.receive_text()) == {"type": "fx", "kind": "cast", "x": 1.0, "y": 2.0, "z": 3.0, "dx": 1.0, "dz": -0.5, "ability": "meteor", "id": 1}
        # Dropped: unknown type, bad anim, non-finite number, missing field, not JSON, oversized. Then one good one gets through.
        for bad in ({"type": "chat", "text": "hi"}, {**STATE, "anim": "dance"}, {**STATE, "x": float("nan")}, {k: v for k, v in STATE.items() if k != "hp"},
                    {"type": "fx", "kind": "explode", "x": 0, "y": 0, "z": 0, "dx": 0, "dz": 0}):
            b.send_text(json.dumps(bad))
        b.send_text("not json")
        b.send_text(json.dumps({**STATE, "pad": "x" * 600}))
        b.send_text(json.dumps({**STATE, "anim": "dead", "hp": 0}))
        assert json.loads(a.receive_text())["anim"] == "dead"


def test_clean_presence_keeps_only_known_fields():
    assert clean_presence({**STATE, "speed": -3})["speed"] == 0.0
    assert clean_presence({**STATE, "x": True}) is None                             # a boolean is not a number
    assert set(clean_presence({"type": "fx", "kind": "slash", "x": 0, "y": 0, "z": 0, "dx": 0, "dz": 1})) == {"type", "kind", "x", "y", "z", "dx", "dz"}
    for bad in (None, [], "state", {"type": "state"}):
        assert clean_presence(bad) is None


def test_a_player_over_the_rate_limit_is_cut_off_for_the_rest_of_that_second(client, monkeypatch):
    from app import presence
    monkeypatch.setattr(presence, "RATE", 3)
    with client.websocket_connect(url("p3", "A", "red")) as a, client.websocket_connect(url("p3", "B", "blue")) as b:
        a.receive_text(); b.receive_text(); a.receive_text()
        for n in range(8):
            b.send_text(json.dumps({**STATE, "x": n}))
        b.close()
        heard = [json.loads(a.receive_text()) for _ in range(4)]
    assert [m.get("x") for m in heard[:3]] == [0.0, 1.0, 2.0] and heard[3]["state"] == "left"


def test_a_fourth_player_is_told_the_room_is_full(client):
    with client.websocket_connect(url("p4", "A", "red")), client.websocket_connect(url("p4", "B", "blue")), \
            client.websocket_connect(url("p4", "C", "yellow")):
        with client.websocket_connect(url("p4", "D", "red")) as fourth:
            assert json.loads(fourth.receive_text()) == {"type": "full"}
            with pytest.raises(Exception):
                fourth.receive_text()


@pytest.mark.parametrize("bad", ["/ws/presence/p5?name=&colour=red", "/ws/presence/p5?name=Trung&colour=green",
                                 "/ws/presence/p5?name=<script>&colour=red", "/ws/presence/p5?name=" + "x" * 17 + "&colour=red",
                                 "/ws/presence/bad room!?name=A&colour=red"])
def test_a_bad_name_colour_or_room_is_refused(client, bad):
    with pytest.raises(Exception):
        with client.websocket_connect(bad) as ws:
            ws.receive_text()


def test_teammates_join_presence_through_the_tunnel_while_everything_else_stays_locked(client):
    with client.websocket_connect(url("p6", "Trung", "red")) as host:
        host.receive_text()
        with client.websocket_connect(url("p6", "Rishaan", "blue"), headers=TUNNEL) as remote:
            assert json.loads(remote.receive_text())["id"] == 1
            remote.send_text(json.dumps(STATE))
            assert json.loads(host.receive_text())["type"] == "peer"
            assert json.loads(host.receive_text())["anim"] == "run"
    for path in ("/api/health", "/joystick/info", "/docs"):
        assert client.get(path, headers=TUNNEL).status_code == 403
    for ws_url in ("/ws/cv/p6?role=game", "/ws/cv/p6?role=tracker", "/ws/joystick/p6?role=game"):
        with pytest.raises(Exception):
            with client.websocket_connect(ws_url, headers=TUNNEL) as ws:
                ws.receive_text()
