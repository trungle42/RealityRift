"""Body-tracker relay.

The webcam tracker in cv_2/ (`python -m tools.publish`) joins /ws/cv/{room}?role=tracker and sends one message per frame; the
game joins the same room with role=game and receives it. Tracker -> game is {"type":"cv","slash","jump","motion","phone","wand"},
the camera picture {"type":"frame","w","h","jpeg"} (the tracker is the only program that opens the webcam) and, on request, one
full-size {"type":"snapshot","id","w","h","jpeg"}. Game -> tracker is {"type":"gate","on","target"}, which tools.publish applies
(Pipeline.control: the game drives the wand while it is here), and {"type":"snapshot","id"} (the scanner wants a picture).
Pictures are only passed on, never stored, and must be base64 JPEG under a size cap.
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
JPEG_RE = re.compile(r"^/9j/[A-Za-z0-9+/]*={0,2}$")  # base64 of a JPEG (FF D8 FF ...)
MAX_FRAME, MAX_SNAPSHOT = 24_000, 200_000  # base64 characters: a 224 px preview is ~6-10 KB, a 512 px snapshot ~40-80 KB
MAX_MSG = MAX_SNAPSHOT + 1000  # a full 5 s wand round of three traces is ~10 KB
MAX_COLOURS, MAX_POINTS = 8, 400  # per message / per colour, across its segments
MAX_SIDE, MAX_ID = 2048, 2**31 - 1

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


def _point(v: object) -> Optional[dict]:
    if not isinstance(v, dict):
        return None
    x, y, r = _unit(v.get("x")), _unit(v.get("y")), _unit(v.get("radius"))
    return None if None in (x, y, r) else {"x": x, "y": y, "radius": r}


def _request_id(v: object) -> Optional[int]:
    n = _count(v)
    return n if n is not None and n <= MAX_ID else None


def _image(msg: dict, cap: int) -> Optional[dict]:
    """w, h and a base64 JPEG within `cap` characters, or None."""
    w, h, jpeg = _count(msg.get("w")), _count(msg.get("h")), msg.get("jpeg")
    if not w or not h or w > MAX_SIDE or h > MAX_SIDE or not isinstance(jpeg, str) or len(jpeg) > cap or not JPEG_RE.match(jpeg):
        return None
    return {"w": w, "h": h, "jpeg": jpeg}


def clean_tracker(msg: object) -> Optional[dict]:
    """A tracker message for the game, or None. "cv": slash/jump are running counts (the game acts when one goes up); motion is
    the fraction of the picture moving, or null; phone is the marker, or null; a malformed wand block becomes null without
    losing the rest. "frame" / "snapshot": a camera picture under its cap (a snapshot echoes the game's request id)."""
    if not isinstance(msg, dict):
        return None
    if msg.get("type") == "frame":
        image = _image(msg, MAX_FRAME)
        return None if image is None else {"type": "frame", **image}
    if msg.get("type") == "snapshot":
        image, request = _image(msg, MAX_SNAPSHOT), _request_id(msg.get("id"))
        return None if image is None or request is None else {"type": "snapshot", "id": request, **image}
    if msg.get("type") != "cv":
        return None
    slash, jump = _count(msg.get("slash")), _count(msg.get("jump"))
    if slash is None or jump is None:
        return None
    return {"type": "cv", "slash": slash, "jump": jump, "motion": _unit(msg.get("motion")), "phone": _point(msg.get("phone")),
            "wands": _per_colour(msg.get("wands"), _point), "wand": clean_wand(msg.get("wand"))}


def clean_control(msg: object) -> Optional[dict]:
    """A request for the tracker, or None: start/stop the wand round, optionally naming the shape to draw; or one picture."""
    if not isinstance(msg, dict):
        return None
    if msg.get("type") == "snapshot":
        request = _request_id(msg.get("id"))
        return None if request is None else {"type": "snapshot", "id": request}
    if msg.get("type") != "gate" or not isinstance(msg.get("on"), bool):
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
