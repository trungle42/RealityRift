"""Shared contracts. Gemini may only choose values from these catalogs.

Frontend (Dev 1/3) types should mirror these; see docs/api-contract.md.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

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
    imageBase64: str = Field(description="Base64 JPEG/PNG, no data: prefix needed")
    mimeType: str = "image/jpeg"


class ArtifactResponse(BaseModel):
    artifact: Artifact
    source: Literal["gemini", "fallback"]


# ---- Story ----------------------------------------------------------------
class Player(BaseModel):
    name: str
    stars: int = 0


class HistoryEntry(BaseModel):
    challenge: ChallengeType
    success: bool
    player: Optional[str] = None
    note: Optional[str] = None


class StoryState(BaseModel):
    players: List[Player] = Field(min_length=1, max_length=4)
    hearts: int = Field(ge=0, le=3, default=3)
    chapter: int = Field(ge=0, default=0, description="0 = intro; boss is the last chapter")
    totalChapters: int = Field(ge=2, le=8, default=5)
    history: List[HistoryEntry] = []
    artifacts: List[Artifact] = []
    lastEnvironment: Optional[Environment] = None


class Challenge(BaseModel):
    type: ChallengeType
    difficulty: int = Field(ge=1, le=3)
    prompt: str = Field(description="Instruction shown/read to players")
    durationSec: int = Field(ge=3, le=20)
    options: Optional[List[str]] = Field(default=None, description="For vote: exactly 2 paths")
    requestedObject: Optional[str] = Field(default=None, description="For object_quest")


class Enemy(BaseModel):
    type: EnemyType
    count: int = Field(ge=1, le=5)


class StoryEvent(BaseModel):
    narration: str = Field(description="2-3 sentence fairy-tale narration")
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
