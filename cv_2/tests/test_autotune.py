import cv2
import numpy as np
import pytest

from tracker.autotune import MIN_PIXELS, Sampler, band, centre_box, env_text, object_pixels, overlap, rate
from tracker.config import ColorSpec, Config, read_env_file
from tracker.detector import ColorDetector, to_hsv
from tracker.track import ColorTrack

W, H = 640, 480
SKIN = (130, 160, 220)          # BGR, the skin tone the tracker tests use (hue ~10, S ~104)


def hsv_bgr(h: int, s: int = 230, v: int = 230) -> tuple[int, int, int]:
    px = cv2.cvtColor(np.uint8([[[h, s, v]]]), cv2.COLOR_HSV2BGR)[0, 0]
    return tuple(int(c) for c in px)


def room(seed: int = 0) -> np.ndarray:
    """Grey room with a little sensor noise."""
    rng = np.random.default_rng(seed)
    return np.clip(np.full((H, W, 3), 110, np.int16) + rng.integers(-6, 7, (H, W, 3)), 0, 255).astype(np.uint8)


def held_ball(hue: int, at=(W // 2, H // 2), radius: int = 40, seed: int = 0, hand: bool = True) -> np.ndarray:
    """A ball on a stick held in a hand: the hand (skin) and the stick reach into the box below the ball."""
    f = room(seed)
    x, y = at
    cv2.line(f, (x, y), (x, min(H - 1, y + 160)), (50, 50, 50), 12)
    if hand:
        cv2.ellipse(f, (x, y + radius + 25), (30, 22), 0, 0, 360, SKIN, -1)
    cv2.circle(f, (x, y), radius, hsv_bgr(hue), -1)
    return f


def held_tape(hue: int, at=(W // 2, H // 2), seed: int = 0) -> np.ndarray:
    """A dark phone with a strip of tape across it, thumb (skin) on the side."""
    f = room(seed)
    x, y = at
    cv2.rectangle(f, (x - 60, y - 45), (x + 60, y + 45), (25, 25, 25), -1)
    cv2.rectangle(f, (x - 55, y - 18), (x + 55, y + 18), hsv_bgr(hue), -1)
    cv2.ellipse(f, (x + 62, y + 10), (16, 26), 0, 0, 360, SKIN, -1)
    return f


def spec(name: str, sug: dict, min_area: float = 0.0) -> ColorSpec:
    return ColorSpec(name, sug["hue"], sug["s_min"], sug["v_min"], (0, 255, 255), 0.0, min_area)


def sample(make, hue: int, w: float, h: float, frames: int = 6) -> dict:
    box = centre_box(W, H, w, h)
    s = Sampler(box)
    for i in range(frames):
        s.add(to_hsv(make(hue, seed=i)))
    return band(s.pixels)


# --- sampling -----------------------------------------------------------------

def test_box_is_centred_and_sized_from_the_picture_height():
    b = centre_box(W, H, 0.22, 0.22)
    assert (b.x1 - b.x0, b.y1 - b.y0) == (105, 105)
    assert b.x0 + b.x1 == W - 1 or abs((b.x0 + b.x1) - W) <= 1


def test_only_the_objects_own_pixels_are_kept_not_skin_or_background():
    box = centre_box(W, H, 0.4, 0.4)   # big enough to hold the ball, the hand below it and the grey room around it
    px = object_pixels(box.crop(to_hsv(held_ball(28))))
    assert len(px) >= MIN_PIXELS
    assert not np.any(px[:, 0] <= 17), "skin pixels were kept"
    # The blur that the tracker applies mixes the ball's rim with the hand below it; those rim pixels are few.
    assert np.mean(np.abs(px[:, 0] - 28) <= 3) >= 0.9, "pixels other than the ball's hue were kept"


def test_a_box_of_only_skin_and_wall_gives_nothing():
    f = room()
    cv2.ellipse(f, (W // 2, H // 2), (60, 45), 0, 0, 360, SKIN, -1)
    assert len(object_pixels(centre_box(W, H, 0.4, 0.4).crop(to_hsv(f)))) == 0
    with pytest.raises(ValueError):
        band(np.zeros((10, 3), int))


@pytest.mark.parametrize("hue", [22, 28])   # 22: inside the built-in yellow band; 28: a camera whose white balance moved it out
def test_a_ball_sampled_in_the_box_gives_a_band_that_then_finds_it_anywhere(hue):
    sug = sample(held_ball, hue, 0.22, 0.22)
    lo, hi = sug["hue"][0]
    assert lo <= hue <= hi and hi - lo <= 16 and sug["s_min"] >= 50 and sug["v_min"] >= 50
    det = ColorDetector(spec("yellow", sug), Config().min_area_frac).detect(to_hsv(held_ball(hue, at=(150, 140), seed=9)))
    assert det is not None and abs(det.x - 150) < 4 and abs(det.y - 140) < 4
    # ... and still ignores skin and the room.
    assert ColorDetector(spec("yellow", sug), Config().min_area_frac).detect(to_hsv(room(3))) is None


def test_the_built_in_band_misses_a_shifted_ball_that_autotune_finds():
    shifted = to_hsv(held_ball(28, at=(200, 200), seed=5))
    assert ColorDetector(Config().colors["yellow"], Config().min_area_frac).detect(shifted) is None
    assert ColorDetector(spec("yellow", sample(held_ball, 28, 0.22, 0.22)), Config().min_area_frac).detect(shifted) is not None


def test_phone_tape_band_tracks_the_strip_with_the_real_tracking_rules():
    sug = sample(held_tape, 40, 0.36, 0.18)
    assert sug["hue"][0][0] <= 40 <= sug["hue"][0][1]
    cfg = Config(acquire_frames=3)
    track = ColorTrack(cfg, ColorDetector(spec("phone", sug, 0.002), cfg.min_area_frac))
    seen = [track.step(to_hsv(held_tape(40, at=(200 + 10 * i, 220), seed=i)), i / 30) is not None for i in range(30)]
    assert rate(seen) >= 0.9   # all but the confirmation frames


def test_red_wraps_around_zero_into_two_ranges():
    f = room()
    cv2.circle(f, (W // 2, H // 2), 40, hsv_bgr(178, 200, 200), -1)
    cv2.circle(f, (W // 2, H // 2), 20, hsv_bgr(2, 200, 200), -1)
    px = object_pixels(centre_box(W, H, 0.22, 0.22).crop(to_hsv(f)))
    hues = {r for r in band(px)["hue"]}
    assert any(lo <= 178 <= hi for lo, hi in hues) and any(lo <= 2 <= hi for lo, hi in hues)


def test_sampler_caps_what_it_keeps():
    s = Sampler(centre_box(W, H, 0.22, 0.22), cap=500)
    for i in range(4):
        s.add(to_hsv(held_ball(24, seed=i)))
    assert len(s.pixels) == 500 and s.frames == 4


def test_overlapping_bands_are_spotted():
    assert overlap(((20, 30),), ((28, 40),)) and not overlap(((20, 26),), ((31, 43),))
    assert overlap(((174, 179), (0, 6)), ((5, 12),))


# --- tuned.env ------------------------------------------------------------------

def test_tuned_env_round_trips_through_config(tmp_path, monkeypatch):
    yellow, phone = sample(held_ball, 28, 0.22, 0.22), sample(held_tape, 40, 0.36, 0.18)
    path = tmp_path / "tuned.env"
    path.write_text(env_text({"yellow": yellow, "phone": phone}, "test"), encoding="utf-8")
    monkeypatch.setenv("YT_TUNED_ENV", str(path))
    c = Config.from_env()
    assert c.colors["yellow"].hue == yellow["hue"] and c.colors["yellow"].s_min == yellow["s_min"]
    assert c.phone.hue == phone["hue"] and c.phone.v_min == phone["v_min"]
    assert c.colors["blue"] == Config().colors["blue"], "colours that were not tuned keep their built-in bands"
    assert c.phone.min_area_frac == Config().phone.min_area_frac and c.phone.bgr == Config().phone.bgr


def test_environment_variables_win_over_tuned_env(tmp_path, monkeypatch):
    path = tmp_path / "tuned.env"
    path.write_text("YT_YELLOW_HUE=26-34\nYT_YELLOW_S_MIN=80\n", encoding="utf-8")
    monkeypatch.setenv("YT_TUNED_ENV", str(path))
    monkeypatch.setenv("YT_YELLOW_HUE", "18-24")
    c = Config.from_env()
    assert c.colors["yellow"].hue == ((18, 24),) and c.colors["yellow"].s_min == 80


def test_no_tuned_file_or_switched_off_means_built_in_values(tmp_path, monkeypatch):
    monkeypatch.setenv("YT_TUNED_ENV", str(tmp_path / "missing.env"))
    assert Config.from_env().colors["yellow"].hue == Config().colors["yellow"].hue
    path = tmp_path / "tuned.env"
    path.write_text("YT_YELLOW_HUE=26-34\n", encoding="utf-8")
    monkeypatch.setenv("YT_TUNED_ENV", "0")
    assert Config.from_env().colors["yellow"].hue == Config().colors["yellow"].hue


def test_env_file_reader_takes_comments_export_and_quotes(tmp_path):
    path = tmp_path / "x.env"
    path.write_text('# note\nexport YT_A="1-2"\nYT_B = 3\n\nnot a line\nYT_C=\'4\'\n', encoding="utf-8")
    assert read_env_file(path) == {"YT_A": "1-2", "YT_B": "3", "YT_C": "4"}
    assert read_env_file(tmp_path / "missing.env") == {}


# --- the tool, end to end, with a fake camera -------------------------------------

def test_autotune_tool_runs_on_timers_writes_tuned_env_and_reports_rates(tmp_path, monkeypatch, capsys):
    import time

    import tools.autotune as tool

    started = time.monotonic()

    class FakeCamera:
        """Ball in the box, then the tape in the box, then both moving around (the phases the tool times)."""
        def __init__(self, *_): self.n = 0
        def start(self): return self
        def stop(self): pass
        def read(self, seq):
            time.sleep(0.005)
            self.n += 1
            t = time.monotonic() - started
            if t < 0.62:
                return self.n, held_ball(28, seed=self.n % 5)
            if t < 1.22:
                return self.n, held_tape(40, seed=self.n % 5)
            f = held_ball(28, at=(140 + self.n % 40, 150), seed=self.n % 5, hand=False)
            cv2.rectangle(f, (380, 290), (500, 326), hsv_bgr(40), -1)
            return self.n, f

    out = tmp_path / "tuned.env"
    monkeypatch.setattr(tool, "Camera", FakeCamera)
    monkeypatch.setenv("YT_TUNED_ENV", str(out))
    monkeypatch.setattr("sys.argv", ["autotune", "--no-window", "--prep", "0.3", "--sample", "0.3", "--check", "0.4", "--out", str(out)])
    assert tool.main() == 0
    text = capsys.readouterr().out
    saved = read_env_file(out)
    lo, hi = (int(x) for x in saved["YT_YELLOW_HUE"].split("-"))
    assert lo <= 28 <= hi and "YT_PHONE_HUE" in saved
    assert "Result: wand seen" in text and "tape seen" in text and "Ready." in text, text
