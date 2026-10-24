# PROPOSAL: Gemini contract for the top-down action-adventure version

Status: **draft for Dev 1 / Dev 3 to approve or edit** before I implement. Nothing here is built yet.
Principle (unchanged): the engine owns rules, movement, combat and rendering. Gemini picks from a fixed catalog and writes text.
Every endpoint returns within ~3 s, can be prefetched, and has a scripted fallback on the frontend.

## Catalog (Dev 1: change any id to match your engine, and I'll mirror it)
- areas: `village`, `whispering-forest`, `crystal-cave`, `castle`
- npc roles: `elder`, `fairy`, `blacksmith`, `lost-child`
- enemies: `shadow-wisp`, `thorn-imp`, `frost-wolf`
- bosses: `frost-witch`, `shadow-dragon`
- weapon forms (from the object scan): `sword`, `bow`, `staff`, `shield`
- gestures (Dev 3 emits, engine maps to actions): `swing` (slash), `draw-release` (shoot), `guard` (shield up), `cast` (arms up)

## 1. `POST /api/world/new` : once at game start
Request: `{ "party": [{"index":0,"name":"Ava"},{"index":1,"name":"Ben"}] }`
Response (`WorldPlan`):
```json
{
  "title": "The Ember Crown of Thistlewick",
  "intro": ["...2-3 narration lines..."],
  "steps": [
    {"id":"s1","area":"village","kind":"talk","npc":"elder","brief":"The elder asks for help"},
    {"id":"s2","area":"whispering-forest","kind":"defeat","enemies":[{"kind":"shadow-wisp","count":4}]},
    {"id":"s3","area":"crystal-cave","kind":"collect","item":"Moon Shard","enemies":[{"kind":"frost-wolf","count":2}]},
    {"id":"s4","area":"castle","kind":"boss","boss":"frost-witch"}
  ]
}
```
Server-validated: 3-5 steps, last is `boss`, every area/enemy/boss from the catalog, counts 1-6.

## 2. `POST /api/npc/talk` : each conversation
Request: `{ "npc":"elder", "area":"village", "step":"s1", "party":[...], "recent":["Ava defeated 4 wisps","Ben took 2 hits"], "choice": "optional id from the previous reply" }`
Response: `{ "lines":["..1-3 short lines.."], "choices":[{"id":"a","label":"..."},{"id":"b","label":"..."}] , "reward": null }`
`reward` may be `{"kind":"heart"|"damage-up"|"speed-up","name":"..."}` chosen from the catalog by the server, not by Gemini.

## 3. `POST /api/artifact` : object scan (exists today)
Adds `weaponForm` (one of the four above) and a short `onHitEffect` line. Gemini picks the form from the object's shape
(long thin -> sword/staff, curved -> bow, flat/round -> shield); element and ability are unchanged.

## 4. `POST /api/world/react` : optional one-liners at big moments
Request: `{ "moment":"boss-defeated"|"hero-down"|"area-cleared"|"item-found", "party":[...], "recent":[...] }`
Response: `{ "line":"..." }`. Fire-and-forget; skip it if slow.

## 5. `POST /api/provider/storybook` : ending (exists today)
Same shape; the history just comes from the new engine's events.

## Fallbacks
All endpoints return 503 on Gemini failure; the frontend uses a built-in scripted plan/dialogue/artifact. OFFLINE=1 forces it.

## What I need back
1. Dev 1: catalog ids, whether steps/areas fit your map, max number of areas.
2. Dev 3: gesture names and how the engine receives them.
