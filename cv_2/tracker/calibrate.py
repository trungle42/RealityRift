from __future__ import annotations

import sys

import numpy as np

HSV = tuple[int, int, int]


def suggest(samples: list[HSV], hue_pad: int = 5, floor_pad: int = 15) -> dict:
    """Turn HSV samples of one object, taken where it is easiest and hardest to see (bright side,
    dark side, centre), into thresholds that cover all of them with a little slack.

    Hue is circular, so it is measured after shifting by 90: that moves the wrap point from red
    (0/179) to cyan, which none of our colours touch, and red samples such as 177 and 3 stay
    contiguous. A band that still crosses 0 comes back as two ranges.
    """
    if not samples:
        raise ValueError("need at least one sample")
    h, s, v = (np.array(c, int) for c in zip(*samples))
    shifted = (h + 90) % 180
    lo = max(0, int(shifted.min()) - hue_pad)
    hi = min(179, int(shifted.max()) + hue_pad)
    lo, hi = (lo - 90) % 180, (hi - 90) % 180
    hue = ((lo, hi),) if lo <= hi else ((lo, 179), (0, hi))
    return {
        "hue": hue,
        "s_min": max(0, int(s.min()) - floor_pad),
        "v_min": max(0, int(v.min()) - floor_pad),
    }


def env_lines(name: str, sug: dict, powershell: bool | None = None) -> list[str]:
    """Shell lines that apply a suggestion to the demo: PowerShell `$env:` lines on Windows, `export` lines elsewhere
    (macOS/Linux zsh or bash). `powershell` overrides the platform guess."""
    if powershell is None:
        powershell = sys.platform == "win32"
    p = f"YT_{name.upper()}_"
    values = {"HUE": ",".join(f"{a}-{b}" for a, b in sug["hue"]), "S_MIN": sug["s_min"], "V_MIN": sug["v_min"]}
    form = '$env:{}="{}"' if powershell else 'export {}="{}"'
    return [form.format(p + k, v) for k, v in values.items()]
