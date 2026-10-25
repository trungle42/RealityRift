# Storybound API contract (Dev 2 → Dev 1 / Dev 3)

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
The legacy catalogs are:

- Environment: `forest | castle | cave`.
- Challenge: `freeze | pose | vote | object_quest | mirror`, with difficulty 1–3,
  duration 3–20 seconds, and at most two vote options.
- Enemies: `shadow_creature | goblin | wolf | witch_minion` (1–5 per enemy).
- Reward: `heart | star_bonus | artifact_buff | none`.
- Boss variant: `witch | dragon | shadow_king`; boss health is 1–10.

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
  Artifact catalogs are defined in `backend/app/schemas.py`: type
  `staff | spear | sword | mirror | chalice | orb`; element
  `fire | water | lightning | ice | nature | shadow | light`; ability
  `wave | bolt | nova | pierce | meteor | chain`; rarity
  `common | rare | epic | legendary`; damage is 1–100.
- `POST /api/verify` accepts `{ "imageBase64": "...", "mimeType": "image/jpeg", "object": "a book" }`
  (same image limits as `/api/artifact`; `object` is 1–60 chars and treated as a name, never as an
  instruction). Returns `{ "match": boolean, "seen": string, "source": "gemini" | "fallback" }`.
  Without Gemini it returns `match: true` with `source: "fallback"` so a missing key never strands a player.
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

## CV service (separate process, port 8001): webcam people + poses
Lives in `cv/` (see `cv/README.md`). Tracks up to 2 people ("Person 1", "Person 2"; ids are reused,
so a 2-player game only ever sees 1 and 2), recognises a fixed pose list, and reports which
of two colour planes each person stands in.
CORS uses the same `CORS_ORIGINS`.

**`WS /ws/cv`**: one JSON message per processed frame (~20-35 fps), newest-wins:
```json
{ "t": 1729800000.1, "frame": {"w":640,"h":480}, "mirrored": true, "fps": 28.0, "latencyMs": 12,
  "zones": [
    {"id":"A","label":"Blue","color":"#3B82F6","x0":0.0,"x1":0.45,"occupants":[1]},
    {"id":"B","label":"Orange","color":"#F97316","x0":0.55,"x1":1.0,"occupants":[]}],
  "people": [{
    "id": 1, "name": "Person 1",
    "bbox": [x, y, w, h],
    "keypoints": [[x, y, conf], ...],
    "pose": { "label": "hands_up", "raw": "hands_up", "conf": 0.78, "stable": true, "heldSec": 0.9 },
    "zone": { "id": "A", "label": "Blue", "heldSec": 2.4 },
    "frozen": false, "motion": 0.12, "stillSec": 0.0
  }] }
```
- All coordinates are **normalized 0-1**. With `mirrored: true` (default; `CV_MIRROR=0` to turn off) x is flipped
  so the output matches a **mirrored (selfie) video**: show the camera with `transform: scaleX(-1)` and draw
  zones/keypoints directly from the payload. With `mirrored: false` they are in raw camera space.
- `zones` are two translucent vertical planes (full height, x ranges) with a neutral gap between them; draw them over
  the video in the given `color`. `occupants` lists the person ids currently standing in each plane.
  `person.zone.id` is `"A"`, `"B"` or `null` (in the gap / outside), based on the shoulder midpoint, debounced
  0.25 s with a little edge hysteresis; `heldSec` is how long they've been in it.
- `keypoints` are COCO-17 (`GET /api/cv/poses` → `keypointNames`); a keypoint with `conf < 0.3` is unseen.
- `pose.label` is one of `hands_up | left_hand_up | right_hand_up | t_pose | arms_crossed | hands_on_head | none`.
  "left/right" is the **player's own** left/right. `raw` is this frame's label; `label` is smoothed.
  Treat the pose as *made* when `pose.stable` is true (held ≥ 0.4 s); `heldSec` is how long.
- `frozen` is true after the person has been still ≥ 1 s (`motion` = body spread in shoulder-widths, `null` until there is history; `stillSec` = how long still).
- Needs the shoulders + nose in view (sit back from the laptop); wrists/elbows are needed for the pose to register.

`GET /api/cv/health` → `{ ok, camera, modelLoaded, device, fps, error }` (`device`: `cpu` | `mps` = CoreML | `cuda`)
`GET /api/cv/poses` → `{ poses: [...], keypointNames: [...] }`
`GET /api/cv/latest` → the newest WS payload (`people: []` before the first frame)
`GET /api/cv/stream` → MJPEG preview with skeleton overlay (debug: open in a tab)
