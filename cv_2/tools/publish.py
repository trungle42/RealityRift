"""Runs the tracker and sends its result to the game through the backend relay (/ws/cv/{room}).

The game listens in the same room: `?room=<name>` in the game's URL, "storybound" by default. Each frame becomes one small
message (tracker/game.py); the game strikes when the slash count goes up, jumps when the jump count goes up, counts body
motion as moving in the freeze trial, and reads each wand's completed shapes. The game also takes the wand (its gate
messages, Pipeline.control): while it is in the room the wand stays on and a shape can be drawn any time (rest the wand,
then draw); when it leaves the wand goes back to the 5 s timer. The slash hold is shortened for play (--slash-hold, 0.5 s)
so the sword can be swung again quickly; the demo keeps 2 s.

It is the only program that opens the webcam, and it has no window of its own by default: it also sends the game a small
mirrored camera picture ~15 times a second (shown in the game's wand panel), and one full-size picture whenever the game's
scanner asks for it. --window opens the old OpenCV debug view as well.

Run from the cv_2/ folder, with the backend running:
    python -m tools.publish                                    # ws://localhost:8000/ws/cv/storybound
    python -m tools.publish --api http://localhost:8020 --room demo --window
"""
from __future__ import annotations

import argparse
import json
import queue
import re
import threading
import time
from typing import Callable

import cv2
from websockets.exceptions import WebSocketException
from websockets.sync.client import ClientConnection, connect

from tracker.capture import Camera
from tracker.config import Config
from tracker.game import game_message, jpeg_message
from tracker.overlay import draw
from tracker.pipeline import Pipeline

ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
SNAPSHOT_WIDTH = 512    # the scanner's picture for Gemini (the game scales scans to 512 px anyway)


def ws_url(api: str, room: str) -> str:
    """The relay address for a backend URL (http -> ws, https -> wss) and room code."""
    if not ROOM_RE.match(room):
        raise ValueError(f"room must be 1-32 letters, digits, _ or -: {room!r}")
    if not re.match(r"^https?://", api):
        raise ValueError(f"--api must start with http:// or https://: {api!r}")
    return f"{'ws' + api[4:].rstrip('/')}/ws/cv/{room}?role=tracker"


class Publisher:
    """Sends the newest message of each kind to the relay on its own thread, so a slow or missing backend never stalls the
    camera loop.

    Each kind ("cv" state, preview "frame", "snapshot") has one slot: a message replaced before it was sent is skipped (the
    counts are cumulative, so no slash or jump is lost, and a stale picture is worthless). While the backend is away it retries
    every retry_s. Messages from the relay (peer notices, the game's requests) are passed to on_message."""

    def __init__(self, url: str, on_message: Callable[[dict], None] | None = None, retry_s: float = 1.0):
        self.url, self.on_message, self.retry_s = url, on_message, retry_s
        self.connected = False
        self._msgs: dict[str, str] = {}
        self._cond = threading.Condition()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="publish", daemon=True)

    def start(self) -> "Publisher":
        self._thread.start()
        return self

    def offer(self, msg: dict, slot: str = "cv") -> None:
        with self._cond:
            self._msgs[slot] = json.dumps(msg)
            self._cond.notify_all()

    def close(self) -> None:
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        self._thread.join(timeout=2)

    def _take(self, timeout: float) -> list[str]:
        with self._cond:
            self._cond.wait_for(lambda: bool(self._msgs) or self._stop.is_set(), timeout)
            msgs = list(self._msgs.values())
            self._msgs.clear()
            return msgs

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                # No permessage-deflate: base64 JPEG barely compresses, so it would only spend CPU on both ends.
                with connect(self.url, open_timeout=self.retry_s, close_timeout=0.5, max_size=None, compression=None) as ws:
                    self.connected = True
                    while not self._stop.is_set():
                        for msg in self._take(0.2):
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


def listener(controls: queue.Queue) -> Callable[[dict], None]:
    """What the relay sends the tracker, queued for the camera loop (it arrives on the sender's thread): the game's gate
    messages and snapshot requests, and None when the game leaves so the wand goes back to its own timer."""
    def on_message(msg: dict) -> None:
        if msg.get("type") == "peer" and msg.get("role") == "game":
            print(f"game {msg.get('state')}")
            if msg.get("state") == "left":
                controls.put(None)
        elif msg.get("type") == "gate" and isinstance(msg.get("on"), bool):
            controls.put(msg)
        elif msg.get("type") == "snapshot" and isinstance(msg.get("id"), int):
            controls.put(msg)
    return on_message


def apply(pipe: Pipeline, msg: dict | None) -> None:
    if msg is None:
        pipe.release()
        print("wand back on its own 5 s timer")
        return
    target = msg.get("target") if isinstance(msg.get("target"), str) else None
    pipe.control(msg["on"], target)
    print(f"game: wand {'on' if msg['on'] else 'off'}, {('draw a ' + target) if target else 'any shape'}")


def main() -> None:
    cfg = Config.from_env()
    ap = argparse.ArgumentParser(description="Send the tracker's slash, jump, motion and wand round to the game.")
    ap.add_argument("--api", default="http://localhost:8000", help="backend URL (default http://localhost:8000)")
    ap.add_argument("--room", default="storybound", help="room code; the game uses ?room=<code> (default storybound)")
    ap.add_argument("--camera", type=int, default=cfg.camera)
    ap.add_argument("--slash-hold", type=float, default=0.5, help="seconds before another slash can count (default 0.5)")
    ap.add_argument("--preview-fps", type=float, default=15, help="camera pictures a second for the game's wand panel (0 = none)")
    ap.add_argument("--preview-width", type=int, default=224, help="width of those pictures in pixels (default 224)")
    ap.add_argument("--window", action="store_true", help="debug: also show the tracker's own OpenCV window (q quits)")
    ap.add_argument("--frames", type=int, default=0, help="stop after N frames (0 = until Ctrl+C)")
    args = ap.parse_args()
    cfg.camera, cfg.slash_hold_s = args.camera, args.slash_hold
    url = ws_url(args.api, args.room)

    pipe, controls = Pipeline(cfg), queue.Queue()
    cam = Camera(cfg.camera, cfg.width, cfg.height).start()
    pub = Publisher(url, listener(controls)).start()
    print(f"Publishing to {url} (Ctrl+C stops)")
    print("jump detection: " + ("off" if not cfg.jump else "rise (fires on the way up)" if cfg.jump_mode == "rise"
                                else "full (fires at the landing)"))
    seq, n, connected, counts, last_preview = 0, 0, None, (0, 0), 0.0
    try:
        while not args.frames or n < args.frames:
            seq, frame = cam.read(seq)
            if frame is None:
                continue
            while not controls.empty():
                msg = controls.get_nowait()
                if msg and msg.get("type") == "snapshot":     # the game's scanner wants a picture: one full-size, unmirrored
                    pub.offer(jpeg_message("snapshot", frame, SNAPSHOT_WIDTH, 82, False, id=msg["id"]), "snapshot")
                else:
                    apply(pipe, msg)
            payload = pipe.process(frame)
            pub.offer(game_message(payload))
            now_s = time.monotonic()
            # Pictures can only go out on camera frames, which come at a fixed rate: allowing 10 % early keeps 15/s on every
            # 2nd frame of a 30 fps camera, where waiting for a full 1/15 s would often slip to the 3rd (uneven, ~10/s).
            if args.preview_fps > 0 and now_s - last_preview >= 0.9 / args.preview_fps:
                pub.offer(jpeg_message("frame", frame, args.preview_width, 55, cfg.mirror), "frame")
                last_preview = now_s
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
