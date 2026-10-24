# Reality Rift API contracts

Development defaults: backend `http://localhost:8000`, frontend `http://localhost:5173`.
The service exposes two different story interfaces. The playable engine uses
`/api/provider/*` and the `StoryProvider` types in `frontend/src/contracts.ts`.
`/api/beat` and `/api/story/*` use the separate `StoryEvent` schema in
`backend/app/schemas.py`; their event payloads are not interchangeable with
`StoryBeat`.

## Engine story provider

The engine calls these endpoints through `frontend/src/story/GeminiStory.ts`.
Successful responses are the JSON object shown below directly (there is no
`event` or `source` wrapper). When Gemini is unavailable or returns unusable
text, these endpoints return HTTP 503. The frontend catches that error and
uses `ScriptedStory` for the beat.

### `POST /api/provider/begin`

Request:

```json
{
  "party": [
    {"index": 0, "name": "Ava"},
    {"index": 1, "name": "Ben"}
  ]
}
```

Returns a `StoryBeat`, initially the narration-only `intro` beat.

### `POST /api/provider/next`

Request follows `GameHistory` plus the most recently completed `BeatOutcome`.
The engine's `perPlayer` and `heartsLost` fields are accepted but are not used
to plan the next beat; planning uses `beatId`, `kind`, `success`, `choiceId`,
`summary`, party, hearts, rewards, and environment history.

```json
{
  "history": {
    "party": [{"index": 0, "name": "Ava"}, {"index": 1, "name": "Ben"}],
    "hearts": 3,
    "maxHearts": 3,
    "stars": [0, 0],
    "rewards": [],
    "outcomes": [],
    "environments": ["forest"]
  },
  "last": {
    "beatId": "intro",
    "kind": "story",
    "success": true,
    "perPlayer": [{"success": true, "stars": 0}, {"success": true, "stars": 0}],
    "heartsLost": 0,
    "summary": "The heroes enter the wood."
  }
}
```

`kind` is `story | freeze | pose | vote | encounter | boss`. A vote may include
`choiceId`. The server bounds names, history, and text fields and restricts
environments and outcome kinds to the engine's supported values.

### `POST /api/provider/storybook`

Request: `{ "history": <GameHistory>, "victory": true }`.

Returns a `Storybook` directly:

```json
{"title": "The Moonpetal Quest", "pages": [{"heading": "Once Upon a Time", "text": "..."}]}
```

### Engine response shapes

`StoryBeat` has `id`, `chapter`, `environment`, and `narration` (an array of
paragraphs), with optional `speaker`, `reward`, `challenge`, `encounter`,
`boss`, and `isEnding`. `environment` is `forest | castle | cave`. At most one
of `challenge`, `encounter`, and `boss` is present on a beat.

The supported challenges mirror the frontend discriminated union:

- `freeze`: `prompt`, `durationSec`, and `tolerance`.
- `pose`: `prompt`, `poses` (`arms-up | t-pose | crouch`), and `secondsPerPose`.
- `vote`: `prompt`, exactly two `{id, label}` options, and `timeLimitSec`.

Encounters use `enemy: shadow-wisp | thorn-imp`, `count`, and `speed`. Bosses
use `kind: frost-witch | shadow-dragon`, `name`, `maxHp`, attacks
`frost-gaze | shadow-wave`, `telegraphSec`, and `vulnerableSec`. Rewards use
`heart | boss-weaken | fairy-ally | quick-cast`, with `name` and `description`.
An ending beat has `isEnding: true` and no challenge, encounter, or boss.

The backend owns beat structure and branching to keep gameplay values valid;
Gemini supplies narration and may rewrite challenge prompts, vote labels, and
reward text. It does not select mechanics or catalog values.

## Separate `StoryEvent` API

These routes are retained for clients using `backend/app/schemas.py`'s older
`StoryState` / `StoryEvent` contract. Their responses must not be passed to the
engine's `StoryProvider`.

### `POST /api/beat`

Accepts a `StoryState` plus optional `challengeOutcomes`. The state contains
`players`, `hearts`, `chapter`, `totalChapters`, `history`, `artifacts`, and
`lastEnvironment`. Returns
`{ "event": <StoryEvent>, "source": "gemini" | "fallback" }`.
`StoryEvent` has one narration string, an environment, a challenge, enemies,
reward, and boss fields from the legacy catalogs in `backend/app/schemas.py`.

### `POST /api/story/next`

Accepts `StoryState` and returns the same wrapped `StoryEvent` response as
`/api/beat`, without the additional `challengeOutcomes` field.

### `POST /api/story/ending`

Accepts `{ "state": <StoryState>, "bossDefeated": boolean }` and returns
`{ "storybook": <legacy Storybook>, "source": "gemini" | "fallback" }`.
This legacy storybook uses pages with `text` and `environment`, and an
`outcome` of `victory | bittersweet | defeat`.

## Artifact, health, and telemetry endpoints

- `POST /api/artifact` accepts `{ "imageBase64": "...", "mimeType": "image/jpeg" }`;
  image data is limited to 3,000,000 characters and MIME type to JPEG, PNG, or
  WebP. Returns `{ "artifact": <Artifact>, "source": "gemini" | "fallback" }`.
  Artifact catalogs are defined in `backend/app/schemas.py`.
- `GET /api/health` returns `{ "ok": true, "gemini": boolean, "model": string }`.
- `POST /api/event` records bounded telemetry and returns `{ "ok": boolean }`.
- `POST /api/score` submits a score and returns `{ "ok": true, "leaderboard": [...] }`.
- `GET /api/leaderboard` returns `{ "leaderboard": [...] }`;
  `GET /api/stats` returns aggregate game and event counts.

## Local development

Install backend dependencies and run the offline suite:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
OFFLINE=1 .venv/bin/python -m pytest
```

To run the server, copy `.env.example` to `.env` and configure
`GEMINI_API_KEY` locally. Keep the key on the server; never send it to the
browser or commit `.env`. Set `OFFLINE=1` to force canned responses. The
frontend can force the scripted provider with `VITE_STORY=scripted`; set
`VITE_API_URL` to point it at a backend other than `http://localhost:8000`.

Telemetry and scores are stored in SQLite (`DB_PATH`, default
`reality_rift.db`).
