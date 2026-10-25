# Storybound 3D adventure

The default frontend entry now opens an original third-person fairy-tale adventure. It incorporates Rishaan's campaign update (`9dcd44b`), reuses its landmark names and lore, and keeps the same `StoryProvider` and `GameHistory` contracts. Backend code is unchanged by this work.

## Run

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173/?story=scripted` for fully local play. The default story selection still uses Gemini with `ScriptedStory` as fallback. `VITE_STORY=scripted` also forces local play. Rishaan's 2.5D campaign remains at `?mode=classic` (and retains the Gemini adapter).

## Play

WASD moves the ranger relative to the camera. Drag the world to orbit the camera; the wheel zooms, and C/V also rotate it. Shift sprints, Space jumps, E interacts, J strikes with the sword, F casts, Q dodges, and M opens the map and journal. The companion follows and casts automatically; arrow keys give a second player direct movement control and `/` casts for that player.

Walk to the golden beacon to begin the next story encounter. Story choices, freeze, pose seals, encounters, and bosses use the existing beat ids and catalog. Hold 1/2/3 for arms-up, T-pose, and crouch; the second player's equivalents are I/O/P. An automatic companion mirrors pose challenges and defends boss warnings. Boss wards reject damage during their warning, then open for attacks. Treasure and springs are claimed once; a full-health party preserves a spring for later. Progress lasts for this adventure; refresh starts a new one.

## Asset pipeline

`frontend/scripts/build-3d-kit.py` is editable Blender source for the original GLB kit. Run from `frontend/`:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-3d-kit.py
```

It exports rigged ranger and spellweaver models, named animation clips, carved ruin arches, an oak kit, a moonwell, and tiled terrain textures under `public/models/`. Assets are local and do not require Blender at runtime. The forest is the focus of the detailed pass. Several supporting props and boss models still use simpler geometry; this is not a claim of final production artwork throughout the entire game.

## Verification

- `npm test`: existing campaign/rules tests plus 3D collision, camera obstruction, terrain, actual landmark reachability, and embedded GLB skeleton/animation checks.
- `npm run build`: strict TypeScript check and production bundle for both editions.
- `/tests/adventure.html?story=scripted`: rendered 3D input, rewards, dialogue, story transitions, choices, pose seals, spells, boss ward, solo defense, and ending checks.
- `/tests/campaign.html` and `/tests/playthrough.html`: Rishaan's original rendered regression harnesses.

The development harnesses are excluded from the production bundle. Live Gemini and body/phone tracking are outside this offline validation pass.
