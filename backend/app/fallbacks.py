"""Offline fallbacks so a Gemini failure never dead-ends the demo."""
from __future__ import annotations

import random
from typing import List

from .schemas import (
    Artifact,
    Challenge,
    Enemy,
    EndingRequest,
    Storybook,
    StoryEvent,
    StoryPage,
    StoryState,
)

_KEYWORD_ARTIFACTS = [
    (("bottle", "water", "flask", "cup"), Artifact(
        object="bottle", artifactName="Tidebreaker", artifactType="staff", element="water",
        ability="wave", damage=75, rarity="legendary",
        description="A staff that calls the tides to wash away every shadow.")),
    (("phone", "iphone", "remote", "tablet"), Artifact(
        object="phone", artifactName="Stormglass Mirror", artifactType="mirror", element="lightning",
        ability="bolt", damage=70, rarity="epic",
        description="A mirror that captures lightning and hurls it back.")),
    (("pencil", "pen", "marker", "stick"), Artifact(
        object="pencil", artifactName="Thornwrit Spear", artifactType="spear", element="nature",
        ability="pierce", damage=65, rarity="rare",
        description="A spear whose every word becomes a thorn.")),
    (("mug", "coffee", "bowl", "glass"), Artifact(
        object="mug", artifactName="Dragon's Ember Chalice", artifactType="chalice", element="fire",
        ability="nova", damage=80, rarity="legendary",
        description="A chalice that holds a dragon's last ember.")),
]

_GENERIC = [
    Artifact(object="mystery object", artifactName="Moonlit Orb", artifactType="orb", element="light",
             ability="chain", damage=60, rarity="rare",
             description="An orb that glows brighter the braver its bearer."),
    Artifact(object="mystery object", artifactName="Frostbound Blade", artifactType="sword", element="ice",
             ability="meteor", damage=68, rarity="epic",
             description="A blade forged from the first winter."),
]


def fallback_artifact(hint: str = "") -> Artifact:
    h = hint.lower()
    for keys, art in _KEYWORD_ARTIFACTS:
        if any(k in h for k in keys):
            return art.model_copy()
    return random.choice(_GENERIC).model_copy()


# ---- Story ----------------------------------------------------------------
_SCRIPT = [
    ("forest", "freeze", "A witch's frost creeps through the Whispering Wood. Stand perfectly still!"),
    ("castle", "pose", "The castle gates will open only for a hero's pose. Strike the pose shown!"),
    ("cave", "vote", "The cave splits in two. Which path will you take?"),
    ("forest", "object_quest", "A forest spirit asks to see an object from your world."),
]


def fallback_event(state: StoryState) -> StoryEvent:
    last = state.totalChapters - 1
    failures = sum(1 for h in state.history if not h.success)
    if state.chapter >= last:
        return StoryEvent(
            narration="The Shadow Witch rises, her cloak swallowing the stars. This is the final stand!",
            environment="castle",
            challenge=Challenge(type="pose", difficulty=min(3, 1 + failures), prompt="Strike the hero pose to cast your spell!", durationSec=10),
            enemies=[Enemy(type="witch_minion", count=2)],
            isBoss=True, bossVariant="witch", bossHealth=min(10, 5 + failures),
        )
    env, ctype, line = _SCRIPT[state.chapter % len(_SCRIPT)]
    challenge = Challenge(type=ctype, difficulty=min(3, 1 + failures), prompt=line, durationSec=8)
    if ctype == "vote":
        challenge.options = ["Follow the glowing lanterns", "Take the quiet river path"]
    if ctype == "object_quest":
        challenge.requestedObject = "any everyday object"
    enemies: List[Enemy] = [Enemy(type="shadow_creature", count=1 + failures)] if failures else []
    return StoryEvent(narration=line, environment=env, challenge=challenge,
                      enemies=enemies, reward="star_bonus" if not failures else "none")


def fallback_storybook(req: EndingRequest) -> Storybook:
    names = " and ".join(p.name for p in req.state.players)
    if req.bossDefeated:
        outcome = "victory" if req.state.hearts >= 2 else "bittersweet"
        last = f"The Shadow Witch fell, and the kingdom sang the names of {names} for a hundred years."
    else:
        outcome, last = "defeat", f"The shadows won this night, but the tale of {names} is not over."
    return Storybook(
        title=f"The Tale of {names}", outcome=outcome,
        pages=[
            StoryPage(text=f"Once upon a time, {names} stepped into a kingdom of whispering woods.", environment="forest"),
            StoryPage(text=last, environment="castle"),
        ],
    )
