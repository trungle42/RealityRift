"""Internet tunnel for the phone joystick (`scripts/demo.sh --tunnel`, cloudflared): its public URL, and its lockdown.

Venue Wi-Fi often blocks phone-to-laptop traffic, so the launcher can expose this backend through a Cloudflare quick tunnel.
Tunnel requests reach uvicorn from 127.0.0.1, so the loopback checks (cv.client_allowed) would let them through as if they
were this laptop. Cloudflare always adds its own headers, which a visitor cannot remove, so any request that carries one is
treated as coming from the internet and may only fetch the phone page (GET /joystick) and join a room as a phone
(WS /ws/joystick/{room}?role=phone). Everything else, the API with the Gemini key behind it, the camera relay, the game's
side of the joystick relay, /docs and /joystick/info, answers 403 or closes the socket with 1008.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs

from starlette.types import ASGIApp, Receive, Scope, Send

# Added by Cloudflare (and by most other proxies) to every proxied request.
TUNNEL_HEADERS = (b"cf-connecting-ip", b"cf-ray", b"x-forwarded-for", b"cdn-loop", b"cf-visitor", b"forwarded", b"x-real-ip")
PHONE_WS_RE = re.compile(r"^/ws/joystick/[A-Za-z0-9_-]{1,32}$")

# Written by the launcher once cloudflared prints its URL, removed when it stops; read on every /joystick/info request so a
# running backend picks up a new tunnel without a restart. PUBLIC_URL (environment) takes its place if set.
PUBLIC_URL_FILE = Path(__file__).resolve().parent.parent / ".public_url"
PUBLIC_URL_RE = re.compile(r"^https://[A-Za-z0-9.-]+(:\d{1,5})?$")


def public_url() -> Optional[str]:
    """The tunnel's https origin for the phone's QR code, or None without a tunnel (or with anything that is not one)."""
    raw = os.getenv("PUBLIC_URL", "")
    if not raw:
        try:
            raw = PUBLIC_URL_FILE.read_text(encoding="utf-8")
        except OSError:
            return None
    raw = raw.strip().rstrip("/")
    return raw if PUBLIC_URL_RE.match(raw) else None


def via_tunnel(scope: Scope) -> bool:
    return any(name in TUNNEL_HEADERS for name, _ in scope.get("headers", ()))


def tunnel_allowed(scope: Scope) -> bool:
    """What an internet visitor may reach: the phone page, and a room as a phone."""
    path = scope.get("path", "")
    if scope["type"] == "http":
        return scope.get("method") in ("GET", "HEAD") and path == "/joystick"
    if scope["type"] == "websocket":
        roles = parse_qs(scope.get("query_string", b"").decode("latin-1")).get("role", ["phone"])
        return bool(PHONE_WS_RE.match(path)) and roles == ["phone"]
    return False


class TunnelGuard:
    """ASGI middleware: requests that came through a tunnel get only what tunnel_allowed() lets through."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket") or not via_tunnel(scope) or tunnel_allowed(scope):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await receive()   # websocket.connect
            await send({"type": "websocket.close", "code": 1008})
            return
        body = b'{"detail":"not available through the tunnel"}'
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
