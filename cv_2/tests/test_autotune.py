import cv2
import numpy as np
import pytest

from tracker.autotune import MIN_PIXELS, SKIN_HUE, Sampler, band, centre_box, env_text, hue_edges, object_pixels, overlap, rate, separate, separate_all
from tracker.config import ColorSpec, Config, default_colors, read_env_file
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
    path.write_text('# note\nexport YT_A="1-2"\nYT_B = 3   # a comment after the value\n\nnot a line\nYT_C=\'4\'\n', encoding="utf-8")
    assert read_env_file(path) == {"YT_A": "1-2", "YT_B": "3", "YT_C": "4"}
    assert read_env_file(tmp_path / "missing.env") == {}


# --- the tool, end to end, with a fake camera -------------------------------------

def run_tool(tmp_path, monkeypatch, capsys, show_in_check: bool):
    import time

    import tools.autotune as tool

    started = time.monotonic()

    class FakeCamera:
        """Ball in the box, then the tape in the box, then (if show_in_check) both moving around."""
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
            if not show_in_check:
                return self.n, room(self.n % 5)
            f = held_ball(28, at=(140 + self.n % 40, 150), seed=self.n % 5, hand=False)
            cv2.rectangle(f, (380, 290), (500, 326), hsv_bgr(40), -1)
            return self.n, f

    out = tmp_path / "tuned.env"
    monkeypatch.setattr(tool, "Camera", FakeCamera)
    monkeypatch.setenv("YT_TUNED_ENV", str(out))
    monkeypatch.setattr("sys.argv", ["autotune", "--no-window", "--prep", "0.3", "--sample", "0.3", "--check", "0.4", "--out", str(out)])
    code = tool.main()
    return code, out, capsys.readouterr().out


def test_a_tune_that_cannot_see_the_objects_puts_the_previous_colours_back(tmp_path, monkeypatch, capsys):
    previous = "YT_YELLOW_HUE=20-25\n"
    (tmp_path / "tuned.env").write_text(previous, encoding="utf-8")
    code, out, text = run_tool(tmp_path, monkeypatch, capsys, show_in_check=False)
    assert code == 2 and out.read_text(encoding="utf-8") == previous and "previous colours were put back" in text, text
    assert (tmp_path / "tuned.env.bak").read_text(encoding="utf-8") == previous


def test_a_bad_first_tune_leaves_no_file_so_the_built_in_colours_stay(tmp_path, monkeypatch, capsys):
    code, out, text = run_tool(tmp_path, monkeypatch, capsys, show_in_check=False)
    assert code == 2 and not out.exists() and "built-in colours stay" in text, text


def test_autotune_tool_runs_on_timers_writes_tuned_env_and_reports_rates(tmp_path, monkeypatch, capsys):
    code, out, text = run_tool(tmp_path, monkeypatch, capsys, show_in_check=True)
    saved = read_env_file(out)
    lo, hi = (int(x) for x in saved["YT_YELLOW_HUE"].split("-"))
    assert code == 0 and lo <= 28 <= hi and "YT_PHONE_HUE" in saved
    assert "Result: wand seen" in text and "tape seen" in text and "Ready." in text, text



# --- wand vs tape: apart even while followed ----------------------------------------

def spread(hue_mean: float, hue_sd: float, n: int = 6000, seed: int = 0) -> np.ndarray:
    """Object pixels with a real camera's hue spread (normal around the mean), bright and saturated."""
    rng = np.random.default_rng(seed)
    h = np.clip(np.round(rng.normal(hue_mean, hue_sd, n)), 0, 179).astype(int)
    return np.stack([h, rng.integers(150, 230, n), rng.integers(150, 230, n)], axis=1)


def tuned_pair(wand_hue, wand_sd, tape_hue, tape_sd):
    wand_px, tape_px = spread(wand_hue, wand_sd, seed=1), spread(tape_hue, tape_sd, seed=2)
    return separate(band(wand_px), band(tape_px), hue_edges(wand_px), hue_edges(tape_px), Config().track_hue_margin)


def test_haicils_kit_tunes_without_a_warning_and_stays_apart_while_followed():
    margin = Config().track_hue_margin
    wand, tape, too_close = tuned_pair(22.5, 1.5, 36.5, 1.0)
    (w_lo, w_hi), (t_lo, t_hi) = wand["hue"][0], tape["hue"][0]
    assert not too_close
    assert t_lo - w_hi >= margin + 1, (wand["hue"], tape["hue"])
    assert w_hi + margin < t_lo and t_lo - margin > w_hi, "a followed object reaches the other one's strict band"
    assert w_lo <= 20 and w_hi >= 25 and t_lo <= 35 and t_hi >= 38, "the trimmed bands no longer cover the objects"


def test_padded_bands_that_touch_have_their_facing_edges_trimmed_to_split_the_gap():
    margin = Config().track_hue_margin
    wand, tape, too_close = separate({"hue": ((19, 29),), "s_min": 90, "v_min": 90}, {"hue": ((31, 42),), "s_min": 70, "v_min": 80},
                                     (21, 25), (35, 38), margin)
    assert not too_close and wand["hue"] == ((19, 27),) and tape["hue"] == ((32, 42),)   # the review's example: 25 and 35 -> ..-27 and 32-..


def test_colours_too_close_to_tell_apart_are_flagged():
    _, _, too_close = tuned_pair(28, 1.0, 31, 1.0)
    assert too_close


def test_the_wand_band_never_reaches_down_into_skin():
    wand, _, _ = tuned_pair(18.5, 2.0, 37, 1.0)
    assert wand["hue"][0][0] >= SKIN_HUE + 1


# --- several players on one camera: --colors red,blue,yellow ---------------------------------

def three_wands_and_tape():
    px = {"red": spread(179.6, 1.5, seed=3) % 180, "blue": spread(109, 2.0, seed=4), "yellow": spread(22.5, 1.5, seed=1),
          "phone": spread(36.5, 1.0, seed=2)}
    bands = {n: band(p, default_colors()["red"].s_min if n == "red" else 0) for n, p in px.items()}
    return separate_all(bands, {n: hue_edges(p) for n, p in px.items()}, Config().track_hue_margin)


def test_three_wand_colours_and_the_tape_all_stay_apart_even_while_followed():
    bands, close = three_wands_and_tape()
    m = Config().track_hue_margin
    assert close == []
    assert len(bands["red"]["hue"]) == 2                                     # red still wraps around 0
    names = list(bands)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            wide = tuple((lo - m, hi + m) for lo, hi in bands[a]["hue"])
            assert not overlap(wide, bands[b]["hue"]), (a, b, bands[a]["hue"], bands[b]["hue"])
    assert bands["yellow"]["hue"][0][0] >= SKIN_HUE + 1


def test_two_wands_too_close_in_colour_are_named_in_the_warning():
    px = {"yellow": spread(26, 1.0, seed=1), "phone": spread(29, 1.0, seed=2)}
    _, close = separate_all({n: band(p) for n, p in px.items()}, {n: hue_edges(p) for n, p in px.items()}, 4)
    assert close == [("yellow", "phone")]


def test_red_keeps_its_skin_guard_lips_and_skin_are_dropped_and_s_min_stays_high():
    ball = np.stack([np.r_[np.zeros(800, int), np.full(800, 179)], np.full(1600, 160), np.full(1600, 120)], axis=1)
    lips = np.stack([np.full(400, 3), np.full(400, 126), np.full(400, 108)], axis=1)       # dev camera: hue 3, S 124-129
    skin = np.stack([np.full(900, 10), np.full(900, 170), np.full(900, 170)], axis=1)        # skin in warm light: S above 150
    patch = np.concatenate([ball, lips, skin]).reshape(-1, 1, 3)
    kept = object_pixels(patch, red=True)
    assert len(kept) == 1600 and set(kept[:, 0]) <= {0, 179}
    assert len(object_pixels(patch)) > 1600                                  # the ordinary rule would let skin in
    assert band(kept, default_colors()["red"].s_min)["s_min"] >= default_colors()["red"].s_min


def test_tuning_some_colours_keeps_the_others_from_the_previous_file(tmp_path):
    previous = {"YT_BLUE_HUE": "100-112", "YT_BLUE_S_MIN": "70", "YT_YELLOW_HUE": "20-25"}
    text = env_text({"yellow": {"hue": ((19, 27),), "s_min": 90, "v_min": 90}}, keep=previous)
    (tmp_path / "tuned.env").write_text(text, encoding="utf-8")
    saved = read_env_file(tmp_path / "tuned.env")
    assert saved["YT_BLUE_HUE"] == "100-112" and saved["YT_BLUE_S_MIN"] == "70" and saved["YT_YELLOW_HUE"] == "19-27"
    assert text.count("YT_YELLOW_HUE") == 1


def test_autotune_asks_for_each_wand_colour_in_order_then_the_tape(monkeypatch):
    import tools.autotune as tool
    assert [s[0] for s in tool.steps(["red", "blue", "yellow"])] == ["red", "blue", "yellow", "phone"]
    assert tool.steps(["red"])[0][1] == "Hold the RED WAND ball in the box"
    assert tool.labels(["red", "blue"]) == {"red": "red wand", "blue": "blue wand", "phone": "tape"}
    assert tool.labels(["yellow"])["yellow"] == "wand"
    monkeypatch.setattr("sys.argv", ["autotune", "--colors", "red,purple"])
    with pytest.raises(SystemExit):
        tool.main()
