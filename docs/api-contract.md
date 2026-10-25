# Reality Rift API contract (Dev 2 → Dev 1 / Dev 3)

Base URL (dev): `http://localhost:8000`. Frontend dev server: `http://localhost:5173`.
Every endpoint **always returns 200 with a valid body** (`source` says `gemini` or `fallback`).
Types live in `backend/app/schemas.py`; the OpenAPI schema is at `/docs`.

## POST /api/artifact
Request: `{ "imageBase64": "<jpeg base64>", "mimeType": "image/jpeg" }` (downscale to ~512px first)
Response: `{ "artifact": { object, artifactName, artifactType, element, ability, damage(1-100), rarity, description }, "source" }`

Catalogs (exact values):
- artifactType: staff | spear | sword | mirror | chalice | orb
- element: fire | water | lightning | ice | nature | shadow | light
- ability: wave | bolt | nova | pierce | meteor | chain
- rarity: common | rare | epic | legendary

## POST /api/story/next
Request (the whole game state, sent after each challenge):
`{ players:[{name,stars}], hearts(0-3), chapter(0-based), totalChapters, history:[{challenge,success,player?,note?}], artifacts:[Artifact], lastEnvironment? }`
Response: `{ "event": { narration, environment, challenge:{type,difficulty 1-3,prompt,durationSec,options?,requestedObject?}, enemies:[{type,count}], reward, isBoss, bossVariant?, bossHealth? }, "source" }`

- environment: forest | castle | cave
- challenge.type: freeze | pose | vote | object_quest | mirror (`vote` always has exactly 2 `options`)
- enemies: shadow_creature | goblin | wolf | witch_minion
- reward: heart | star_bonus | artifact_buff | none
- bossVariant: witch | dragon | shadow_king. `isBoss` is true only when `chapter >= totalChapters-1`.

The **game engine** owns hearts/stars/combat; Gemini only chooses the next event from these options.

## POST /api/story/ending
Request: `{ state: <same as /story/next>, bossDefeated: boolean }`
Response: `{ storybook: { title, pages:[{text,environment}], outcome: victory|bittersweet|defeat }, "source" }`

## GET /api/health
`{ ok, gemini: boolean, model }`: `gemini:false` means key missing or `OFFLINE=1`.

## CV service (separate process, port 8001): webcam people + poses

> **LEGACY - this service is no longer in the repository.** The `cv/` pose service described below (port 8001, `WS /ws/cv`, poses and
> colour planes) was removed and replaced by the standalone tracker in [`cv_2/`](../cv_2/), which tracks a yellow, a blue and a red wand,
> recognises drawn shapes, and detects a phone slash and a jump. **That tracker has no server or WebSocket yet**; nothing here is
> implemented. For what it produces per frame (`Pipeline.process()`), see the "Output data" section of
> [`docs/yellow-tracker.html`](yellow-tracker.html) and [`cv_2/CLAUDE.md`](../cv_2/CLAUDE.md). The text below is kept only as a reference for
> anyone who re-adds a pose service, and must not be relied on.

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

## Run
```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # add GEMINI_API_KEY (never commit)
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest
```
Set `OFFLINE=1` to force canned responses (demo insurance).
