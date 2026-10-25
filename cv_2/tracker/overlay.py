from __future__ import annotations

import cv2
import numpy as np

from .config import ColorSpec
from .detector import ColorDetector, to_hsv
from .shapes import outline

FONT = cv2.FONT_HERSHEY_SIMPLEX
ON, OFF = (80, 200, 120), (70, 70, 230)
WHITE = (255, 255, 255)


def _text(out: np.ndarray, s: str, org: tuple[int, int], scale: float, color: tuple[int, int, int]) -> None:
    cv2.putText(out, s, org, FONT, scale, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(out, s, org, FONT, scale, color, 2, cv2.LINE_AA)


def _guide(out: np.ndarray, shape: str, size: int = 84) -> None:
    """The preset drawn small in the top-right corner, so the user can see what to trace."""
    h, w = out.shape[:2]
    x0, y0 = w - size - 12, 48
    cv2.rectangle(out, (x0, y0), (x0 + size, y0 + size), (0, 0, 0), -1)
    pts = np.array([(x0 + size / 2 + 0.4 * size * x, y0 + size / 2 - 0.4 * size * y) for x, y in outline(shape)], np.int32)
    cv2.polylines(out, [pts], True, WHITE, 2, cv2.LINE_AA)


def _verdict(r: dict | None, target: str) -> tuple[str, tuple[int, int, int]]:
    """Text and colour for one colour's recognition result against the shape that was asked for."""
    if r is None:
        return "...", WHITE
    if r["shape"] is None:
        return "unknown", OFF
    return (f"{r['shape']}  OK", ON) if r["shape"] == target else (r["shape"], WHITE)


def _shape_panel(out: np.ndarray, payload: dict, colors: dict[str, ColorSpec]) -> None:
    """What to draw and what the recogniser sees: live while ON; the finished round's result while OFF."""
    active = payload["active"]
    if active:
        target, shapes = payload["target"], payload["shapes"]
        _text(out, f"Draw: {target.upper()}", (10, 66), 0.8, WHITE)
        _guide(out, target)
    else:
        prev = payload["previous"]
        target, shapes = (prev["target"], prev["shapes"]) if prev else (None, {})
        _text(out, f"Next: {payload['next'].upper()}", (10, 66), 0.8, WHITE)
        _guide(out, payload["next"])
        if prev:
            _text(out, f"Last round: {target}", (10, 92), 0.55, WHITE)
    y = 92 if active else 116
    if not active and prev and not any(shapes.values()):
        _text(out, "no closed shape drawn", (10, y), 0.6, WHITE)
    for name, r in shapes.items():
        # A colour with nothing to report (not being drawn with, or no closed shape yet) is left out.
        if (active and not payload["traces"][name]) or (not active and r is None):
            continue
        label, color = _verdict(r, target)
        _text(out, f"{name}: ", (10, y), 0.6, colors[name].bgr)
        _text(out, label, (10 + cv2.getTextSize(f"{name}: ", FONT, 0.6, 2)[0][0], y), 0.6, color)
        y += 24


def _slash_banner(out: np.ndarray, slash: dict | None, hold_s: float = 2.0) -> None:
    """A big "SLASHED!" across the middle for as long as the slash state lasts, with the time left under it."""
    if not slash or not slash["active"]:
        return
    h, w = out.shape[:2]
    text, scale = "SLASHED!", 2.2
    tw, th = cv2.getTextSize(text, FONT, scale, 6)[0]
    x, y = (w - tw) // 2, h // 2 + th // 2
    cv2.rectangle(out, (x - 24, y - th - 24), (x + tw + 24, y + 40), (0, 0, 0), -1)
    cv2.putText(out, text, (x, y), FONT, scale, (60, 60, 255), 6, cv2.LINE_AA)
    cv2.rectangle(out, (x - 24, y + 28), (x - 24 + int((tw + 48) * min(1.0, slash["secondsLeft"] / hold_s)), y + 38),
                  (60, 60, 255), -1)


def _jump_banner(out: np.ndarray, jump: dict | None, hold_s: float = 2.0) -> None:
    """"JUMPED!" in the upper part of the picture (SLASHED! is in the middle) for as long as the jump state lasts."""
    if not jump or not jump["active"]:
        return
    h, w = out.shape[:2]
    text, scale = "JUMPED!", 2.0
    tw, th = cv2.getTextSize(text, FONT, scale, 6)[0]
    x, y = (w - tw) // 2, h // 4 + th // 2
    cv2.rectangle(out, (x - 24, y - th - 24), (x + tw + 24, y + 40), (0, 0, 0), -1)
    cv2.putText(out, text, (x, y), FONT, scale, (0, 200, 255), 6, cv2.LINE_AA)
    cv2.rectangle(out, (x - 24, y + 28), (x - 24 + int((tw + 48) * min(1.0, jump["secondsLeft"] / hold_s)), y + 38),
                  (0, 200, 255), -1)


def draw(frame: np.ndarray, payload: dict, period_s: float, colors: dict[str, ColorSpec],
         slash_hold_s: float = 2.0, jump_hold_s: float = 2.0, debug: bool = False) -> np.ndarray:
    """Draw every colour's trace and marker plus the on/off status onto a copy of the frame.
    Payload x is mirrored when payload["mirrored"], so the frame is flipped to match. `colors` may include "phone"."""
    out = cv2.flip(frame, 1) if payload.get("mirrored") else frame.copy()
    h, w = out.shape[:2]

    for name, segments in payload["traces"].items():
        color = colors[name].bgr
        for seg in segments:
            pts = [(int(x * w), int(y * h)) for x, y in seg]
            n = len(pts)
            # Older parts of the path are thinner, so the direction of travel reads at a glance.
            for i in range(1, n):
                cv2.line(out, pts[i - 1], pts[i], color, 1 + 4 * i // n, cv2.LINE_AA)
            if n == 1:
                cv2.circle(out, pts[0], 2, color, -1, cv2.LINE_AA)

    for name, obj in payload["objects"].items():
        if not obj:
            continue
        c, r = (int(obj["x"] * w), int(obj["y"] * h)), max(6, int(obj["radius"] * w))
        cv2.circle(out, c, r + 2, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.circle(out, c, r + 5, colors[name].bgr, 2, cv2.LINE_AA)
        cv2.putText(out, name, (c[0] - r, max(54, c[1] - r - 10)), FONT, 0.5, (255, 255, 255), 2, cv2.LINE_AA)

    phone, spec = payload.get("phone"), colors.get("phone")
    if phone and spec:
        c, r = (int(phone["x"] * w), int(phone["y"] * h)), max(6, int(phone["radius"] * w))
        cv2.circle(out, c, r + 2, WHITE, 2, cv2.LINE_AA)
        cv2.circle(out, c, r + 5, spec.bgr, 2, cv2.LINE_AA)
        cv2.putText(out, "phone", (c[0] - r, max(54, c[1] - r - 10)), FONT, 0.5, WHITE, 2, cv2.LINE_AA)

    active, left = payload["active"], payload["secondsLeft"]
    color = ON if active else OFF
    cv2.rectangle(out, (0, 0), (w, 34), (0, 0, 0), -1)
    label = f"DETECTION {'ON' if active else 'OFF'}  switches in {left:.1f}s"
    cv2.putText(out, label, (10, 24), FONT, 0.65, color, 2, cv2.LINE_AA)
    cv2.rectangle(out, (0, 34), (int(w * (left / period_s)), 38), color, -1)
    _shape_panel(out, payload, colors)
    _slash_banner(out, payload.get("slash"), slash_hold_s)
    _jump_banner(out, payload.get("jump"), jump_hold_s)
    m = payload.get("motion")
    if debug and m:   # live sensor values, for tuning the jump thresholds
        cv2.putText(out, f"vy {m['vy']:+.2f}  vx {m['vx']:+.2f}  area {m['area']:.2f}", (8, h - 34), FONT, 0.5, WHITE, 1, cv2.LINE_AA)
    if not active:
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), color, 4)
        cv2.putText(out, "paused - traces erased", (10, h - 12), FONT, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def mask_view(frame: np.ndarray, detectors: dict[str, ColorDetector], mirror: bool) -> np.ndarray:
    """What each detector counts as its colour, painted in that colour on black."""
    hsv = to_hsv(frame)
    out = np.zeros_like(frame)
    for det in detectors.values():
        out[det.mask(hsv) > 0] = det.spec.bgr
    return cv2.flip(out, 1) if mirror else out
