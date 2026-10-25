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

## CV (webcam tracking)
The tracker in [`cv_2/`](../cv_2/) is a separate Python process. `python -m tools.publish` (run in `cv_2/`, options
`--api http://localhost:8000 --room storybound --window`) sends a small message per frame to the backend relay, which passes it
to the game. The full per-frame data from `Pipeline.process()` is documented in the "Output data" section of
[`docs/yellow-tracker.html`](yellow-tracker.html); decisions and measurements are in [`cv_2/CLAUDE.md`](../cv_2/CLAUDE.md).

### `WS /ws/cv/{room}?role=tracker|game`
Relay in `backend/app/cv.py`, the same pattern as `/ws/joystick/{room}`. **Only this laptop may connect:** the backend listens on
the network (`--host 0.0.0.0`) so the phone can reach `/joystick`, and the relay carries the player's webcam picture, so a client
that is not loopback (`127.0.0.1`, `::1`) is refused (closed with 1008 before the handshake completes, HTTP 403) unless the backend
runs with `CV_ALLOW_REMOTE=1`, for a deliberate multi-machine setup. The tracker and the game always run on the same laptop; the
phone only uses `/ws/joystick`, which stays open to the network. **And only the game's own pages:** any web page open in the
player's browser also connects from loopback, so a connection that sends an `Origin` header (browsers always do) must come from
`CORS_ORIGINS` or match `CORS_ORIGIN_REGEX` (the backend's CORS rule; default any `http://localhost` or `http://127.0.0.1` port),
or it is refused the same way. The Python tracker sends no `Origin` and is allowed. `room` is 1-32 of `A-Za-z0-9_-`; the game uses its `?room=` URL
parameter (default `storybound`), shared with the phone joystick. A bad room or role is closed with code 1008. Each side gets
`{type:"peer", role, state:"joined"|"left"}` when the other side connects or leaves, and a newcomer is told who is already there.
Every message is rebuilt from the fields below (types checked, numbers clamped, names limited to `^[a-z][a-z0-9_-]{0,15}$`, at most
8 colours and 400 trace points per colour, pictures capped as below), so neither side can push arbitrary data into the other.

Tracker -> game, one per camera frame (~25-30 a second; the tracker skips frames rather than queue them):
```json
{ "type": "cv", "slash": 3, "jump": 1, "motion": 0.042, "phone": { "x": 0.18, "y": 0.64, "radius": 0.07 },
  "wands": { "yellow": { "x": 0.51, "y": 0.40, "radius": 0.03 }, "blue": null, "red": null },
  "wand": { "active": true, "secondsLeft": 3.2, "target": "circle", "next": "triangle",
            "shapes": { "yellow": { "shape": "circle", "score": 0.12 }, "blue": null, "red": null },
            "complete": { "yellow": true, "blue": false, "red": false },
            "traces": { "yellow": [[[0.51, 0.40], [0.52, 0.42]]], "blue": [], "red": [] } } }
```
- `slash` and `jump` are **running counts**: act when one goes up (the first value seen, or one that goes down after a tracker
  restart, is a new baseline). The tracker's game hold is 0.5 s between slashes (`--slash-hold`) and 2 s between jumps. A jump is
  reported at the landing.
- `motion` is the fraction of the picture moving (0-1), or `null` before the second frame. The game counts the player as moving in
  the freeze trial at `>= 0.06` (`FREEZE_MOTION` in `frontend/src/adventure/cvMath.ts`). People walking behind the player count too.
- `wand` is the wand round (`CvInput.wand()`, and the `complete` handler); `null` if malformed. Coordinates are 0-1 of the picture,
  x mirrored (selfie view); traces are thinned to at most 200 points per colour. While a game is in the room the game drives it
  (below): `active` is the game's on/off, `target` the shape it asked for or `null` for any preset, `next` is `null` and
  `secondsLeft` 0. A colour's stroke starts where its wand was last held still (0.4 s within 0.025 of the picture height), and
  `complete[colour]` turns true when the stroke closes on a preset (the target, if one was asked for), with `shapes[colour]` naming
  it. It stays true for 0.8 s, then that colour's trace is erased and the wand can draw again: **each false -> true edge is one
  completed shape**. With no game in the room the tracker runs its own demo round (5 s on/off timer, targets cycling, `complete`
  latched for the round), as described in the "Output data" section.

- `phone` is the phone's marker `{x, y, radius}` (0-1, x mirrored, radius a fraction of the width), or `null` when not seen.
  `wands` is the same per wand colour (`{"yellow": {...} | null, ...}`), for the game's setup hints.

Tracker -> game, the camera picture (the tracker is the only program that opens the webcam; the game shows this in the wand panel
and on the scan screen), about 9 a second, newest wins:
```json
{ "type": "frame", "w": 224, "h": 168, "jpeg": "/9j/4AAQ..." }
```
A base64 JPEG, mirrored like a selfie, at most 24,000 base64 characters (a 224 px picture is ~2-10 KB). And, once per request
below, one full-size unmirrored picture for a scan (at most 200,000 characters; 512 px wide):
```json
{ "type": "snapshot", "id": 3, "w": 512, "h": 384, "jpeg": "/9j/4AAQ..." }
```
The relay only passes pictures from the tracker to the game, checks they are base64 starting `/9j/` (a JPEG) within the cap, and
never stores them.

Game -> tracker, a picture for the scanner (`CvInput.snapshot()`, answered by the `snapshot` above with the same `id`):
```json
{ "type": "snapshot", "id": 3 }
```

Game -> tracker:
```json
{ "type": "gate", "on": true, "target": "star" }
```
Hands the wand to the game. `tools.publish` applies it to `Pipeline.control(on, target)`: on/off, and the shape to draw (`null`, or a
name the tracker does not know, means any preset). A change starts a fresh round (traces and completed shapes cleared); repeating
the same message does nothing. When the game leaves the room the tracker goes back to its demo timer. `CvInput` sends
`{on: true, target: null}` whenever a tracker joins, and a pose seal asks for its rune (`POSE_SHAPE` in `cvMath.ts`) until the seal
ends.
