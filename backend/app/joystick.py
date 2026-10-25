"""Phone-as-joystick relay.

A phone opens /joystick and streams a thumb-stick vector over /ws/joystick/{room}?role=phone. The game joins the
same room with role=game and receives the validated vector. Only {"type":"move","x","y","sprint"} is forwarded:
numbers are clamped to the unit disc and anything else is dropped, so a phone cannot push arbitrary data into the game.
The room code is the only "auth", which is fine for a demo on a private network or tunnel.
"""
from __future__ import annotations

import json
import math
import re
import socket
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

router = APIRouter()
STATIC = Path(__file__).resolve().parent.parent / "static"
ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MAX_MSG = 512

_rooms: Dict[str, Dict[str, set]] = {}  # room -> role -> sockets


def clean_move(msg: object) -> Optional[dict]:
    """Return a sanitized move message, or None if it is not a valid one."""
    if not isinstance(msg, dict) or msg.get("type") != "move":
        return None
    try:
        x, y = float(msg.get("x", 0)), float(msg.get("y", 0))
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(x) and math.isfinite(y)):
        return None
    length = math.hypot(x, y)
    if length > 1:
        x, y = x / length, y / length
    return {"type": "move", "x": round(x, 3), "y": round(y, 3), "sprint": msg.get("sprint") is True}


def lan_ip() -> Optional[str]:
    """Best-effort address a phone on the same Wi-Fi can reach (no packets are sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


@router.get("/joystick")
def joystick_page():
    return FileResponse(STATIC / "joystick.html")


@router.get("/joystick/info")
def joystick_info():
    return {"lan_ip": lan_ip()}


async def _send_all(targets: set, text: str) -> None:
    for ws in list(targets):
        try:
            await ws.send_text(text)
        except Exception:
            targets.discard(ws)


@router.websocket("/ws/joystick/{room}")
async def joystick_ws(ws: WebSocket, room: str, role: str = "phone"):
    if not ROOM_RE.match(room) or role not in ("phone", "game"):
        await ws.close(code=1008)
        return
    await ws.accept()
    peers = _rooms.setdefault(room, {"phone": set(), "game": set()})
    peers[role].add(ws)
    other = "game" if role == "phone" else "phone"
    await _send_all(peers[other], json.dumps({"type": "peer", "role": role, "state": "joined"}))
    # Tell a newcomer who is already here (the game wants to know a phone is connected).
    for existing in ("phone", "game"):
        if existing != role and peers[existing]:
            await ws.send_text(json.dumps({"type": "peer", "role": existing, "state": "joined"}))
    try:
        while True:
            text = await ws.receive_text()
            if len(text) > MAX_MSG or role != "phone":
                continue
            try:
                msg = clean_move(json.loads(text))
            except ValueError:
                continue
            if msg:
                await _send_all(peers["game"], json.dumps(msg))
    except WebSocketDisconnect:
        pass
    finally:
        peers[role].discard(ws)
        await _send_all(peers[other], json.dumps({"type": "peer", "role": role, "state": "left"}))
        if not peers["phone"] and not peers["game"]:
            _rooms.pop(room, None)
