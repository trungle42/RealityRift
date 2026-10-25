"""Presence relay: up to three laptops, each running its own game, see each other's heroes.

Every player runs their own game, backend, tracker and phone; the host's backend is also the meeting point. Each game joins
WS /ws/presence/{room}?name=<name>&colour=red|blue|yellow (teammates through the host's internet tunnel, see tunnel.py) and
gets {"type":"welcome","id","peers":[{id,name,colour}]}; the others hear {"type":"peer","state":"joined"|"left",id,name,colour}.
From then on each game sends its hero's {"type":"state",x,y,z,heading,speed,anim,hp} and cosmetic
{"type":"fx",kind,x,y,z,dx,dz,ability?,element?}; the relay rebuilds them from known fields (numbers finite and clamped, names
from fixed lists), stamps the sender's id and passes them to everyone else. Anything else is dropped, messages are capped at
MAX_MSG bytes and RATE a second per player, and nothing is stored. A fourth player gets {"type":"full"} and a close (the
game keeps retrying). The same name and colour joining again (a reloaded or relaunched game, or an old tab still open) takes
over that player's slot: the old connection gets {"type":"replaced"} and a close, so a stale tab never fills the room.

Fighting together: {"type":"start"} from any game starts the run on the others (once per room; the welcome says
"started" so a late or reloaded game starts at once), and {"type":"hit",enemy,damage} shares one player's damage to an
encounter foe (the wave and the boss spawn in the same order on every laptop, so their ids match), so everyone wears
down the same horde and the same boss. The host (the room's first player) runs the encounter foes and sends
{"type":"foes","f":[[enemy,x,z,heading,windup 0|1,attack 0|1|2],...]} ten times a second; the others draw those foes
where the host's are, so everyone sees the same monsters in the same places. The tunnel's random room code is the only "auth", as for the phone joystick.
"""
from __future__ import annotations

import asyncio
import json
import math
import re
import time
from typing import Dict, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
NAME_RE = re.compile(r"^[A-Za-z0-9 _-]{1,16}$")
COLOURS = ("red", "blue", "yellow")
ANIMS = ("idle", "walk", "run", "strike", "roll", "jump", "cast", "hurt", "dead", "pose")
FX = ("cast", "slash")
ABILITIES = ("wave", "bolt", "nova", "pierce", "meteor", "chain")      # schemas.Ability
ELEMENTS = ("fire", "water", "lightning", "ice", "nature", "shadow", "light")   # schemas.Element
ENEMY_RE = re.compile(r"^[a-z0-9:_-]{1,16}$")
MAX_PEERS, MAX_MSG, RATE = 3, 512, 60
MAX_FOES = 12
MAX_DAMAGE = 100.0
WORLD, LOW, HIGH = 5000.0, -100.0, 1000.0

_rooms: Dict[str, Dict[WebSocket, dict]] = {}  # room -> socket -> {"id", "name", "colour"}
_started: set = set()                          # rooms whose run has started


def _num(v: object, lo: float, hi: float) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return round(min(float(hi), max(float(lo), float(v))), 3)


def _heading(v: object) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return round(math.atan2(math.sin(v), math.cos(v)), 3)


def clean_presence(msg: object) -> Optional[dict]:
    """A hero's state or a cosmetic effect, rebuilt from known fields; None for anything else or anything malformed."""
    if not isinstance(msg, dict):
        return None
    if msg.get("type") == "start":
        return {"type": "start"}
    if msg.get("type") == "foes":
        raw = msg.get("f")
        if not isinstance(raw, list) or len(raw) > MAX_FOES:
            return None
        foes = []
        for e in raw:
            if not (isinstance(e, list) and len(e) == 6 and isinstance(e[0], str) and ENEMY_RE.match(e[0])):
                return None
            x, z, h = _num(e[1], -WORLD, WORLD), _num(e[2], -WORLD, WORLD), _heading(e[3])
            if None in (x, z, h) or isinstance(e[4], bool) or isinstance(e[5], bool) or e[4] not in (0, 1) or e[5] not in (0, 1, 2):
                return None
            foes.append([e[0], x, z, h, int(e[4]), int(e[5])])
        return {"type": "foes", "f": foes}
    if msg.get("type") == "hit":
        damage = _num(msg.get("damage"), 0, MAX_DAMAGE)
        enemy = msg.get("enemy")
        if damage is None or not isinstance(enemy, str) or not ENEMY_RE.match(enemy):
            return None
        return {"type": "hit", "enemy": enemy, "damage": damage}
    pos = {k: _num(msg.get(k), lo, hi) for k, lo, hi in (("x", -WORLD, WORLD), ("y", LOW, HIGH), ("z", -WORLD, WORLD))}
    if None in pos.values():
        return None
    if msg.get("type") == "state":
        heading, speed, hp = _heading(msg.get("heading")), _num(msg.get("speed"), 0, 50), _num(msg.get("hp"), 0, 10)
        if heading is None or speed is None or hp is None or msg.get("anim") not in ANIMS:
            return None
        return {"type": "state", **pos, "heading": heading, "speed": speed, "anim": msg["anim"], "hp": hp}
    if msg.get("type") == "fx":
        dx, dz = _num(msg.get("dx"), -1, 1), _num(msg.get("dz"), -1, 1)
        if dx is None or dz is None or msg.get("kind") not in FX:
            return None
        out = {"type": "fx", "kind": msg["kind"], **pos, "dx": dx, "dz": dz}
        if msg.get("ability") in ABILITIES:
            out["ability"] = msg["ability"]
        if msg.get("element") in ELEMENTS:
            out["element"] = msg["element"]
        return out
    return None


async def _send_all(targets, text: str) -> None:
    for ws in list(targets):
        try:
            await ws.send_text(text)
        except Exception:
            pass


async def _retire(ws: WebSocket) -> None:
    """Tell a connection its player joined again elsewhere, then close it; a dead one (the tunnel has not noticed yet)
    is given up on after a second rather than holding up the new join."""
    try:
        await asyncio.wait_for(ws.send_text(json.dumps({"type": "replaced"})), 1.0)
        await asyncio.wait_for(ws.close(code=4000), 1.0)
    except Exception:
        pass


@router.websocket("/ws/presence/{room}")
async def presence_ws(ws: WebSocket, room: str, name: str = "", colour: str = ""):
    name = name.strip()
    if not ROOM_RE.match(room) or not NAME_RE.match(name) or colour not in COLOURS:
        await ws.close(code=1008)
        return
    await ws.accept()
    peers = _rooms.setdefault(room, {})
    for old, them in list(peers.items()):
        if them["name"] == name and them["colour"] == colour:
            del peers[old]
            await _send_all(peers, json.dumps({"type": "peer", "state": "left", **them}))
            await _retire(old)
    free = [n for n in range(MAX_PEERS) if n not in {p["id"] for p in peers.values()}]
    if not free:
        await ws.send_text(json.dumps({"type": "full"}))
        await ws.close(code=1008)
        return
    me = {"id": free[0], "name": name, "colour": colour}
    await ws.send_text(json.dumps({"type": "welcome", "id": me["id"], "peers": sorted(peers.values(), key=lambda p: p["id"]),
                                  "started": room in _started}))
    await _send_all(peers, json.dumps({"type": "peer", "state": "joined", **me}))
    peers[ws] = me
    window, sent = 0.0, 0
    try:
        while True:
            text = await ws.receive_text()
            if peers.get(ws) is not me:     # replaced: its id may already belong to the new connection
                break
            now = time.monotonic()
            if now - window >= 1.0:
                window, sent = now, 0
            sent += 1
            if sent > RATE or len(text.encode("utf-8")) > MAX_MSG:
                continue
            try:
                msg = clean_presence(json.loads(text))
            except ValueError:
                continue
            if msg and msg["type"] == "start":
                if room in _started:
                    continue                # the others have already been started
                _started.add(room)
            if msg:
                await _send_all([p for p in peers if p is not ws], json.dumps({**msg, "id": me["id"]}))
    except (WebSocketDisconnect, RuntimeError):     # RuntimeError: receiving on a socket the relay closed (replaced)
        pass
    finally:
        if peers.get(ws) is me:     # a replaced connection's leaving was announced when it was replaced
            del peers[ws]
            await _send_all(peers, json.dumps({"type": "peer", "state": "left", **me}))
        if not peers and _rooms.get(room) is peers:
            _rooms.pop(room, None)
            _started.discard(room)
