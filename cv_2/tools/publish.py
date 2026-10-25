"""Runs the tracker and sends its result to the game through the backend relay (/ws/cv/{room}).

The game listens in the same room: `?room=<name>` in the game's URL, "storybound" by default. Each frame becomes one small
message (tracker/game.py); the game strikes when the slash count goes up, jumps when the jump count goes up, and counts body
motion as moving in the freeze trial. The slash hold is shortened for play (--slash-hold, 0.5 s) so the sword can be swung
again quickly; the demo keeps 2 s.

Run from the cv_2/ folder, with the backend running:
    python -m tools.publish                                    # ws://localhost:8000/ws/cv/storybound
    python -m tools.publish --api http://localhost:8020 --room demo --window
"""
from __future__ import annotations

import argparse
import json
import re
import threading
from typing import Callable

import cv2
from websockets.exceptions import WebSocketException
from websockets.sync.client import ClientConnection, connect

from tracker.capture import Camera
from tracker.config import Config
from tracker.game import game_message
from tracker.overlay import draw
from tracker.pipeline import Pipeline

ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def ws_url(api: str, room: str) -> str:
    """The relay address for a backend URL (http -> ws, https -> wss) and room code."""
    if not ROOM_RE.match(room):
        raise ValueError(f"room must be 1-32 letters, digits, _ or -: {room!r}")
    if not re.match(r"^https?://", api):
        raise ValueError(f"--api must start with http:// or https://: {api!r}")
    return f"{'ws' + api[4:].rstrip('/')}/ws/cv/{room}?role=tracker"


class Publisher:
    """Sends the newest message to the relay on its own thread, so a slow or missing backend never stalls the camera loop.

    A message replaced before it was sent is skipped (the counts are cumulative, so no slash or jump is lost). While the
    backend is away it retries every retry_s. Messages from the relay (peer notices, the game's control messages) are passed
    to on_message."""

    def __init__(self, url: str, on_message: Callable[[dict], None] | None = None, retry_s: float = 1.0):
        self.url, self.on_message, self.retry_s = url, on_message, retry_s
        self.connected = False
        self._msg: str | None = None
        self._cond = threading.Condition()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="publish", daemon=True)

    def start(self) -> "Publisher":
        self._thread.start()
        return self

    def offer(self, msg: dict) -> None:
        with self._cond:
            self._msg = json.dumps(msg)
            self._cond.notify_all()

    def close(self) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        self._thread.join(timeout=2)

    def _take(self, timeout: float) -> str | None:
        with self._cond:
            self._cond.wait_for(lambda: self._msg is not None or self._stop.is_set(), timeout)
            msg, self._msg = self._msg, None
            return msg

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                with connect(self.url, open_timeout=self.retry_s, close_timeout=0.5) as ws:
                    self.connected = True
                    while not self._stop.is_set():
                        msg = self._take(0.2)
                        if msg is not None:
                            ws.send(msg)
                        self._receive(ws)
            except (OSError, TimeoutError, WebSocketException):
                pass
            finally:
                self.connected = False
            self._stop.wait(self.retry_s)

    def _receive(self, ws: ClientConnection) -> None:
        while True:
            try:
                text = ws.recv(timeout=0)
            except TimeoutError:
                return
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            if self.on_message and isinstance(msg, dict):
                self.on_message(msg)


def report(msg: dict) -> None:
    if msg.get("type") == "peer":
        print(f"game {msg.get('state')}" if msg.get("role") == "game" else f"peer: {msg}")
    elif msg.get("type") == "gate":
        print(f"game asked for {msg} (not acted on yet: the wand round still runs on its own timer)")


def main() -> None:
    cfg = Config.from_env()
    ap = argparse.ArgumentParser(description="Send the tracker's slash, jump, motion and wand round to the game.")
    ap.add_argument("--api", default="http://localhost:8000", help="backend URL (default http://localhost:8000)")
    ap.add_argument("--room", default="storybound", help="room code; the game uses ?room=<code> (default storybound)")
    ap.add_argument("--camera", type=int, default=cfg.camera)
    ap.add_argument("--slash-hold", type=float, default=0.5, help="seconds before another slash can count (default 0.5)")
    ap.add_argument("--window", action="store_true", help="show the tracker's view (q quits)")
    ap.add_argument("--frames", type=int, default=0, help="stop after N frames (0 = until q / Ctrl+C)")
    args = ap.parse_args()
    cfg.camera, cfg.slash_hold_s = args.camera, args.slash_hold
    url = ws_url(args.api, args.room)

    pipe = Pipeline(cfg)
    cam = Camera(cfg.camera, cfg.width, cfg.height).start()
    pub = Publisher(url, report).start()
    print(f"Publishing to {url} (Ctrl+C stops)")
    seq, n, connected, counts = 0, 0, None, (0, 0)
    try:
        while not args.frames or n < args.frames:
            seq, frame = cam.read(seq)
            if frame is None:
                continue
            payload = pipe.process(frame)
            pub.offer(game_message(payload))
            n += 1
            if pub.connected != connected:
                connected = pub.connected
                print("connected to the backend" if connected else f"waiting for the backend at {args.api} ...")
            now = (payload["slash"]["count"], payload["jump"]["count"])
            if now != counts:
                print(f"slash {now[0]}  jump {now[1]}")
                counts = now
            if args.window:
                colors = {**cfg.colors, **({"phone": cfg.phone} if cfg.phone else {})}
                cv2.imshow("Tracker -> game (q quits)", draw(frame, payload, cfg.period_s, colors, cfg.slash_hold_s, cfg.jump_hold_s))
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        pass
    finally:
        pub.close()
        cam.stop()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
