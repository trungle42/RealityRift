# RealityRift

An AI-powered interactive fairy-tale adventure for two players — HackTX 2026.

## Dev 1 visual edition

The game uses a cinematic 2.5D presentation: realistically proportioned rendered
heroes and creatures, perspective environment paintings, contact shadows,
animated mist, light rays, particles, and magical wards. PixiJS still owns the
gameplay; this is not a free-roaming 3D engine. All 15 artwork files ship locally
in `frontend/public/art` (about 3.6 MB total), including four poses per hero.

The title menu and character setup adapt to narrow windows. Gameplay keeps a
16:9 view so combat positions stay consistent. The Controls button opens a guide
and pauses the adventure. Inactive tabs also pause the game clock.

See [the Dev 1 review](docs/dev1-review.md) for verified requirements, fixes,
integration boundaries, and checks, and [art direction](docs/art-direction.md)
for asset provenance and generation prompts.

## Run the game

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` type-checks and produces `frontend/dist`.

## Verify Dev 1

```bash
cd frontend
npm test
npm run build
```

While the dev server is running, open
`http://localhost:5173/tests/playthrough.html` and select **Run gameplay checks**.
This exercises the actual rendered challenge and combat routines with deterministic
test inputs, checks heart/star accounting, and checks actor/listener cleanup.
The harness is excluded from the production build. It also has three scene
preview buttons for visual QA. Test TypeScript is included in the build's typecheck.

For a production smoke test, run `npm run preview -- --port 4173` after building.

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
