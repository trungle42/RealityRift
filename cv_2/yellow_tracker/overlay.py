from __future__ import annotations

import cv2
import numpy as np

FONT = cv2.FONT_HERSHEY_SIMPLEX
TRAIL = (0, 215, 255)  # BGR gold, readable against both skin and the yellow object
ON, OFF = (80, 200, 120), (70, 70, 230)


def draw(frame: np.ndarray, payload: dict, period_s: float) -> np.ndarray:
    """Draw the trace, the current detection and the on/off status onto a copy of the frame.
    Payload x is mirrored when payload["mirrored"], so the frame is flipped to match."""
    out = cv2.flip(frame, 1) if payload.get("mirrored") else frame.copy()
    h, w = out.shape[:2]

    for seg in payload["trace"]:
        pts = [(int(x * w), int(y * h)) for x, y in seg]
        n = len(pts)
        # Older parts of the path are thinner, so the direction of travel reads at a glance.
        for i in range(1, n):
            cv2.line(out, pts[i - 1], pts[i], TRAIL, 1 + 4 * i // n, cv2.LINE_AA)
        if n == 1:
            cv2.circle(out, pts[0], 2, TRAIL, -1, cv2.LINE_AA)

    obj = payload["object"]
    if obj:
        c, r = (int(obj["x"] * w), int(obj["y"] * h)), max(6, int(obj["radius"] * w))
        cv2.circle(out, c, r, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.circle(out, c, 3, (0, 0, 255), -1, cv2.LINE_AA)

    active, left = payload["active"], payload["secondsLeft"]
    color = ON if active else OFF
    cv2.rectangle(out, (0, 0), (w, 34), (0, 0, 0), -1)
    label = f"DETECTION {'ON' if active else 'OFF'}  switches in {left:.1f}s"
    cv2.putText(out, label, (10, 24), FONT, 0.65, color, 2, cv2.LINE_AA)
    cv2.rectangle(out, (0, 34), (int(w * (left / period_s)), 38), color, -1)
    if not active:
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), color, 4)
        cv2.putText(out, "paused - trace erased", (10, h - 12), FONT, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return out
