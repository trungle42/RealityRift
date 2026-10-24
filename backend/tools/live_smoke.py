"""Live smoke test: hits every Gemini-backed endpoint in-process with the real key.

Usage:  cd backend && PYTHONPATH=. .venv/bin/python tools/live_smoke.py
Exits non-zero if any call falls back / returns an invalid shape, so it can gate a release.
Costs a few cents. Never prints the key.
"""
import base64
import io
import sys
import time
import warnings

warnings.filterwarnings("ignore")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

c = TestClient(app)
fails = []
lat = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name} {detail}")
    if not ok:
        fails.append(name)


def timed(name, path, body, expect_source=None):
    t = time.time()
    r = c.post(path, json=body)
    dt = time.time() - t
    lat.append((name, dt))
    ok = r.status_code == 200 and (expect_source is None or r.json().get("source") == expect_source)
    check(name, ok, f"[{r.status_code} {dt:.1f}s]")
    return r.json() if r.status_code == 200 else None


h = c.get("/api/health").json()
check("health: key loaded + gemini on", h.get("gemini") is True, f"model={h.get('model')}")
if not h.get("gemini"):
    sys.exit("No GEMINI_API_KEY (or OFFLINE=1); aborting.")

P = [{"index": 0, "name": "Wren"}, {"index": 1, "name": "Kai"}]
H = {"party": P, "hearts": 3, "stars": [0, 0], "rewards": [], "environments": ["forest"], "outcomes": []}


def beat_kind(b):
    return "boss" if "boss" in b else "encounter" if "encounter" in b else (b.get("challenge") or {}).get("type", "story")


def validate(b):
    probs = []
    if not b.get("narration") or not all(isinstance(n, str) and n.strip() for n in b["narration"]):
        probs.append("narration")
    if sum(k in b for k in ("challenge", "encounter", "boss")) > 1:
        probs.append("multiple actions")
    ch = b.get("challenge")
    if ch and ch["type"] == "vote" and (len(ch["options"]) != 2 or not all(o["label"].strip() for o in ch["options"])):
        probs.append("vote options")
    txt = " ".join(b.get("narration", [])).lower()
    import re
    # Mechanics/ids must not leak into prose. (Plain "heart" is fine in fairy-tale language; "hearts" as a stat is not.)
    for leak in (r"\bhearts\b", r"\bstars? (earned|score)", r"\benum\b", r"\bjson\b", r"\bbeatid\b", r"(frost-spell|shadow-ambush|lantern-fairy|spirit-gift|thorn-guard|fairy-joins|hurry-on)"):
        m = re.search(leak, txt)
        if m:
            probs.append(f"leak:{m.group(0)}")
    return probs


def play(label, plan):
    """plan: list of (success, choice) applied in order to each non-ending beat."""
    print(f"\n--- run: {label}")
    hist = {**H, "outcomes": [], "rewards": []}
    b = timed(f"{label}/begin", "/api/provider/begin", {"party": P})
    i = 0
    while b and not b.get("isEnding") and i < 12:
        kind = beat_kind(b)
        ok, choice = plan[min(i, len(plan) - 1)]
        if b["id"] == "crossroads" or b["id"] == "lantern-fairy":
            choice = plan_choice(b, choice)
        o = {"beatId": b["id"], "kind": kind, "success": True if kind in ("vote", "story") else ok,
             "choiceId": choice if kind == "vote" else None, "heartsLost": 0 if ok else 1,
             "summary": f"{P[0]['name']} and {P[1]['name']} {'succeeded at' if ok else 'struggled with'} the {kind} challenge"}
        hist["outcomes"].append(o)
        if b.get("reward"):
            hist["rewards"].append(b["reward"])
        if not ok and kind not in ("vote", "story"):
            hist["hearts"] = max(0, hist["hearts"] - 1)
        problems = validate(b)
        check(f"{label}/{b['id']} shape", not problems, ",".join(problems))
        b = timed(f"{label}/next after {b['id']}", "/api/provider/next", {"history": hist, "last": o})
        i += 1
    if b:
        check(f"{label}/ends with ending beat", bool(b.get("isEnding")), b.get("id", ""))
    victory = bool(b and b["id"] == "ending-victory")
    sb = timed(f"{label}/storybook", "/api/provider/storybook", {"history": hist, "victory": victory})
    if sb:
        check(f"{label}/storybook pages", 4 <= len(sb["pages"]) <= 9 and all(p["heading"] and p["text"] for p in sb["pages"]), f"{len(sb['pages'])} pages")


def plan_choice(b, default):
    ids = [o["id"] for o in b["challenge"]["options"]]
    return default if default in ids else ids[0]


play("perfect-castle", [(True, "castle")])
play("failing-cave", [(False, "cave")])

# artifact: drawn bottle (real photos: tools/test_photos.py)
from PIL import Image, ImageDraw  # noqa: E402

im = Image.new("RGB", (512, 512), (235, 235, 235))
d = ImageDraw.Draw(im)
d.rounded_rectangle((200, 170, 312, 480), 30, fill=(70, 150, 230), outline=(30, 80, 150), width=4)
d.rectangle((235, 110, 277, 170), fill=(70, 150, 230), outline=(30, 80, 150), width=4)
d.rectangle((228, 80, 284, 112), fill=(240, 240, 240), outline=(60, 60, 60), width=4)
buf = io.BytesIO()
im.save(buf, "JPEG")
art = timed("artifact", "/api/artifact", {"imageBase64": base64.b64encode(buf.getvalue()).decode()}, expect_source="gemini")
if art:
    a = art["artifact"]
    check("artifact: water-ish bottle", a["element"] == "water", f"{a['artifactName']} {a['artifactType']}/{a['element']}/{a['ability']}")

timed("legacy /api/beat", "/api/beat", {"players": [{"name": "Wren"}, {"name": "Kai"}], "chapter": 1}, expect_source="gemini")
timed("legacy /api/story/ending", "/api/story/ending",
      {"state": {"players": [{"name": "Wren"}], "hearts": 2, "chapter": 4}, "bossDefeated": True}, expect_source="gemini")

lats = sorted(t for _, t in lat)
print(f"\nlatency: median {lats[len(lats)//2]:.1f}s, p90 {lats[int(len(lats)*0.9)]:.1f}s, max {lats[-1]:.1f}s over {len(lats)} calls")
print(f"{len(fails)} failure(s)" + (": " + ", ".join(fails) if fails else ""))
sys.exit(1 if fails else 0)
