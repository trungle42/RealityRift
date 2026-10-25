# Storybound

**Don't just read the fairy tale. Become part of it.**

The frontend now includes a third-person 3D edition with free movement, an orbiting camera, exploration, combat, and the existing fairy-tale story progression. The forest sanctuary is the focus of its first detailed asset pass. See [3D adventure controls and setup](docs/3d-adventure.md). Rishaan's established 2.5D campaign is available with `?mode=classic`.

An AI-powered interactive fairy-tale adventure for two players, built for HackTX 2026 (theme: Fairy Tale).
Two heroes enter an enchanted kingdom. A Gemini-powered storyteller writes each scene from what the players
actually did (who froze, who missed a pose, which path they voted for), the engine runs the challenges and the boss
fight, and the game ends with a personalized storybook of that exact playthrough.

## How it works

```
 webcam / keyboard ──► game engine (PixiJS, runs in the browser) ──► StoryProvider ──► FastAPI ──► Google Gemini
   (input)              challenges, boss, hearts, stars            GeminiStory.ts      backend/        (text)
                                    ▲                                     │ 503 / timeout
                                    └──────────── ScriptedStory (offline fallback, per beat) ◄┘
```

- **The engine owns the rules.** Combat, hearts, stars, timing and animation are deterministic game code.
- **Gemini owns the story.** The backend fixes each beat's *structure* from a catalog the engine supports
  (environments, challenge types, enemies, boss kinds, rewards). Gemini only writes the text: narration, prompts,
  vote labels, reward names and the final storybook. It cannot invent mechanics the game cannot run.
- **It never blocks the game.** If the backend, network or Gemini fails, that beat falls back to the hand-written
  `ScriptedStory` (same beat ids), so a run can switch between the two mid-adventure.
- **Real-time stays local.** Rendering and (planned) hand/body tracking run in the browser; Gemini is called once
  per story beat, never per frame.

## Run it

Requirements: Node 20.19+, Python 3.9+, a Google Gemini API key (without one the game still plays, on the scripted story).

**1. Backend**

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then set GEMINI_API_KEY=... (never commit .env)
.venv/bin/uvicorn app.main:app --port 8000
```

**2. Frontend** (second terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, press Space, enter two hero names, and begin.

Useful switches: `OFFLINE=1` (backend) forces canned responses; `VITE_STORY=scripted` (frontend) skips the backend
entirely; `VITE_API_URL` points the game at a different backend (default `http://localhost:8000`).

## Controls (keyboard fallback)

| | Hero One | Hero Two |
|---|---|---|
| Vote left / right | A / D | ← / → |
| Cast spell | W | ↑ |
| Poses: arms up / T-pose / duck | 1 / 2 / 3 (or S to duck) | I / O / P (or ↓ to duck) |

Space or Enter advances narration. M toggles spoken narration. Any key a hero presses counts as movement during
freeze spells. Webcam input (MediaPipe) plugs into the same `InputSource` interface; see Status.

## The adventure

Freeze spell → (reward, or a shadow-wisp fight if you move) → crossroads vote → pose gate → (thorn-imp fight if you
miss) → rescue the lantern fairy or hurry on → boss fight → personalized ending and storybook. Failures make later
challenges and the boss harder; successes earn rewards that help in the final battle.

## Backend API

FastAPI app in `backend/app`. Full request/response shapes: [docs/api-contract.md](docs/api-contract.md).

| Endpoint | Purpose |
|---|---|
| `POST /api/provider/begin`, `/next`, `/storybook` | The game's story provider (shapes from `frontend/src/contracts.ts`). Returns 503 if Gemini is unavailable. |
| `POST /api/artifact` | Photo of a real object in, magical artifact out (name, type, element, ability, rarity). Not yet used by the game. |
| `POST /api/beat`, `/api/story/next`, `/api/story/ending` | Earlier generic story schema. |
| `POST /api/event`, `/api/score`, `GET /api/leaderboard`, `/api/stats` | Gameplay telemetry and a small leaderboard (SQLite). |
| `GET /api/health` | Whether the Gemini key is loaded and which model is in use. |

Gemini model defaults to `gemini-3.8-flash` (`GEMINI_MODEL`), with a 12 s timeout and thinking disabled for latency
(about 3 s per beat). The API key lives only in `backend/.env` and is never sent to the browser.

## Testing

```bash
cd backend && OFFLINE=1 .venv/bin/python -m pytest          # offline unit/contract tests
PYTHONPATH=. .venv/bin/python tools/live_smoke.py             # plays full runs against real Gemini (needs key)
.venv/bin/python tools/test_photos.py <folder-of-photos>      # run real object photos through /api/artifact
cd ../frontend && npm run build                               # type-check + production build
```

## Repository layout

```
frontend/src/   contracts.ts (shared types), game/ (loop, stage, state), challenges/ (freeze, pose, vote, encounter, boss),
                world/, fx/, ui/, screens/, audio/, input/KeyboardInput, story/ (ScriptedStory, GeminiStory)
backend/app/    main.py (routes), provider.py (engine story provider), gemini.py (Gemini calls), schemas.py,
                fallbacks.py, store.py (telemetry/leaderboard)
backend/tools/  live_smoke.py, test_photos.py
docs/           api-contract.md
```

## Status

Working: two-player game with keyboard input, freeze, pose, vote, enemy-wave and boss mechanics, Gemini
storyteller with per-beat fallback, personalized storybook, telemetry and leaderboard APIs.
In progress: webcam body/hand input via MediaPipe (replaces the keyboard fallback). Planned: the object-scan moment
(hold up a real object, Gemini turns it into a magical artifact for the boss fight).

## Team

Three developers: game and visuals; AI and backend; computer vision and integration.
