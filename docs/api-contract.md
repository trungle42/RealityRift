# Reality Rift API contract (Dev 2 → Dev 1 / Dev 3)

Base URL (dev): `http://localhost:8000`. Frontend dev server: `http://localhost:5173`.
Every endpoint **always returns 200 with a valid body** (`source` says `gemini` or `fallback`).
Types live in `backend/app/schemas.py`; the OpenAPI schema is at `/docs`.

## POST /api/beat (Storybound game loop)

Send the browser game state and the outcomes recorded since the previous beat:

```json
{
  "players": [{"name": "Ava", "stars": 2}, {"name": "Ben", "stars": 1}],
  "hearts": 3,
  "chapter": 1,
  "totalChapters": 5,
  "history": [{"challenge": "freeze", "success": true, "player": "Ava"}],
  "challengeOutcomes": [{"challenge": "pose", "success": false, "player": "Ben"}],
  "artifacts": [],
  "lastEnvironment": "forest"
}
```

Response: `{ "event": <StoryEvent>, "source": "gemini" | "fallback" }`.
`StoryEvent` uses only the environment, challenge, enemy, reward, and boss values
listed above. Vote beats have exactly two options; object quests name the
requested object. The backend decides whether this is the final chapter and
falls back to a scripted fairy-tale beat if Gemini fails validation or is
unavailable. Player names and outcome notes are size-limited and treated as
untrusted prompt data. Keep `GEMINI_API_KEY` on the server in `backend/.env`;
never send it to the browser.

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

## Run
```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # add GEMINI_API_KEY (never commit)
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest
```
Set `OFFLINE=1` to force canned responses (demo insurance).
