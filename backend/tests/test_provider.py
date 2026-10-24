import os

os.environ["OFFLINE"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app import provider  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
PARTY = [{"index": 0, "name": "Ava"}, {"index": 1, "name": "Ben"}]


def hist(outcomes=(), hearts=3):
    return {"party": PARTY, "hearts": hearts, "stars": [0, 0], "rewards": [], "environments": ["forest"],
            "outcomes": [{"beatId": b, "kind": k, "success": s, "choiceId": c, "summary": f"{b} done"} for b, k, s, c in outcomes]}


def fake_text(*_a, **_k):
    return provider.BeatText(narration=["Ava and Ben press on."], prompt="Hold still!", optionLabels=["Left path", "Right path"],
                             rewardName="Test Charm", rewardDescription="It glows.")


def step(monkeypatch_target, outcomes, last):
    h = hist(outcomes)
    r = client.post("/api/provider/next", json={"history": h, "last": {"beatId": last[0], "kind": last[1], "success": last[2], "choiceId": last[3], "summary": "x"}})
    return r


def test_offline_is_503_so_frontend_falls_back():
    assert client.post("/api/provider/begin", json={"party": PARTY}).status_code == 503


def test_full_happy_path_follows_engine_contract(monkeypatch):
    monkeypatch.setattr("app.gemini._generate", fake_text)
    b = client.post("/api/provider/begin", json={"party": PARTY}).json()
    assert b["id"] == "intro" and b["narration"] and "challenge" not in b

    seq = [
        (("intro", "story", True, None), "frost-spell"),
        (("frost-spell", "freeze", True, None), "spirit-gift"),
        (("spirit-gift", "story", True, None), "crossroads"),
        (("crossroads", "vote", True, "cave"), "gate"),
        (("gate", "pose", True, None), "lantern-fairy"),
        (("lantern-fairy", "vote", True, "free"), "fairy-joins"),
        (("fairy-joins", "story", True, None), "boss"),
        (("boss", "boss", True, None), "ending-victory"),
    ]
    done = []
    for last, expected in seq:
        done.append(last)
        beat = step(None, done[:-1], last).json()
        assert beat["id"] == expected, (last, beat["id"])
        assert beat["narration"]
    assert beat["isEnding"] is True


def test_failures_branch_to_encounters_and_scale_boss(monkeypatch):
    monkeypatch.setattr("app.gemini._generate", fake_text)
    assert step(None, [], ("frost-spell", "freeze", False, None)).json()["encounter"]["enemy"] == "shadow-wisp"
    assert step(None, [], ("gate", "pose", False, None)).json()["encounter"]["enemy"] == "thorn-imp"
    prior = [("frost-spell", "freeze", False, None), ("gate", "pose", False, None), ("crossroads", "vote", True, "cave")]
    boss = step(None, prior, ("hurry-on", "story", True, None)).json()
    assert boss["id"] == "boss" and boss["boss"]["kind"] == "shadow-dragon" and boss["boss"]["maxHp"] == 20


def test_vote_labels_and_defeat(monkeypatch):
    monkeypatch.setattr("app.gemini._generate", fake_text)
    v = step(None, [], ("shadow-ambush", "encounter", True, None)).json()["challenge"]
    assert [o["id"] for o in v["options"]] == ["castle", "cave"] and v["options"][0]["label"] == "Left path"
    r = client.post("/api/provider/next", json={"history": hist(hearts=0), "last": {"beatId": "gate", "kind": "pose", "success": False, "summary": ""}})
    assert r.json()["id"] == "ending-defeat"


def test_storybook(monkeypatch):
    out = provider.StorybookOut(title="T", pages=[provider.PageOut(heading=f"H{i}", text="x") for i in range(5)])
    monkeypatch.setattr("app.gemini._generate", lambda *a, **k: out)
    r = client.post("/api/provider/storybook", json={"history": hist(), "victory": True})
    assert r.json()["title"] == "T" and len(r.json()["pages"]) == 5
