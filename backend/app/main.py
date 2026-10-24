from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from . import gemini  # noqa: E402
from .schemas import (  # noqa: E402
    ArtifactRequest, ArtifactResponse, BeatRequest, EndingRequest, EndingResponse,
    StoryEventResponse, StoryState,
)

app = FastAPI(title="Reality Rift API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
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
