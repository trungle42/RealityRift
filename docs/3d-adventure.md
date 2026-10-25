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

WASD moves the ranger relative to the camera. Click the world to capture the mouse for mouse-look (left click strikes, Esc frees the mouse); without the mouse captured, drag the world to orbit the camera. The wheel zooms, and C/V also rotate it. Shift sprints, Space jumps, E interacts, J (or a left click) strikes with the sword, F casts a plain bolt, and M opens the map and journal (Esc does too when the mouse is free).

- **Q rolls:** about 4.5 m, 1 s of invulnerability from the start, 4 s cooldown.
- **R flash-steps:** a short dash that costs stamina, with a 6 s cooldown. Dodging at the last moment of an enemy attack slows time for a flurry rush.
- **Z or Tab** (or right click) locks on to the nearest foe and releases it again.
- **4 5 6 7 draw wand shapes** for hero one: circle casts a nova, triangle a meteor, square a wave, star a chain. This is the keyboard stand-in for drawing the shape in the air with a coloured wand in front of the camera tracker. **8 9 0 -** do the same for hero two (`?players=2` only). Each shape has its own cooldown (1.6-3 s), and a shape drawn during a freeze or pose challenge does not cast.
- **X scans an object** (Reality Rift, also the Scan button): hold a real object to the webcam and the backend turns it into a relic that infuses both weapons with its element. See the main [README](../README.md).
- **H** shows the URL for the phone joystick; the backend must run with `--host 0.0.0.0` for a phone to reach it.

Each hero has two weapons: the sword (J, click, or a camera-tracked phone slash) and a wand (a drawn shape, or F for a plain bolt). A row at the bottom of the screen shows both and the relic they hold. A relic's element decides the colour of the spells and the sword and the boss multipliers (x2 against the element a boss fears, x0.5 against the one it resists), for slashes as well as spells. The sword and wand models in the hero's hands come with the private art pack.

With the cv_2 tracker running (`python -m tools.publish`), the camera also drives the game: a phone slash strikes, a real jump leaps, moving in front of the camera breaks the freeze spell, and a pose seal opens when you draw its rune with a wand (triangle for arms up, square for the T-pose, circle for the crouch). A small wand panel at the bottom left shows the tracker's view while it is connected. Setup is in the main README.

The default is solo play: one hero, and the companion follows and casts automatically. Add `?players=2` for a second human: arrow keys move that player, `/` casts and Right Shift rolls. In solo play the arrow keys also move your hero, and `/` and Right Shift cast and roll for you.

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
- `/tests/adventure.html?story=scripted`: 15 rendered checks covering 3D input, rewards, dialogue, story transitions, choices, pose seals, the scanner and the riddle door, the two weapons (shape spells, cooldowns, relic infusion), spells, boss ward, solo defense, and ending checks.
- `/tests/campaign.html` and `/tests/playthrough.html`: Rishaan's original rendered regression harnesses.

The development harnesses are excluded from the production bundle. Live Gemini and a live webcam are outside this offline validation pass; the camera link is tested with synthetic tracker frames, not yet with a live webcam.
