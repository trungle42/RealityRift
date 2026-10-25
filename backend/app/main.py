from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from fastapi import HTTPException  # noqa: E402

from . import gemini, provider, store  # noqa: E402
from .schemas import (  # noqa: E402
    ArtifactRequest, ArtifactResponse, BeatRequest, EndingRequest, EndingResponse,
    GameEvent, ScoreSubmission, StoryEventResponse, StoryState,
)

app = FastAPI(title="Storybound API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    # Any local dev port (the 3D game runs on its own Vite port), plus explicit CORS_ORIGINS above.
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX", r"http://(localhost|127\.0\.0\.1)(:\d+)?"),
    allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "gemini": gemini._get_client() is not None, "model": gemini.MODEL}


# Plain `def` handlers run in FastAPI's threadpool, so the blocking Gemini SDK call
# doesn't stall other requests.
@app.post("/api/artifact", response_model=ArtifactResponse)
def artifact(req: ArtifactRequest):
    art, source = gemini.make_artifact(req.imageBase64, req.mimeType)
    return ArtifactResponse(artifact=art, source=source)


@app.post("/api/story/next", response_model=StoryEventResponse)
def story_next(state: StoryState):
    event, source = gemini.next_event(state)
    return StoryEventResponse(event=event, source=source)


@app.post("/api/beat", response_model=StoryEventResponse)
def beat(req: BeatRequest):
    """Generate one supported story beat from player history and fresh outcomes."""
    state = StoryState.model_validate(
        req.model_dump(exclude={"challengeOutcomes"})
    )
    state.history = (state.history + req.challengeOutcomes)[-40:]
    event, source = gemini.next_event(state)
    return StoryEventResponse(event=event, source=source)


@app.post("/api/story/ending", response_model=EndingResponse)
def story_ending(req: EndingRequest):
    book, source = gemini.make_storybook(req)
    return EndingResponse(storybook=book, source=source)


# ---- Telemetry + leaderboard (fire-and-forget; must never break gameplay) ----
@app.post("/api/event")
def event(ev: GameEvent):
    try:
        store.log_event(ev.session, ev.type, ev.payload)
    except Exception:
        return {"ok": False}
    return {"ok": True}


@app.post("/api/score")
def score(s: ScoreSubmission):
    store.add_score(s.team, s.stars, s.hearts, s.outcome, s.artifact)
    return {"ok": True, "leaderboard": store.leaderboard()}


@app.get("/api/leaderboard")
def leaderboard():
    return {"leaderboard": store.leaderboard()}


@app.get("/api/stats")
def stats():
    return store.stats()


# ---- Dev 1 engine's StoryProvider (frontend/src/contracts.ts) ----------------
# 503 = Gemini unavailable; the frontend then uses ScriptedStory for that beat.
def _provider(fn, *args):
    try:
        return fn(*args)
    except provider.Unavailable:
        raise HTTPException(status_code=503, detail="storyteller unavailable")


@app.post("/api/provider/begin")
def provider_begin(req: provider.BeginRequest):
    return _provider(provider.begin, req.party)


@app.post("/api/provider/next")
def provider_next(req: provider.NextRequest):
    return _provider(provider.next_beat, req)


@app.post("/api/provider/storybook")
def provider_storybook(req: provider.StorybookRequest):
    return _provider(provider.storybook, req)
