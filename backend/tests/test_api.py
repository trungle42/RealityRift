import os

os.environ["OFFLINE"] = "1"  # tests never hit the network

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

PLAYERS = [{"name": "Ava"}, {"name": "Ben"}]


def test_health():
    assert client.get("/api/health").json()["ok"] is True


def test_artifact_fallback_is_valid():
    r = client.post("/api/artifact", json={"imageBase64": "AAAAAAAA"})
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


def test_beat_returns_scripted_fairy_tale_event_from_player_history():
    response = client.post(
        "/api/beat",
        json={
            "players": PLAYERS,
            "chapter": 0,
            "totalChapters": 5,
            "history": [{"challenge": "freeze", "success": True, "player": "Ava"}],
            "challengeOutcomes": [{"challenge": "pose", "success": False, "player": "Ben"}],
        },
    )

    body = response.json()
    assert response.status_code == 200
    assert body["source"] == "fallback"
    assert body["event"]["environment"] in {"forest", "castle", "cave"}
    assert body["event"]["challenge"]["type"] in {
        "freeze", "pose", "vote", "object_quest", "mirror"
    }
    assert "Ava" in body["event"]["narration"] or "Ben" in body["event"]["narration"]


def test_beat_rejects_unsupported_challenge_outcomes():
    response = client.post(
        "/api/beat",
        json={
            "players": PLAYERS,
            "challengeOutcomes": [{"challenge": "invented", "success": True}],
        },
    )

    assert response.status_code == 422


def test_beat_does_not_allow_a_boss_before_the_final_chapter(monkeypatch):
    from app.schemas import StoryEvent

    monkeypatch.setattr(
        "app.gemini._generate",
        lambda *_args, **_kwargs: StoryEvent(
            narration="A fairy tale continues.",
            environment="forest",
            challenge={"type": "pose", "difficulty": 1, "prompt": "Pose!", "durationSec": 5},
            isBoss=True,
            bossVariant="dragon",
            bossHealth=10,
        ),
    )

    response = client.post(
        "/api/beat",
        json={"players": PLAYERS, "chapter": 0, "totalChapters": 5},
    )

    assert response.status_code == 200
    assert response.json()["event"]["isBoss"] is False
    assert response.json()["event"]["bossVariant"] is None


def test_beat_final_chapter_uses_only_supported_boss_values():
    response = client.post(
        "/api/beat",
        json={"players": PLAYERS, "chapter": 4, "totalChapters": 5},
    )

    event = response.json()["event"]
    assert response.status_code == 200
    assert event["isBoss"] is True
    assert event["bossVariant"] in {"witch", "dragon", "shadow_king"}


def test_beat_falls_back_when_gemini_returns_an_incomplete_vote(monkeypatch):
    from app.schemas import StoryEvent

    monkeypatch.setattr(
        "app.gemini._generate",
        lambda *_args, **_kwargs: StoryEvent(
            narration="A path opens beneath the old oak.",
            environment="forest",
            challenge={"type": "vote", "difficulty": 1, "prompt": "Choose.", "durationSec": 5},
        ),
    )

    response = client.post(
        "/api/beat",
        json={"players": PLAYERS, "chapter": 2, "totalChapters": 5},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fallback"
    assert len(body["event"]["challenge"]["options"]) == 2


def test_beat_bounds_untrusted_player_notes():
    response = client.post(
        "/api/beat",
        json={
            "players": PLAYERS,
            "history": [{"challenge": "freeze", "success": True, "note": "x" * 501}],
        },
    )

    assert response.status_code == 422


def test_artifact_rejects_oversized_and_bad_mime():
    assert client.post("/api/artifact", json={"imageBase64": "A" * 3_000_001}).status_code == 422
    assert client.post("/api/artifact", json={"imageBase64": "AAAAAAAA", "mimeType": "text/html"}).status_code == 422


def test_event_score_and_leaderboard():
    from app import store

    store.reset_for_tests()
    assert client.post("/api/event", json={"session": "s1", "type": "scan", "payload": {"obj": "mug"}}).json()["ok"]
    assert client.post("/api/event", json={"session": "s1", "type": "Bad Type!"}).status_code == 422
    client.post("/api/score", json={"team": "A", "stars": 3, "hearts": 1, "outcome": "victory", "artifact": "Tidebreaker"})
    r = client.post("/api/score", json={"team": "B", "stars": 9, "hearts": 3, "outcome": "victory"})
    board = r.json()["leaderboard"]
    assert [row["team"] for row in board] == ["B", "A"]
    assert client.get("/api/stats").json()["events"]["scan"] == 1


def test_event_payload_is_bounded():
    big = {f"k{i}": 1 for i in range(21)}
    assert client.post("/api/event", json={"session": "s", "type": "scan", "payload": big}).status_code == 422
    assert client.post("/api/event", json={"session": "s", "type": "scan", "payload": {"a": {"nested": 1}}}).status_code == 422
    assert client.post("/api/event", json={"session": "s", "type": "scan", "payload": {"a": "x" * 201}}).status_code == 422


def test_verify_accepts_offline_and_rejects_bad_input():
    r = client.post("/api/verify", json={"imageBase64": "AAAAAAAA", "object": "a book"})
    assert r.status_code == 200 and r.json() == {"match": True, "seen": "", "source": "fallback"}
    assert client.post("/api/verify", json={"imageBase64": "AAAAAAAA"}).status_code == 422
    assert client.post("/api/verify", json={"imageBase64": "AAAAAAAA", "object": "x" * 61}).status_code == 422
    assert client.post("/api/verify", json={"imageBase64": "A" * 3_000_001, "object": "a book"}).status_code == 422
