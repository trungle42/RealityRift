import os

os.environ["OFFLINE"] = "1"  # tests never hit the network

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

PLAYERS = [{"name": "Ava"}, {"name": "Ben"}]


def test_health():
    assert client.get("/api/health").json()["ok"] is True


def test_artifact_fallback_is_valid():
    r = client.post("/api/artifact", json={"imageBase64": "AAAA"})
    body = r.json()
    assert r.status_code == 200 and body["source"] == "fallback"
    assert 1 <= body["artifact"]["damage"] <= 100


def test_story_chapters_and_boss():
    r = client.post("/api/story/next", json={"players": PLAYERS, "chapter": 0, "totalChapters": 5})
    assert r.status_code == 200 and r.json()["event"]["isBoss"] is False
    r = client.post("/api/story/next", json={"players": PLAYERS, "chapter": 4, "totalChapters": 5})
    ev = r.json()["event"]
    assert ev["isBoss"] and ev["bossVariant"] and ev["bossHealth"]


def test_failures_raise_difficulty():
    hist = [{"challenge": "freeze", "success": False}] * 2
    r = client.post("/api/story/next", json={"players": PLAYERS, "chapter": 1, "history": hist})
    assert r.json()["event"]["challenge"]["difficulty"] == 3


def test_ending():
    state = {"players": PLAYERS, "hearts": 3, "chapter": 4}
    r = client.post("/api/story/ending", json={"state": state, "bossDefeated": True})
    assert r.json()["storybook"]["outcome"] == "victory"


def test_bad_input_rejected():
    assert client.post("/api/story/next", json={"players": []}).status_code == 422
