"""Shared contracts. Gemini may only choose values from these catalogs.

Frontend types (frontend/src/contracts.ts) should mirror these.
"""
from __future__ import annotations

from typing import Annotated, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, StringConstraints

# ---- Catalogs (single source of truth) ------------------------------------
ArtifactType = Literal["staff", "spear", "sword", "mirror", "chalice", "orb"]
Element = Literal["fire", "water", "lightning", "ice", "nature", "shadow", "light"]
Ability = Literal["wave", "bolt", "nova", "pierce", "meteor", "chain"]
Rarity = Literal["common", "rare", "epic", "legendary"]

Environment = Literal["forest", "castle", "cave"]
ChallengeType = Literal["freeze", "pose", "vote", "object_quest", "mirror"]
EnemyType = Literal["shadow_creature", "goblin", "wolf", "witch_minion"]
RewardType = Literal["heart", "star_bonus", "artifact_buff", "none"]
BossVariant = Literal["witch", "dragon", "shadow_king"]


# ---- Artifact (object -> magical item) ------------------------------------
class Artifact(BaseModel):
    object: str = Field(description="What the real-world object is, e.g. 'water bottle'")
    artifactName: str = Field(description="Fairy-tale name, 2-4 words")
    artifactType: ArtifactType
    element: Element
    ability: Ability
    damage: int = Field(ge=1, le=100)
    rarity: Rarity
    description: str = Field(description="One sentence of fairy-tale flavor text")


class ArtifactRequest(BaseModel):
    # ~3 MB of base64 is plenty for a 512px JPEG; rejects accidental full-res frames.
    imageBase64: str = Field(min_length=8, max_length=3_000_000,
                             description="Base64 JPEG/PNG, no data: prefix needed")
    mimeType: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"


class VerifyRequest(BaseModel):
    imageBase64: str = Field(min_length=8, max_length=3_000_000)
    mimeType: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"
    object: str = Field(min_length=1, max_length=60, description="What the storyteller asked the player to show")


class VerifyResult(BaseModel):
    """What Gemini returns for a 'show me X' check."""
    match: bool = Field(description="True only if the requested object is clearly visible in the photo")
    seen: str = Field(max_length=80, description="Short name of the main object actually visible")


class VerifyResponse(BaseModel):
    match: bool
    seen: str
    source: Literal["gemini", "fallback"]


class GameEvent(BaseModel):
    session: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=40, pattern=r"^[a-z_]+$",
                      description="e.g. scan, challenge_result, boss_hit")
    # Flat, bounded: <=20 keys, scalar values, short keys/strings. Oversized input is rejected, not truncated.
    payload: Dict[Annotated[str, StringConstraints(max_length=40)],
                  Union[bool, int, float, Annotated[str, StringConstraints(max_length=200)]]] = Field(
        default_factory=dict, max_length=20)


class ScoreSubmission(BaseModel):
    team: str = Field(min_length=1, max_length=40)
    stars: int = Field(ge=0, le=999)
    hearts: int = Field(ge=0, le=3)
    outcome: Literal["victory", "bittersweet", "defeat"]
    artifact: str = Field(default="", max_length=60)


class ArtifactResponse(BaseModel):
    artifact: Artifact
    source: Literal["gemini", "fallback"]


# ---- Story ----------------------------------------------------------------
class Player(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    stars: int = Field(default=0, ge=0, le=999)


class HistoryEntry(BaseModel):
    challenge: ChallengeType
    success: bool
    player: Optional[str] = Field(default=None, max_length=32)
    note: Optional[str] = Field(default=None, max_length=500)


class StoryState(BaseModel):
    players: List[Player] = Field(min_length=1, max_length=4)
    hearts: int = Field(ge=0, le=3, default=3)
    chapter: int = Field(ge=0, default=0, description="0 = intro; boss is the last chapter")
    totalChapters: int = Field(ge=2, le=8, default=5)
    history: List[HistoryEntry] = Field(default_factory=list, max_length=40)
    artifacts: List[Artifact] = Field(default_factory=list, max_length=12)
    lastEnvironment: Optional[Environment] = None


class BeatRequest(StoryState):
    """Complete game context plus the outcomes just completed by the players."""

    challengeOutcomes: List[HistoryEntry] = Field(default_factory=list, max_length=8)


class Challenge(BaseModel):
    type: ChallengeType
    difficulty: int = Field(ge=1, le=3)
    prompt: str = Field(min_length=1, max_length=400, description="Instruction shown/read to players")
    durationSec: int = Field(ge=3, le=20)
    options: Optional[List[str]] = Field(default=None, max_length=2, description="For vote: exactly 2 paths")
    requestedObject: Optional[str] = Field(default=None, max_length=80, description="For object_quest")


class Enemy(BaseModel):
    type: EnemyType
    count: int = Field(ge=1, le=5)


class StoryEvent(BaseModel):
    narration: str = Field(min_length=1, max_length=1000, description="2-3 sentence fairy-tale narration")
    environment: Environment
    challenge: Challenge
    enemies: List[Enemy] = []
    reward: RewardType = "none"
    isBoss: bool = False
    bossVariant: Optional[BossVariant] = None
    bossHealth: Optional[int] = Field(default=None, ge=1, le=10)


class StoryEventResponse(BaseModel):
    event: StoryEvent
    source: Literal["gemini", "fallback"]


# ---- Ending / storybook ---------------------------------------------------
class StoryPage(BaseModel):
    text: str
    environment: Environment


class Storybook(BaseModel):
    title: str
    pages: List[StoryPage] = Field(min_length=2, max_length=8)
    outcome: Literal["victory", "bittersweet", "defeat"]


class EndingRequest(BaseModel):
    state: StoryState
    bossDefeated: bool


class EndingResponse(BaseModel):
    storybook: Storybook
    source: Literal["gemini", "fallback"]
