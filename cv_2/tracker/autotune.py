"""Automatic colour calibration: pixels of an object held in a box -> thresholds -> a check that they really find it.

Pure (no camera, no window) so it can be unit tested on synthetic frames; tools/autotune.py runs it live with timers.
The thresholds come from the same calibrate.suggest() the click tool (tools/tune.py) uses, fed with robust percentiles of
the object's own pixels instead of a few clicks.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .calibrate import suggest

# Background (grey walls, white, black clothing) has less colour or light than this; the wand ball and the lime tape have
# far more (dev camera: yellow S>=105, tape S 100-145, V>=122).
MIN_S, MIN_V = 70, 60
# Skin, which the hand holding the object puts in the box: OpenCV hue 0-17 (or wrapping to 170+) at moderate saturation.
# The yellow ball sits at hue 20-25 and the tape at 31-43, so neither is lost to this.
SKIN_HUE, SKIN_HUE_WRAP, SKIN_S = 17, 170, 150
# Pixels within this many hue steps of the object's dominant hue are its own; anything further is something else in the box.
CLUSTER_HUE = 10
# Never suggest floors lower than this, so a dim sample cannot open the band to the walls.
FLOOR = 50
MIN_PIXELS = 300


@dataclass(frozen=True)
class Box:
    x0: int
    y0: int
    x1: int
    y1: int

    def crop(self, img: np.ndarray) -> np.ndarray:
        return img[self.y0:self.y1, self.x0:self.x1]


def centre_box(width: int, height: int, w_frac: float, h_frac: float) -> Box:
    """A box in the middle of the picture, sized as fractions of the picture HEIGHT (so it is the same shape on any camera).
    Centred, it covers the same pixels in the raw and in the mirrored (selfie) view."""
    bw, bh = int(height * w_frac), int(height * h_frac)
    x0, y0 = (width - bw) // 2, (height - bh) // 2
    return Box(x0, y0, x0 + bw, y0 + bh)


def _hue_distance(h: np.ndarray, centre: int) -> np.ndarray:
    d = np.abs(h - centre)
    return np.minimum(d, 180 - d)


def object_pixels(hsv_patch: np.ndarray) -> np.ndarray:
    """The object's own pixels from an HSV patch (N x 3, int): drop background (low saturation or brightness) and skin,
    then keep the dominant colour (the saturation-weighted peak of the hue histogram) and drop its blurred, washed-out edge."""
    px = hsv_patch.reshape(-1, 3).astype(int)
    h, s, v = px[:, 0], px[:, 1], px[:, 2]
    skin = ((h <= SKIN_HUE) | (h >= SKIN_HUE_WRAP)) & (s < SKIN_S)
    px = px[(s >= MIN_S) & (v >= MIN_V) & ~skin]
    if len(px) < MIN_PIXELS:
        return px[:0]
    hist = np.bincount(px[:, 0], weights=px[:, 1].astype(float), minlength=180)
    smooth = sum(np.roll(hist, k) for k in range(-2, 3))   # circular: red at 179 and 0 stay one peak
    peak = int(np.argmax(smooth))
    mine = px[_hue_distance(px[:, 0], peak) <= CLUSTER_HUE]
    if len(mine) < MIN_PIXELS:
        return mine[:0]
    return mine[mine[:, 1] >= 0.5 * np.median(mine[:, 1])]


def hue_edges(pixels: np.ndarray) -> tuple[int, int]:
    """The object's own hue spread: 3rd and 97th percentiles, measured away from the red wrap as suggest() does."""
    shifted = (pixels[:, 0] + 90) % 180
    lo, hi = (int(round(np.percentile(shifted, p))) for p in (3, 97))
    return (lo - 90) % 180, (hi - 90) % 180


def band(pixels: np.ndarray) -> dict:
    """Thresholds (calibrate.suggest format: hue ranges, s_min, v_min) covering the bulk of an object's pixels. Percentiles,
    not extremes, so a few stray pixels cannot widen the band, and only 1 step of hue slack on top: ColorDetector already
    follows a found object with every range widened by Config.track_hue_margin (4), so a wider strict band would let the
    followed wand reach the tape's colour (see separate())."""
    if len(pixels) < MIN_PIXELS:
        raise ValueError(f"only {len(pixels)} object pixels; need {MIN_PIXELS}")
    lo, hi = hue_edges(pixels)
    s5, v5 = (int(np.percentile(pixels[:, i], 5)) for i in (1, 2))
    sug = suggest([(lo, s5, v5), (hi, s5, v5)], hue_pad=1, floor_pad=15)
    return {**sug, "s_min": max(FLOOR, sug["s_min"]), "v_min": max(FLOOR, sug["v_min"])}


def separate(wand: dict, tape: dict, wand_edges: tuple[int, int], tape_edges: tuple[int, int], margin: int) -> tuple[dict, dict, bool]:
    """Keep the yellow wand and the lime tape apart even while they are being followed (each range widened by `margin`,
    Config.track_hue_margin), as default_phone() promises: the tape's lowest hue must sit at least margin + 1 above the
    wand's highest. If the padded bands are closer, the two facing edges are trimmed to split the space between the
    objects' own colours. Also keeps the wand above skin hue. Returns (wand, tape, too_close): too_close only when the
    objects' own colours leave no room for that gap, i.e. one may really be taken for the other."""
    if len(wand["hue"]) != 1 or len(tape["hue"]) != 1:   # a band across the red wrap: not this kit, leave it
        return wand, tape, overlap(wand["hue"], tape["hue"])
    (w_lo, w_hi), (t_lo, t_hi) = wand["hue"][0], tape["hue"][0]
    w_lo = max(w_lo, SKIN_HUE + 1)
    need = margin + 1
    too_close = False
    if w_hi < t_lo and t_lo - w_hi < need:
        space = tape_edges[0] - wand_edges[1]
        if space >= need:
            w_hi = wand_edges[1] + (space - need) // 2
            t_lo = w_hi + need
        else:
            too_close = True
    elif w_hi >= t_lo:
        too_close = True
    return {**wand, "hue": ((w_lo, w_hi),)}, {**tape, "hue": ((t_lo, t_hi),)}, too_close


class Sampler:
    """Collects one object's pixels over many frames (capped, evenly thinned) for band()."""

    def __init__(self, box: Box, cap: int = 200_000, seed: int = 0):
        self.box, self.cap = box, cap
        self._chunks: list[np.ndarray] = []
        self._rng = np.random.default_rng(seed)
        self.frames = 0

    def add(self, hsv: np.ndarray) -> int:
        """Sample one frame; returns how many object pixels it gave."""
        px = object_pixels(self.box.crop(hsv))
        self.frames += 1
        if len(px):
            self._chunks.append(px)
        return len(px)

    @property
    def pixels(self) -> np.ndarray:
        if not self._chunks:
            return np.zeros((0, 3), int)
        px = np.concatenate(self._chunks)
        return px if len(px) <= self.cap else px[self._rng.choice(len(px), self.cap, replace=False)]


def overlap(a: tuple[tuple[int, int], ...], b: tuple[tuple[int, int], ...]) -> bool:
    """Do two hue bands share any hue? Two tuned objects must not, or one would be mistaken for the other."""
    return any(lo1 <= hi2 and lo2 <= hi1 for lo1, hi1 in a for lo2, hi2 in b)


def env_text(bands: dict[str, dict], note: str = "") -> str:
    """tuned.env contents: YT_<NAME>_HUE / _S_MIN / _V_MIN per object, the names Config.from_env reads."""
    lines = ["# Written by `python -m tools.autotune`. Config.from_env reads it; real environment variables win.",
             "# Delete this file (or set YT_TUNED_ENV=0) to go back to the built-in thresholds."]
    if note:
        lines.append(f"# {note}")
    for name, sug in bands.items():
        p = f"YT_{name.upper()}_"
        lines += [f"{p}HUE={','.join(f'{a}-{b}' for a, b in sug['hue'])}", f"{p}S_MIN={sug['s_min']}", f"{p}V_MIN={sug['v_min']}"]
    return "\n".join(lines) + "\n"


def rate(seen: list[bool]) -> float:
    """Fraction of frames in which the object was reported."""
    return sum(seen) / len(seen) if seen else 0.0
