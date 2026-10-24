# RealityRift

An AI-powered interactive fairy-tale adventure for two players — HackTX 2026.

## Run the game

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` type-checks and produces `frontend/dist`.

## Keyboard controls

| | Hero One | Hero Two |
|---|---|---|
| Vote left / right | A / D | ← / → |
| Cast spell | W | ↑ |
| Poses: arms up / T-pose / duck | 1 / 2 / 3 (or S to duck) | I / O / P (or ↓ to duck) |

Space or Enter advances narration. M toggles spoken narration. Any key a hero presses counts as movement during freeze spells.

## Layout

```
frontend/src/
  contracts.ts        Shared types: StoryProvider, InputSource, StoryBeat, BeatOutcome…
  main.ts             Boot; picks the StoryProvider and InputSource
  game/               Game loop (Game), shared rules (Stage), hearts/stars/history (GameState)
  challenges/         freeze, pose, vote, encounter (enemy waves), boss
  world/              Backdrop (forest / castle / cave), Hero, Enemy, Boss, Fairy
  fx/                 Particles, spell bolts, shake, flash, frost overlay
  ui/                 HUD, narration panel, banners, prompt card, boss bar
  screens/            Title, party setup, storybook
  story/ScriptedStory Phase 1 branching tale (also the offline fallback)
  input/KeyboardInput Keyboard fallback controls
  audio/              Synthesized sound effects, browser text-to-speech narrator
```

## Integration points

- **AI / backend (Dev 2):** implement `StoryProvider` from `contracts.ts` (e.g. a client for the FastAPI + Gemini service) and swap it in for `ScriptedStory` in `main.ts`. Each beat chooses from the supported catalog — environments, challenge types, enemy kinds, boss kinds and attacks, reward kinds — and the engine reports a `BeatOutcome` with a plain-English `summary` after every beat. `stage.think()` already shows a "storyteller ponders…" indicator while a request is in flight.
- **Computer vision / hardware (Dev 3):** implement `InputSource` (per-frame `motion` 0–1 and `pose` per player, plus `cast` / `left` / `right` / `confirm` events) and swap it in for `KeyboardInput` in `main.ts`.
