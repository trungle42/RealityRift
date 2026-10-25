from __future__ import annotations

import time
from collections import deque

import numpy as np

from .config import Config
from .detector import ColorDetector, to_hsv
from .jump import JumpDetector
from .motion import BodyMotion
from .shapes import ShapeRecognizer, ShapeResult
from .slash import SlashDetector
from .trace import DetectionGate, Trace
from .track import ColorTrack


class Pipeline:
    """frame -> gate -> per colour (detect -> smooth -> trace -> shape) -> payload. One gate drives every
    colour: while it is off no detector runs, and all traces are erased on the on->off edge. Each time it
    turns on, the shape the user is asked to draw advances through cfg.shapes.

    The phone marker is separate: it is tracked on every frame whatever the gate says (the gate is about the wand game),
    has no trace or shape, and only feeds the slash detector.

    control() hands the wand to the game (game mode) until release(): the game switches it on and off and names the shape
    to draw, or none, so any preset counts and the player picks. In game mode a stroke starts where the wand was last held
    still, a completed shape stays complete for cfg.wand_rearm_s and then that colour starts over, so the wand can be used
    again and again within one "on"."""

    def __init__(self, cfg: Config, detectors: dict[str, ColorDetector] | None = None):
        self.cfg = cfg
        self.detectors = detectors or {
            n: ColorDetector(s, cfg.min_area_frac, cfg.track_hue_margin, cfg.track_relax, cfg.track_max_growth,
                          cfg.track_min_shrink)
            for n, s in cfg.colors.items()
        }
        self.gate = DetectionGate(cfg.period_s)
        self.traces = {n: Trace(cfg.gap_s, cfg.max_trace_points) for n in self.detectors}
        self.tracks = {n: ColorTrack(cfg, d) for n, d in self.detectors.items()}
        self._was_active = True
        self.recognizer = ShapeRecognizer(cfg.shape_closure, cfg.shape_min_size, max_dist=cfg.shape_max_dist)
        self._round = 0  # index into cfg.shapes of the shape being drawn (first ON phase: shapes[0])
        self._shapes: dict[str, ShapeResult | None] = dict.fromkeys(self.detectors)
        # Per colour, the drawing that matched the target this round. Once set it stays for the rest of the round: the
        # live label only exists while the stroke is closed, so it would vanish as soon as the ball moves on.
        self._done: dict[str, ShapeResult | None] = dict.fromkeys(self.detectors)
        # The finished round, kept through the OFF phase (the traces are erased but the result is still readable).
        self._previous: dict | None = None
        # Game mode: (on, target) set by the game, or None while the 5 s timer runs the round.
        self._game: tuple[bool, str | None] | None = None
        self._done_at: dict[str, float] = {}
        self._still: dict[str, deque[tuple[float, float, float]]] = {n: deque() for n in self.detectors}
        self.phone_detector = (ColorDetector(cfg.phone, cfg.min_area_frac, cfg.track_hue_margin, cfg.track_relax,
                                             cfg.track_max_growth, cfg.track_min_shrink) if cfg.phone else None)
        self.phone_track = ColorTrack(cfg, self.phone_detector) if self.phone_detector else None
        # Jump: whole-picture motion, every frame, whatever the gate says (like the phone).
        self.motion = BodyMotion() if cfg.jump else None
        self.jump = JumpDetector(cfg.jump_hold_s, cfg.jump_up_speed, cfg.jump_down_speed, cfg.jump_min_frames,
                                 cfg.jump_min_height, cfg.jump_min_area, cfg.jump_max_air_s, cfg.jump_max_gap_s,
                                 cfg.jump_min_ratio, cfg.jump_max_ratio, cfg.jump_max_sideways)
        self._body_until = 0.0     # slashes are ignored until then: the whole body was moving (a jump)
        self.slash = SlashDetector(cfg.slash_window_s, cfg.slash_min_drop, cfg.slash_min_speed, cfg.slash_max_sideways,
                                   cfg.slash_down_frac, cfg.slash_gap_s, cfg.slash_hold_s, cfg.slash_min_points,
                                   cfg.slash_min_peak_speed)

    def _nx(self, x: float, w: int) -> float:
        v = x / w
        return float(round(1.0 - v if self.cfg.mirror else v, 4))

    @staticmethod
    def _shape_json(r: ShapeResult | None) -> dict | None:
        return None if r is None else {"shape": r.shape, "score": float(r.score)}

    def _target(self, offset: int = 0) -> str | None:
        if self._game is not None:
            return None if offset else self._game[1]
        return self.cfg.shapes[(self._round + offset) % len(self.cfg.shapes)]

    def control(self, on: bool, target: str | None = None) -> None:
        """The game takes the wand: on/off, and the shape it wants (None, or one this tracker does not know, means any
        preset). Switching on or changing the target starts afresh: every trace and completed shape is cleared."""
        game = (on, target if target in self.cfg.shapes else None)
        if game != self._game:
            self._clear_round()
            for t in self.traces.values():
                t.max_points = self.cfg.wand_trace_points
        self._game = game

    def release(self) -> None:
        """Back to the 5 s timer (the game has gone)."""
        if self._game is not None:
            self._game = None
            self._clear_round()
            for t in self.traces.values():
                t.max_points = self.cfg.max_trace_points

    def _clear_round(self) -> None:
        self._shapes = dict.fromkeys(self.detectors)
        self._done = dict.fromkeys(self.detectors)
        self._done_at = {}
        for name, t in self.traces.items():
            t.clear()
            self._still[name].clear()

    def _paused(self, name: str, now: float, point: tuple[float, float], aspect: float) -> bool:
        """The wand has been held (nearly) still for cfg.wand_pause_s: where it rests is where the next stroke starts."""
        recent = self._still[name]
        recent.append((now, *point))
        while recent and now - recent[0][0] > self.cfg.wand_pause_s:
            recent.popleft()
        if not recent or now - recent[0][0] < self.cfg.wand_pause_s * 0.9:
            return False
        _, x, y = recent[-1]
        return all(((px - x) * aspect) ** 2 + (py - y) ** 2 <= self.cfg.wand_still_dist ** 2 for _, px, py in recent)

    def _recognise_game(self, aspect: float, now: float) -> None:
        """Game mode: name each colour's current stroke (its newest segment, which starts where the wand last rested).
        A preset, or the game's target if it named one, latches as complete; wand_rearm_s later the colour starts over."""
        target = self._game[1] if self._game else None
        for name, trace in self.traces.items():
            if self._done[name] is not None:
                if now - self._done_at[name] < self.cfg.wand_rearm_s:
                    self._shapes[name] = self._done[name]
                    continue
                self._done[name] = self._shapes[name] = None
                trace.clear()
                self._still[name].clear()
                continue
            stroke = trace.segments[-1] if trace.segments else None
            # Lenient toward the requested rune only (shapes.PREFER_MARGIN): a sloppy star the plain reading calls a triangle
            # still casts when the game asked for a star. No request, no leniency.
            result = self.recognizer.classify(stroke, aspect, prefer=target) if stroke else None
            self._shapes[name] = result
            if result is not None and result.shape is not None and (target is None or result.shape == target):
                self._done[name], self._done_at[name] = result, now

    def _recognise(self, aspect: float) -> None:
        """Name each colour's drawing from its longest unbroken stroke (a lost track would otherwise be a jump).

        A drawing that matches the target is latched for the rest of the round (`_done`) and not looked at again, so the
        "complete" state survives the ball moving on, being lost, or the path no longer being closed. Only matches latch:
        a wrong shape stays live, so the player can still correct it within the round."""
        target = self._target()
        for name, trace in self.traces.items():
            if self._done[name] is not None:
                self._shapes[name] = self._done[name]
                continue
            stroke = max(trace.segments, key=len, default=None)
            result = self.recognizer.classify(stroke, aspect) if stroke else None
            self._shapes[name] = result
            if result is not None and result.shape == target:
                self._done[name] = result

    def process(self, frame: np.ndarray, now: float | None = None) -> dict:
        now = time.monotonic() if now is None else now
        h, w = frame.shape[:2]
        active, remaining = self.gate.state(now) if self._game is None else (self._game[0], 0.0)

        if self._game is not None:
            pass    # the game starts and ends rounds (control()); the timer's edges and round counter do not apply
        elif self._was_active and not active:
            self._previous = {"target": self._target(),
                              "shapes": {n: self._shape_json(r) for n, r in self._shapes.items()}}
            self._shapes = dict.fromkeys(self.detectors)
            self._done = dict.fromkeys(self.detectors)
            for t in self.traces.values():
                t.clear()
        elif active and not self._was_active:
            self._round += 1
        self._was_active = active

        hsv = to_hsv(frame) if active or self.phone_track else None
        objects: dict[str, dict | None] = dict.fromkeys(self.detectors)
        if active:
            for name, track in self.tracks.items():
                det = track.step(hsv, now)
                if det is None:
                    continue
                sx, sy = track.smoothed
                point = (self._nx(sx, w), float(round(sy / h, 4)))
                if self._game is not None and self._done[name] is None and self._paused(name, now, point, w / h):
                    self.traces[name].clear()   # resting: the next stroke starts here
                self.traces[name].add(now, point)
                objects[name] = self._obj(det, w, h)
            if self._game is None:
                self._recognise(w / h)
            else:
                self._recognise_game(w / h, now)
        else:
            for track in self.tracks.values():
                track.reset()

        motion = self.motion.update(frame, now) if self.motion else None
        if motion is not None and motion.area >= self.cfg.slash_suppress_area:
            self._body_until = now + self.cfg.slash_suppress_hold_s
        phone = None
        if self.phone_track:
            det = self.phone_track.step(hsv, now)
            phone = None if det is None else self._obj(det, w, h)
            # The raw centre, not the smoothed one: smoothing lags a frame or two, which blunts a fast swing.
            slash = self.slash.update(now, None if det is None else (det.x / w, det.y / h), w / h,
                                      suppress=now < self._body_until)
        else:
            slash = self.slash.update(now, None)

        jump = self.jump.update(now, motion)

        return {
            "mode": "timer" if self._game is None else "game",
            "active": active,
            "secondsLeft": float(round(remaining, 2)),
            "mirrored": self.cfg.mirror,
            "objects": objects,
            "traces": {n: [list(map(list, seg)) for seg in t.segments] for n, t in self.traces.items()},
            "target": self._target(),
            "next": self._target(1),
            "shapes": {n: self._shape_json(r) for n, r in self._shapes.items()},
            "complete": {n: self._done[n] is not None for n in self.detectors},
            "previous": self._previous,
            "phone": phone,
            "slash": {"active": slash.active, "secondsLeft": float(round(slash.seconds_left, 2)), "count": slash.count},
            "jump": {"active": jump.active, "secondsLeft": float(round(jump.seconds_left, 2)), "count": jump.count},
            "motion": None if motion is None else {"vy": float(round(motion.vy, 3)), "vx": float(round(motion.vx, 3)),
                                                    "area": float(round(motion.area, 3))},
        }

    def _obj(self, det, w: int, h: int) -> dict:
        return {"x": self._nx(det.x, w), "y": float(round(det.y / h, 4)), "radius": float(round(det.radius / w, 4))}
