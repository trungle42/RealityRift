"""Phone-as-joystick relay.

A phone opens /joystick and streams a thumb-stick vector over /ws/joystick/{room}?role=phone. The game joins the
same room with role=game and receives the validated messages: {"type":"move","x","y","sprint"} (numbers clamped to the
unit disc) and the phone's buttons {"type":"action"|"scan"|"roll"|"slash"}; anything else is dropped, so a phone cannot
push arbitrary data into the game, and nothing goes from the game to a phone.

Players: up to MAX_PHONES phones per room. Each gets the lowest free slot when it joins (freed when it leaves) and is told
it with {"type":"slot","player":n}; every message it sends reaches the game stamped "player": n, and the game's peer
notices are {"type":"peer","role":"phone","state":"joined"|"left","player":n}. One more phone gets {"type":"full"} and a
close. The relay itself only ever sends a phone its slot, "full" and the game's peer notices.

Phones join from anywhere on the network (that is the point). The game side is this laptop's own page only, the same rule
as the camera relay (cv.client_allowed / cv.origin_allowed): otherwise another machine on the Wi-Fi, or another site open
in the player's browser, could join as the game and read or spoof the controls. The room code is the only other "auth".
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

from .cv import client_allowed, origin_allowed
from .tunnel import public_url

router = APIRouter()
STATIC = Path(__file__).resolve().parent.parent / "static"
ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
MAX_MSG = 512

_rooms: Dict[str, Dict[str, set]] = {}  # room -> role -> sockets
_slots: Dict[str, Dict[WebSocket, int]] = {}  # room -> phone socket -> player slot


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


COMMANDS = ("action", "scan", "roll", "slash")
MAX_PHONES = 3


def clean_phone(msg: object) -> Optional[dict]:
    """A move, or one of the phone's buttons (a quick tap = action, Scan, Roll, Slash), rebuilt; None for anything else."""
    if isinstance(msg, dict) and msg.get("type") in COMMANDS:
        return {"type": msg["type"]}
    return clean_move(msg)


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
    """Where phones can reach this backend: its Wi-Fi address and, with `demo.sh --tunnel`, the tunnel's https URL."""
    return {"lan_ip": lan_ip(), "public_url": public_url()}


async def _send_all(targets: set, text: str) -> None:
    for ws in list(targets):
        try:
            await ws.send_text(text)
        except Exception:
            targets.discard(ws)


@router.websocket("/ws/joystick/{room}")
async def joystick_ws(ws: WebSocket, room: str, role: str = "phone"):
    game_refused = role == "game" and not (client_allowed(ws.client.host if ws.client else None) and origin_allowed(ws.headers.get("origin")))
    if not ROOM_RE.match(room) or role not in ("phone", "game") or game_refused:
        await ws.close(code=1008)
        return
    await ws.accept()
    peers = _rooms.setdefault(room, {"phone": set(), "game": set()})
    slots = _slots.setdefault(room, {})
    player = None
    if role == "phone":
        free = [n for n in range(MAX_PHONES) if n not in slots.values()]
        if not free:
            await ws.send_text(json.dumps({"type": "full"}))
            await ws.close(code=1008)
            if not peers["phone"] and not peers["game"]:
                _rooms.pop(room, None)
                _slots.pop(room, None)
            return
        player = slots[ws] = free[0]
        await ws.send_text(json.dumps({"type": "slot", "player": player}))
    peers[role].add(ws)
    other = "game" if role == "phone" else "phone"
    await _send_all(peers[other], json.dumps(_peer(role, "joined", player)))
    # Tell a newcomer who is already here (the game wants to know which phones are connected).
    if role == "game":
        for slot in sorted(slots.values()):
            await ws.send_text(json.dumps(_peer("phone", "joined", slot)))
    elif peers["game"]:
        await ws.send_text(json.dumps(_peer("game", "joined")))
    try:
        while True:
            text = await ws.receive_text()
            if len(text) > MAX_MSG or role != "phone":
                continue
            try:
                msg = clean_phone(json.loads(text))
            except ValueError:
                continue
            if msg:
                await _send_all(peers["game"], json.dumps({**msg, "player": player}))
    except WebSocketDisconnect:
        pass
    finally:
        peers[role].discard(ws)
        slots.pop(ws, None)
        await _send_all(peers[other], json.dumps(_peer(role, "left", player)))
        if not peers["phone"] and not peers["game"]:
            _rooms.pop(room, None)
            _slots.pop(room, None)


def _peer(role: str, state: str, player: Optional[int] = None) -> dict:
    """A peer notice; a phone's carries its player slot."""
    return {"type": "peer", "role": role, "state": state, **({"player": player} if player is not None else {})}
