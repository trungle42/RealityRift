import base64
import json
import queue
import socket
import threading

import cv2
import numpy as np
import pytest
from websockets.sync.server import serve

from tests.test_slash import DT, strip, swing
from tests.test_tracker import cfg, scene
from tools.publish import Publisher, listener, ws_url
from tracker.game import game_message, jpeg_message, thin
from tracker.pipeline import Pipeline


def payloads(frames=None):
    pipe = Pipeline(cfg())
    return [pipe.process(f, i * DT) for i, f in enumerate(frames or [scene()] * 3)]


# --- the message ------------------------------------------------------------------------

def test_the_message_carries_counts_motion_and_the_wand_round():
    msg = game_message(payloads()[-1])
    assert msg["type"] == "cv" and msg["slash"] == 0 and msg["jump"] == 0
    assert msg["motion"] is None or 0.0 <= msg["motion"] <= 1.0
    wand = msg["wand"]
    assert wand["active"] is True and wand["target"] == "circle" and wand["next"] == "triangle"
    assert set(wand["shapes"]) == set(wand["complete"]) == set(wand["traces"]) == {"yellow", "blue", "red"}
    json.dumps(msg)


def test_a_slash_shows_as_its_count_going_up():
    counts = [game_message(p)["slash"] for p in swing(Pipeline(cfg()), 0.0)]
    assert counts[0] == 0 and counts[-1] == 1


def test_no_motion_sample_is_null():
    assert game_message(payloads(frames=[scene()])[0])["motion"] is None


def test_thin_keeps_short_traces_and_caps_long_ones():
    short = [[[0.1, 0.1]] * 5, [[0.2, 0.2]] * 3]
    assert thin(short, 200) is short
    long = [[[i / 900, 0.5] for i in range(900)], [[0.3, 0.3]] * 100]
    out = thin(long, 200)
    assert sum(len(s) for s in out) <= 200 and len(out) == 2 and out[0][0] == long[0][0]
    many = [[[0.5, 0.5]]] * 300                      # more segments than points allowed: one point each, no endless loop
    assert len(thin(many, 200)) == 300


def test_ws_url():
    assert ws_url("http://localhost:8000", "storybound") == "ws://localhost:8000/ws/cv/storybound?role=tracker"
    assert ws_url("https://game.example/", "demo-1") == "wss://game.example/ws/cv/demo-1?role=tracker"
    for api, room in (("localhost:8000", "x"), ("http://x", "bad room"), ("http://x", "")):
        with pytest.raises(ValueError):
            ws_url(api, room)


# --- the sender -------------------------------------------------------------------------

def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Relay:
    """A stand-in for the backend: records what the tracker sends and answers with a control message."""

    def __init__(self, port: int = 0):
        self.received: queue.Queue = queue.Queue()
        self.server = serve(self._handle, "127.0.0.1", port)
        self.port = self.server.socket.getsockname()[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def _handle(self, ws):
        ws.send(json.dumps({"type": "gate", "on": True, "target": "star"}))
        for text in ws:
            self.received.put(json.loads(text))

    def close(self):
        self.server.shutdown()


def test_newest_message_of_each_kind_wins():
    pub = Publisher("ws://127.0.0.1:1/ws/cv/x?role=tracker")
    pub.offer({"n": 1})
    pub.offer({"n": 2})
    pub.offer({"f": 1}, "frame")
    pub.offer({"f": 2}, "frame")
    assert [json.loads(m) for m in pub._take(0)] == [{"n": 2}, {"f": 2}] and pub._take(0) == []


# --- the camera picture -------------------------------------------------------------------

def half_white(w: int = 640, h: int = 480) -> np.ndarray:
    frame = np.zeros((h, w, 3), np.uint8)
    frame[:, : w // 2] = 255            # the camera's left half is white
    return frame


def decode(msg: dict) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(base64.b64decode(msg["jpeg"]), np.uint8), cv2.IMREAD_COLOR)


def test_the_preview_is_a_small_mirrored_jpeg():
    msg = jpeg_message("frame", half_white(), 224, 55, True)
    assert msg["type"] == "frame" and (msg["w"], msg["h"]) == (224, 168)
    assert msg["jpeg"].startswith("/9j/") and len(msg["jpeg"]) < 24_000   # the relay's cap for a preview
    img = decode(msg)
    assert img.shape[:2] == (168, 224) and img[:, :50].mean() < 40 and img[:, -50:].mean() > 215   # mirrored: white on the right
    json.dumps(msg)


def test_a_snapshot_is_full_size_unmirrored_and_carries_the_request_id():
    msg = jpeg_message("snapshot", half_white(), 512, 82, False, id=7)
    assert msg["type"] == "snapshot" and msg["id"] == 7 and (msg["w"], msg["h"]) == (512, 384)
    img = decode(msg)
    assert img[:, :80].mean() > 215 and len(msg["jpeg"]) < 200_000       # unmirrored: white on the left; under the relay cap


def test_the_game_message_carries_the_phone_marker_and_where_each_wand_is():
    pipe = Pipeline(cfg())
    out = pipe.process(strip(scene({"yellow": (320, 200)}), 540, 200), 0.0)
    msg = game_message(out)
    assert msg["phone"] == out["phone"] and out["phone"] is not None
    assert msg["wands"]["yellow"] is not None and msg["wands"]["blue"] is None   # for the game's "wand not seen" hint


def test_snapshot_requests_reach_the_camera_loop():
    controls = queue.Queue()
    on_message = listener(controls)
    on_message({"type": "snapshot", "id": 3})
    on_message({"type": "snapshot", "id": "x"})                         # malformed: ignored
    assert controls.qsize() == 1 and controls.get_nowait()["id"] == 3


def test_it_sends_to_the_relay_and_hands_back_control_messages():
    relay, got = Relay(), queue.Queue()
    pub = Publisher(f"ws://127.0.0.1:{relay.port}/ws/cv/t?role=tracker", got.put, retry_s=0.1).start()
    try:
        assert got.get(timeout=5) == {"type": "gate", "on": True, "target": "star"}
        pub.offer({"type": "cv", "slash": 4})
        assert relay.received.get(timeout=5) == {"type": "cv", "slash": 4}
        assert pub.connected
    finally:
        pub.close()
        relay.close()


def test_it_waits_for_a_backend_that_starts_later():
    port = free_port()
    pub = Publisher(f"ws://127.0.0.1:{port}/ws/cv/t?role=tracker", retry_s=0.1).start()
    try:
        pub.offer({"type": "cv", "slash": 1})
        assert not pub.connected
        relay = Relay(port)
        try:
            for _ in range(50):                     # the sender only sends what is newest when it (re)connects
                pub.offer({"type": "cv", "slash": 1})
                try:
                    assert relay.received.get(timeout=0.1) == {"type": "cv", "slash": 1}
                    break
                except queue.Empty:
                    continue
            else:
                raise AssertionError("never reconnected")
        finally:
            relay.close()
    finally:
        pub.close()
