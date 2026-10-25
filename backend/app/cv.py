"""Body-tracker relay.

The webcam tracker in cv_2/ (`python -m tools.publish`) joins /ws/cv/{room}?role=tracker and sends one message per frame; the
game joins the same room with role=game and receives it. Tracker -> game is {"type":"cv","slash","jump","motion","wand"}; game ->
tracker is {"type":"gate","on","target"} (relayed so the game can later drive the wand round; the tracker does not act on it yet).
Every message is rebuilt from known fields with types checked and sizes capped, so neither side can push arbitrary data into the
other. The room code is the only "auth", as for the joystick.
"""
from __future__ import annotations

import json
import math
import re
from typing import Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,15}$")  # wand colours and shape names
MAX_MSG = 65536  # a full 5 s wand round of three traces is ~10 KB
MAX_COLOURS, MAX_POINTS = 8, 400  # per message / per colour, across its segments

_rooms: Dict[str, Dict[str, set]] = {}  # room -> role -> sockets


def _number(v: object) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def _count(v: object) -> Optional[int]:
    n = _number(v)
    return int(n) if n is not None and n >= 0 and n == int(n) else None


def _unit(v: object) -> Optional[float]:
    n = _number(v)
    return None if n is None else round(min(1.0, max(0.0, n)), 4)


def _name(v: object) -> Optional[str]:
    return v if isinstance(v, str) and NAME_RE.match(v) else None


def _per_colour(v: object, clean) -> dict:
    """{colour: clean(value)} for at most MAX_COLOURS valid colour names; anything else is dropped."""
    if not isinstance(v, dict):
        return {}
    return {k: clean(x) for k, x in list(v.items())[:MAX_COLOURS] if _name(k)}


def _shape(v: object) -> Optional[dict]:
    if not isinstance(v, dict):
        return None
    score = _number(v.get("score"))
    return None if score is None else {"shape": _name(v.get("shape")), "score": round(score, 4)}


def _trace(v: object) -> list:
    """Segments of [x, y] points in 0-1; bad points are skipped and the colour keeps at most MAX_POINTS."""
    segments, left = [], MAX_POINTS
    for seg in v if isinstance(v, list) else []:
        points = []
        for p in seg if isinstance(seg, list) else []:
            xy = [_unit(c) for c in p] if isinstance(p, list) and len(p) == 2 else [None]
            if left > 0 and None not in xy:
                points.append(xy)
                left -= 1
        if points:
            segments.append(points)
    return segments


def clean_wand(w: object) -> Optional[dict]:
    if not isinstance(w, dict):
        return None
    seconds = _number(w.get("secondsLeft"))
    if not isinstance(w.get("active"), bool) or seconds is None:
        return None
    return {
        "active": w["active"], "secondsLeft": round(max(0.0, seconds), 2),
        "target": _name(w.get("target")), "next": _name(w.get("next")),
        "shapes": _per_colour(w.get("shapes"), _shape),
        "complete": _per_colour(w.get("complete"), lambda x: x is True),
        "traces": _per_colour(w.get("traces"), _trace),
    }


def clean_tracker(msg: object) -> Optional[dict]:
    """A tracker frame for the game, or None. slash/jump are running counts (the game acts when one goes up); motion is the
    fraction of the picture moving, or null. A malformed wand block becomes null without losing the rest."""
    if not isinstance(msg, dict) or msg.get("type") != "cv":
        return None
    slash, jump = _count(msg.get("slash")), _count(msg.get("jump"))
    if slash is None or jump is None:
        return None
    return {"type": "cv", "slash": slash, "jump": jump, "motion": _unit(msg.get("motion")), "wand": clean_wand(msg.get("wand"))}


def clean_control(msg: object) -> Optional[dict]:
    """A control message for the tracker, or None: start/stop the wand round, optionally naming the shape to draw."""
    if not isinstance(msg, dict) or msg.get("type") != "gate" or not isinstance(msg.get("on"), bool):
        return None
    return {"type": "gate", "on": msg["on"], "target": _name(msg.get("target"))}


async def _send_all(targets: set, text: str) -> None:
    for ws in list(targets):
        try:
            await ws.send_text(text)
        except Exception:
            targets.discard(ws)


@router.websocket("/ws/cv/{room}")
async def cv_ws(ws: WebSocket, room: str, role: str = "game"):
    if not ROOM_RE.match(room) or role not in ("tracker", "game"):
        await ws.close(code=1008)
        return
    await ws.accept()
    peers = _rooms.setdefault(room, {"tracker": set(), "game": set()})
    peers[role].add(ws)
    other = "game" if role == "tracker" else "tracker"
    clean = clean_tracker if role == "tracker" else clean_control
    await _send_all(peers[other], json.dumps({"type": "peer", "role": role, "state": "joined"}))
    if peers[other]:
        await ws.send_text(json.dumps({"type": "peer", "role": other, "state": "joined"}))
    try:
        while True:
            text = await ws.receive_text()
            if len(text) > MAX_MSG:
                continue
            try:
                msg = clean(json.loads(text))
            except ValueError:
                continue
            if msg:
                await _send_all(peers[other], json.dumps(msg))
    except WebSocketDisconnect:
        pass
    finally:
        peers[role].discard(ws)
        await _send_all(peers[other], json.dumps({"type": "peer", "role": role, "state": "left"}))
        if not peers["tracker"] and not peers["game"]:
            _rooms.pop(room, None)
