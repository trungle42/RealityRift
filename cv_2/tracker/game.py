from __future__ import annotations

import base64

import cv2
import numpy as np


def jpeg_message(kind: str, frame: np.ndarray, width: int, quality: int, mirror: bool, **extra) -> dict:
    """The camera picture for the game, so only the tracker ever opens the webcam: `frame` (the small mirrored preview the wand
    panel shows, ~10 a second) or `snapshot` (one full-size, unmirrored picture the scanner asked for). JPEG, base64, scaled to
    `width` pixels wide."""
    h, w = frame.shape[:2]
    size = (width, max(1, round(h * width / w)))
    small = cv2.resize(frame, size, interpolation=cv2.INTER_AREA)
    ok, data = cv2.imencode(".jpg", cv2.flip(small, 1) if mirror else small, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("could not encode the frame as JPEG")
    return {"type": kind, **extra, "w": size[0], "h": size[1], "jpeg": base64.b64encode(data.tobytes()).decode("ascii")}


def game_message(payload: dict, max_points: int = 200) -> dict:
    """The small per-frame message the game receives, built from Pipeline.process()'s payload.

    slash and jump are the detectors' running counts, not their 2 s "showing" flags: the game acts when a count goes up, so
    a message skipped by the newest-wins sender loses no event. motion is the fraction of the picture moving (the freeze
    trial). wand is the wand round as the demo shows it, read-only for the game for now; traces are thinned to at most
    max_points per colour so a long round stays a few KB."""
    return {
        "type": "cv",
        "slash": payload["slash"]["count"],
        "jump": payload["jump"]["count"],
        "motion": None if payload["motion"] is None else payload["motion"]["area"],
        "phone": payload.get("phone"),
        "wands": payload["objects"],    # where each wand ball is seen right now (for the game's setup hints), or None
        "wand": {
            "active": payload["active"], "secondsLeft": payload["secondsLeft"],
            "target": payload["target"], "next": payload["next"],
            "shapes": payload["shapes"], "complete": payload["complete"],
            "traces": {name: thin(segments, max_points) for name, segments in payload["traces"].items()},
        },
    }


def thin(segments: list, max_points: int) -> list:
    """Every k-th point of each segment, with the smallest k that leaves at most max_points (each segment keeps its first
    point, so more segments than max_points cannot be thinned below one point each)."""
    total = sum(len(s) for s in segments)
    step = 1
    while step < total and sum(-(-len(s) // step) for s in segments) > max_points:
        step += 1
    return segments if step == 1 else [s[::step] for s in segments]
