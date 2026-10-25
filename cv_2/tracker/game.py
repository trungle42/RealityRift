from __future__ import annotations


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
