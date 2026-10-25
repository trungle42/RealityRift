# Storybound

**Don't just read the fairy tale. Become part of it.**

Storybound is a third-person 3D fairy-tale adventure that runs in the browser, built for HackTX 2026 (theme: Fairy Tale). You explore a small kingdom, fight a witch or a shadow dragon, and a Gemini-powered storyteller writes each scene from what you actually did. Real life leaks into the game three ways: you hold a real object up to your webcam and Gemini turns it into a **relic** that powers up your weapons (**Reality Rift**); you draw shapes in the air with a coloured wand and each shape casts a spell; and you swing a real phone like a sword.

The pitch: the story reacts to the players, and the players' real world reacts back. Your phone is the joystick and the sword, a stick with a coloured ball is the wand, your water bottle becomes a relic that makes both burn, and the game ends with a storybook of your exact playthrough.

> Status key used in this file: **working** means it is on `main` and was checked against the code. **In progress** means another branch is building it and it is *not* on `main` yet. Lines marked `TODO(after merge)` are the ones to flip when that branch lands.

## How the pieces fit

```
  Phone browser                    Browser: the game                    cv_2 (Python)
  /joystick page                   Three.js + Rapier, port 5173         webcam colour tracker
  (thumb stick)                    Scanner = webcam photos              python -m tools.publish
       |                              |                 ^                 |
       | WebSocket                    | HTTP            | WebSocket       | WebSocket
       v                              v                 | (stick, body)   | (slash, jump,
  +--------------------------------------------------------+              |  motion, wand)
  | FastAPI backend, port 8000                             |              |
  |   /ws/joystick/{room}   phone relay, forwards to game  |              |
  |   /ws/cv/{room}         tracker relay, to the game <---+--------------+
  |   /api/provider/*       story beats and storybook  ----+---> Gemini (text)
  |   /api/artifact         photo -> weapon            ----+---> Gemini (vision)
  |   /api/verify           photo shows "a book"?      ----+---> Gemini (vision)
  +--------------------------------------------------------+
```

What talks to what:

- **Game -> backend, plain HTTP.** Story beats go to `/api/provider/*`. A scan photo goes to `/api/artifact`. A riddle-door photo goes to `/api/verify`. The backend calls Gemini; the browser never sees the API key.
- **Backend -> Gemini.** One call per story beat, one per photo. Never per frame.
- **If Gemini fails, the game keeps going.** The backend returns 503 for story calls and the browser uses the hand-written `ScriptedStory` for that beat. A scan returns a stand-in relic; the riddle door lets you through.
- **Phone -> backend -> game.** The phone opens `/joystick` and streams a stick position over a WebSocket. The backend forwards only validated `move` messages to the game in the same room.
- **cv_2 -> backend -> game.** `python -m tools.publish` reads the webcam and streams one small message per frame over a WebSocket to `/ws/cv/{room}`. The backend forwards only validated messages to the game in the same room, where `CvInput.ts` turns a phone slash into a sword strike, a jump into a hero jump, body motion into moving in the freeze trial (`?story=full`), and each shape a wand completes into a shape event (Reality Rift's spells, and the pose seals' runes). The game drives the wand in the other direction over the same socket: it is on for any shape while the game is open, and a pose seal asks for its own shape. Tested end to end with synthetic tracker frames, not yet with a live webcam.

The rule behind the design: the engine owns the rules (combat, hearts, timing), Gemini owns the words. The backend fixes the structure of each beat from a catalog the engine can run, and Gemini only writes narration, prompts, names and the final storybook. It cannot invent a mechanic the game cannot run.

## Features

### Two ways to play: the demo run and the full story (working)

- **The demo run (the default).** Open `http://localhost:5173/`. After the name screen you stand in the Whispering Wood a few strides from Willow, facing her. Walk up and press **E**: she briefs you (four lines you advance with Space, Enter or E, then a quest card, "The Last Warm Spring", to accept with Enter). One wave of six shadows then comes out of the treeline: three close ones, and three farther back that arrive a few seconds later. When the horde is broken, Willow tops your hearts back up and Morwen the Frost Witch strides in. A result screen shows the time, foes defeated, hearts left and starlight, with a **Play again** (or **Try again**) button that reloads the game. The code is tuned for roughly a minute of fighting after the briefing (about 15-20 s for the wave, about 25 s for the boss); I have not timed a run myself.
  - It has **no** Gemini storyteller, freeze challenge, crossroads vote, pose seals, riddle door or storybook: Willow's lines are fixed text, read aloud by the browser's speech voice unless you mute with the sound button. The boss is always Morwen, so **fire** is the element that doubles your damage.
  - Everything else works as normal: the scan and relics, the wand, the sword, the phone joystick and the camera tracker. Gemini is only called for a scan.
- **The full story: `?story=full`.** Open `http://localhost:5173/?story=full`. This is the whole storyteller-driven tale: camps in the world, the freeze challenge, the crossroads vote (castle or cave), the pose seals, the riddle door, the lantern fairy, a boss on either route, and the personalised storybook. Each beat comes from Gemini, with the scripted story as the fallback.

`?story=` takes one value, so `?story=full` cannot also say `scripted`. To play the full story with no Gemini, either set `OFFLINE=1` for the backend or start the game with `VITE_STORY=scripted npm run dev`.

### Gemini storyteller and personalised storybook (working; `?story=full`)

Each story beat is written by Gemini (`gemini-3.8-flash`, structured output, thinking off for speed, 12 s timeout) using what happened so far: who passed or failed which challenge, which road you took, what you found. Failures make later challenges and the boss harder. The game ends with a storybook that names your choices and mistakes. Every one of these calls has a hand-written fallback, so a dead network or a missing key never stops a run.

### Two weapons per hero: a sword and a wand (working)

Every hero carries two weapons, and a HUD row at the bottom of the screen shows both (`Sword · steel`, `Wand · arcane · △ meteor`) plus the relic they hold.

- **Sword (right hand):** **J** or left click for a three-hit combo. With the camera tracker running, a **phone slash** strikes too.
- **Wand (left hand):** **draw a shape and it casts that shape's spell**, even before any scan. **F** still casts a plain bolt.

| Shape | Spell | Cooldown (per hero and shape) |
|---|---|---|
| circle | nova: a burst all around you | 2.2 s |
| triangle | meteor: a strike from the sky on the nearest or locked-on foe | 3 s |
| square | wave: three bolts in a fan | 1.6 s |
| star | chain: lightning that leaps between foes | 1.8 s |

Shapes come from the camera tracker (hold the wand still, then draw; see the [cv_2](#cv_2-webcam-colour-tracker-working-wands-slash-jump-and-motion-connected-to-the-game) section) or from the keyboard stand-in: **4 5 6 7** draw circle, triangle, square, star for hero one (the yellow wand), and **8 9 0 -** do the same for hero two (the blue wand, `?players=2` only). A shape drawn while a freeze or pose challenge is running does not cast (during a pose seal, the tracker's shape opens the seal instead). With no relic, spells are a violet "arcane" colour at power 1.

The sword and wand models in the hero's hands come with the private art pack. Without it the weapons still work and the HUD still shows them, but nothing is drawn in the hand.

### Reality Rift: scan an object, get a relic (working)

Press **X** or click the **Scan** button. Hold a real object up to the webcam and press Enter (or "Scan the object"). The photo is shrunk to at most 512 px and sent to `/api/artifact`. Gemini returns a name, a type, an element, an ability, a damage rating (1-100) and a rarity, and the game shows a **relic card** framed around your own photo of the object.

**A relic is a power-up for both weapons.** Its element colours and infuses the hero's wand spells, the F bolt and the sword, and its power (1-3, from the damage rating, one higher for a legendary) sets how hard the wand spells hit. The shape of the spell still comes from the shape you draw; Gemini's ability name is flavour and goes into the story.

**Elements matter against bosses.** A boss takes **x2** damage from the element it fears and **x0.5** from the one it resists, for wand spells and for sword slashes. The boss bar shows `weak to <element>` during the fight, and a hit shows "Weak point!" or "Resisted".

| Boss | Route | Weak to (x2) | Resists (x0.5) |
|---|---|---|---|
| Morwen the Frost Witch | castle | fire | ice |
| Umbraxis the Shadow Wyrm | cave | light | shadow |

So the object you pick is a real choice: a hot drink tends to come back as fire, which is what the witch fears. Scanning needs the backend. No camera, or the camera is busy? The scanner lets you choose a photo from disk instead. No key or Gemini down? You get a stand-in relic (the Moonlit Orb of light or the Frostbound Blade of ice, picked at random) and a note saying so.

- **Armory:** every relic you scan is kept in an armory in this browser (up to 8; the small photo is stored in the browser only). Pick one in the scanner to equip it again without a new scan.
- **Two players:** the relic card asks which hero takes it. In solo play it goes to your hero.
- **The story remembers your objects (`?story=full`):** relics travel in the story history. Gemini is told which real object became which relic and may work it into a scene, and the storybook is asked to give the relics their own page. The offline script adds a "The Reality Rift" page the same way.

### The "show me X" riddle door (working; `?story=full` only)

After you pass the Chapter III pose gate, a second door with carved eyes wakes up and asks you to show it a real object: **a book** on the castle route, **a bottle or a cup** on the cave route. The scanner opens in door mode. Your webcam photo goes to `/api/verify`, and Gemini vision says whether that kind of object is clearly visible (a picture or screen of it does not count) and what it actually saw. A wrong object shows what the door saw and lets you try again. **Skip** lets you through anyway at no cost in hearts. With no Gemini key the door accepts any photo, so it can never trap a player.

### Phone joystick (working)

Press **H** in the game. A toast shows a URL like `http://192.168.x.x:8000/joystick`. Open it on a phone, then drag your thumb anywhere on the screen to move; push past the ring to sprint. The stick moves the first hero whenever no movement key is held, and the game toasts when the phone connects.

- The backend must be started with `--host 0.0.0.0` (see [Run everything](#run-everything-from-a-fresh-clone)). Without it, the backend only answers on the laptop itself and the phone cannot reach it.
- The phone and the laptop must be on the same network. Many venue Wi-Fi networks block device-to-device traffic, so the safe plan is: turn on the phone's hotspot and join the laptop to it.
- Two rooms on one network? Add `?room=NAME` to both the game URL and the phone URL. The default room is `storybound`.
- Only `{type: "move", x, y, sprint}` is forwarded, with numbers clamped to the unit circle. The room code is the only access control, which is fine for a demo.

### cv_2: webcam colour tracker (working; wands, slash, jump and motion connected to the game)

haicil's tracker is a Python + OpenCV program in `cv_2/`. No neural model: it finds objects by colour (HSV thresholds), so it needs no download and runs at camera speed.

- **Coloured wands.** Hold up a yellow, a blue and a red ball on sticks. Each colour's path is drawn in its own colour. In the game, hold the wand still for a moment, then draw a circle, triangle, square or star: the shape counts the moment the loop closes back on the point where you rested, and the wand is ready again under a second later. The game's wand panel (bottom left) shows your trail, what to draw and the shape you made. In the game the **yellow** wand casts for hero one and the **blue** wand for hero two (`?players=2` only); red is not used, because the tracker mistakes lips and skin for it. Without a game, the tracker runs its own demo: detection switches on and off every 5 seconds, each ON phase asks for the next shape, and the traces clear when it turns off.
- **Phone slash.** Bright lime tape on the front of a phone held in the left hand is tracked every frame. A big, fast downward swing shows **SLASHED!** for 2 seconds (in the game it strikes hero one's sword). Keep the whole swing inside the picture. The same phone can show the joystick page at the same time.
- **Jump.** Stand 1.5-2 m back and jump; optical flow spots an up-then-down burst and shows **JUMPED!**.

It was tuned on one webcam. Expect to re-run `python -m tools.tune` (click your objects, paste the printed values) in new lighting. Details, measurements and gotchas: [cv_2/README.md](cv_2/README.md) and [cv_2/CLAUDE.md](cv_2/CLAUDE.md).

Working (CV to game; tested end to end with synthetic tracker frames, not yet with a live webcam):

- A backend relay (`backend/app/cv.py`) plus `CvInput.ts` that feed the tracker into the game: **phone slash -> sword strike**, **jump -> hero jump**, **body motion -> the freeze trial** (`?story=full` only). Start it with `python -m tools.publish` in `cv_2/` while the backend runs.
- **Wand shapes -> spells**: the game takes the wand, so any shape the player draws casts its spell (see "Draw a shape, cast its spell" above), and the wand panel (bottom left) shows the trail, what to draw and the shape made. **Pose seals** (`?story=full` only) also open to their rune: triangle for arms up, square for the T-pose, circle for the crouch (keys 1, 2, 3 still work).
- Not started: aiming spells by pointing the wand.

### Also on `main`

- **Willow, the waykeeper,** a willow dryad who stands in the Whispering Wood (press **E** near her: in the demo run she gives the briefing). Her translucent echo waits in the castle and the cave with advice about that region's boss (its attacks and when to strike).
- **Combat:** a three-hit sword combo, spells, roll, flash step, lock-on, and boss wards that reject damage during the warning and open afterwards.
- **Classic edition:** Rishaan's earlier 2.5D campaign (PixiJS) is still available at `http://localhost:5173/?mode=classic`.
- **Solo or two players.** The default is one hero plus an AI companion. Add `?players=2` for a second human on the same keyboard.

## Folder map

| Path | What is in it | Owner |
|---|---|---|
| `frontend/src/adventure/` | The 3D game. `Adventure.ts` is the main loop, input, combat and story flow; `Scanner.ts` is the Reality Rift camera screen and relic card; `weapon.ts` turns an artifact into a relic's spell power and holds the boss elements; `forge.ts` has the wand shapes, their spells, cooldowns and the 4-7 / 8-0- keyboard stand-in; `armory.ts` is the in-browser relic shelf; `WandModel.ts` and `WeaponsHud.ts` draw the wand and the weapons row; `quest.ts` checks `/api/verify` replies; `PhoneInput.ts` and `phoneMath.ts` are the phone joystick client; `CvInput.ts`, `cvMath.ts` and `WandHud.ts` are the camera-tracker client and the wand panel; `World.ts`, `Willow.ts`, `Actor.ts`, `Fx.ts`, `Physics.ts` build and animate the world | Rishaan, and everyone (see team rules) |
| `frontend/src/story/` | `ScriptedStory` (offline story) and `GeminiStory` (calls the backend, falls back per beat) | Rishaan and Trung |
| `frontend/src/` (rest) | `contracts.ts` (types shared with the backend), `campaign/`, `game/`, `challenges/` and friends: the classic 2.5D edition and shared story data | Rishaan |
| `frontend/tests/` | Unit tests (`*.test.mjs`) and the browser checks (`adventure.html`) | whoever changes the code |
| `frontend/scripts/` | `build-3d-kit.py`: Blender source for our own GLB models | Rishaan |
| `backend/app/` | FastAPI: `main.py` (routes), `provider.py` (story structure), `gemini.py` (Gemini calls), `fallbacks.py`, `joystick.py` (phone relay), `cv.py` (camera-tracker relay), `schemas.py`, `store.py` | Trung |
| `backend/static/joystick.html` | The page the phone opens | Trung |
| `backend/tests/`, `backend/tools/` | pytest suite; `live_smoke.py` and `test_photos.py` for real Gemini runs | Trung |
| `cv_2/` | The webcam tracker (`tools.demo` window, `tools.publish` to feed the game), its own venv and tests | haicil |
| `scripts/` | `install-art-pack.sh` / `.ps1`: install the private art pack | Trung |
| `docs/` | `api-contract.md`, `3d-adventure.md`, `art-direction.md`, this project's Devpost draft and demo script | everyone |

The team: **Rishaan Malik** (game and art, on Windows), **Trung Le** (backend, Gemini, integration, Reality Rift), **haicil / Allen Ai** (computer vision, on Windows ARM64).

## Run everything from a fresh clone

You need Node 20.19+, Python 3.9+, and a Gemini API key. Without a key the game still plays on its scripted story; scans and the riddle door fall back as described above.

```bash
git clone https://github.com/trungle42/Storybound.git
cd Storybound
```

### 1. Backend (terminal 1)

macOS / Linux:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # then put your key after GEMINI_API_KEY=  (never commit .env)
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Windows (PowerShell):

```powershell
cd backend
py -3 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env          # then put your key after GEMINI_API_KEY=
.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is what lets a phone reach the backend. Windows may ask to allow Python through the firewall; allow it on the private network. Check it with `curl http://localhost:8000/api/health`: `"gemini": true` means the key loaded. `OFFLINE=1` in `.env` forces the canned fallbacks (useful as demo insurance).

### 2. Frontend (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** for the demo run, or **http://localhost:5173/?story=full** for the whole tale. Use `localhost`, not the laptop's network address: browsers only allow the webcam on `localhost` or HTTPS.

Handy switches:

| Switch | Effect |
|---|---|
| *(none)* | The short **demo run**: Willow's briefing, one shadow wave, then Morwen |
| `?story=full` | The whole storyteller-driven tale: camps, freeze, vote, pose seals, riddle door, Gemini beats, storybook |
| `?story=scripted` | Use the scripted story instead of Gemini. It only matters for the full tale, and it replaces `full`, so for an offline full run use `OFFLINE=1` on the backend or `VITE_STORY=scripted` |
| `?players=2` | Second human player on the arrow keys |
| `?room=NAME` | Phone joystick room (match it on the phone URL) |
| `?mode=classic` | The old 2.5D campaign |
| `VITE_API_URL=...` (env) | Point the game at a different backend (default `http://localhost:8000`) |

### 3. Art pack (optional, private)

Our own models are in the repo. A set of extra models is kept out of it and shared as a private zip. Ask Trung or Rishaan for `storybound-art-pack.zip`, then from the repo root:

```bash
./scripts/install-art-pack.sh ~/Downloads/storybound-art-pack.zip          # macOS / Linux
```

```powershell
.\scripts\install-art-pack.ps1 C:\Users\you\Downloads\storybound-art-pack.zip   # Windows
```

The scripts unpack only into `frontend/public/models/assetyard/` and `frontend/public/models/polyhaven/`, and git ignores the files they install. Without the pack the game still runs and uses plain stand-in characters and materials. Never commit the pack.

### 4. Phone joystick

Start the backend as above, open the game, press **H**, open the URL it shows on your phone. If the address it shows is wrong (a VPN can confuse it), use your laptop's real address: `http://<laptop-ip>:8000/joystick`.

### 5. cv_2 tracker

It has its own virtual environment and runs as a separate window. Allow camera access for your terminal the first time (macOS asks).

macOS, or Windows on x64:

```bash
cd cv_2
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt     # on Windows: .venv\Scripts\python.exe
.venv/bin/python -m tools.demo                                   # q quits, m shows the colour masks
```

Windows on ARM64 must use the x86_64 Python, because OpenCV has no ARM64 Windows build:

```powershell
cd cv_2
uv venv --python cpython-3.12-windows-x86_64-none .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.venv\Scripts\python.exe -m tools.demo
```

Calibrate for your lighting with `python -m tools.tune`. Full tuning guide in [cv_2/README.md](cv_2/README.md).

To send the tracker to the game, keep the backend (step 1) running and the game open, then run one of these instead of the demo (on Windows use `.venv\Scripts\python.exe`):

```bash
uv pip install --python .venv/bin/python -r requirements.txt               # once, if your venv predates the link: adds websockets
.venv/bin/python -m tools.publish                                          # backend on :8000, game in room "storybound"; Ctrl-C stops
.venv/bin/python -m tools.publish --api http://localhost:8020 --room demo  # another backend or room; open the game with ?room=demo
```

**Everything shows inside the game.** The tracker has no window of its own (`--window` opens its OpenCV view for debugging) and it is the only program that opens the webcam: it sends the game a small camera picture about 15 times a second, which the wand panel shows with your wand trails and the phone marker on top (plus a setup hint for a solo player: "Yellow wand not seen", "Phone tape not seen" or "Step back a little"), and the scanner (**X**) shows the same picture and scans from a full-size snapshot the tracker sends on request, instead of opening the camera itself. With no tracker running, the scanner opens the camera as before. The terminal prints when the backend connects, when the game joins (it takes the wand: "wand on, any shape"), what the game asks for, and each slash or jump. A slash can count again after 0.5 s (`--slash-hold`). To draw, hold the wand still for a moment, then draw the shape back to where you started. Tested end to end with synthetic tracker frames, not yet with a live webcam.

## Demo in one command

Once the setup above is done (`backend/.venv`, `frontend/node_modules`, `cv_2/.venv`), one command from the repo root starts all three pieces:

```bash
./scripts/demo.sh            # macOS / Linux
```

```powershell
.\scripts\demo.ps1           # Windows
```

It starts the backend (open to the local network, for the phone), the game and the tracker (no window of its own: its camera picture shows in the game), opens the game in your default browser, and prints the game URL and the phone joystick URL. Anything already running on port 8000 or 5173, or a tracker that is already open, is left alone, and **Ctrl-C stops only what the script started**. A missing `.venv` or `node_modules` stops it before anything starts, with the command that fixes it. Backend and game logs go to a temporary folder it prints; the tracker prints its slashes and jumps in the same terminal. It never reads `backend/.env`. Options: `--no-tracker` (`-NoTracker` on Windows) to run without the webcam, `--no-browser` (`-NoBrowser`) to not open the browser, and other ports with `API_PORT=8020 WEB_PORT=5220 ./scripts/demo.sh` (`-ApiPort 8020 -WebPort 5220`). The macOS script was tested (starting, leaving running servers alone, a missing setup, a tracker that cannot open the camera, Ctrl-C); the Windows script has not been run yet.

## Controls

Checked against `bindInput()` and the movement code in `frontend/src/adventure/Adventure.ts`.

| Key | Action |
|---|---|
| **W A S D** | Move (relative to the camera) |
| **Shift** (left) | Sprint (uses stamina) |
| **Space** | Jump (a real jump does it too, with the camera tracker) |
| **J** or left click | Sword (three-hit combo). A camera-tracked phone slash does the same |
| **F** | Cast a plain bolt (the colour of your relic's element, once you have one) |
| **4 5 6 7** | Wand shapes for hero one: circle (nova), triangle (meteor), square (wave), star (chain). Stand-in for drawing with the camera wand |
| **8 9 0 -** | The same four shapes for hero two (`?players=2` only) |
| **Q** | Roll: 1 s of invulnerability from the start, 4 s cooldown |
| **R** | Flash step: short dash, uses stamina, 6 s cooldown. Dodging at the last moment of an enemy attack slows time for a free flurry |
| **X** | Scan an object for a relic (Reality Rift). Also the **Scan** button |
| **E** | Interact: talk, open chests and springs, start the next story beat at the golden beacon. In the demo run, E near Willow starts her briefing |
| **H** | Show the phone joystick URL |
| **M** | Map and journal (**Esc** also opens it when the mouse is free) |
| **Z** or **Tab**, right click | Lock on to the nearest foe, or release |
| **C / V**, drag, scroll | Rotate and zoom the camera |
| **1 / 2 / 3** (hold) | Rune poses: arms up, T-pose, crouch (freeze and pose challenges; crouch also dodges the shadow wave) |
| Click the world | Capture the mouse for mouse-look. **Esc** releases it |

Second player (`?players=2` only): **arrow keys** move, **/** casts, **Right Shift** rolls, **I / O / P** are the poses. In the default solo mode the arrows also move your hero, and **/** and **Right Shift** cast and roll for you; the AI companion follows and helps. Phone stick and keyboard both work; the keyboard wins when a key is held.

## Testing

| What | Command | Result on `main` |
|---|---|---|
| Backend | `cd backend && OFFLINE=1 .venv/bin/python -m pytest` | 46 pass |
| Frontend unit tests | `cd frontend && npm test` | 83 pass |
| Type-check and build | `cd frontend && npm run build` | passes |
| In-browser gameplay checks | `npm run dev`, open `http://localhost:5173/tests/adventure.html?story=scripted`, click **Run 3D gameplay checks** | 16 checks, listed as PASS / FAIL. They play the full story, not the demo run |
| cv_2 | `cd cv_2 && .venv/bin/python -m pytest` | 247 pass (about 15-90 s on a Mac; no camera needed) |
| Real Gemini | `cd backend && PYTHONPATH=. .venv/bin/python tools/live_smoke.py` | needs a key; plays full runs |
| Photos through `/api/artifact` | `cd backend && .venv/bin/python tools/test_photos.py <folder>` | needs a key |

The browser checks drive the real renderer with real key events, so they need a browser with WebGL and the dev server running. Live Gemini, the phone and the camera are not covered by the automated checks; test those by hand (see [docs/demo-script.md](docs/demo-script.md)).

## Team rules

- **Work on a branch and open a PR against `main`.** Never push to `main` directly.
- **Never commit `backend/.env`** (it holds the Gemini key) **or `frontend/public/models/assetyard/`** (the private art pack). Both are git-ignored; do not force-add them.
- **Keep `Adventure.ts` edits small.** Everyone touches it, and a big diff there is the fastest way to a merge conflict. Put new logic in its own file and call it from `Adventure.ts` in a few lines (`Scanner.ts`, `weapon.ts` and `PhoneInput.ts` are the pattern).
- Touching someone else's folder (`backend/app`, `cv_2/`)? Tell the owner first.

## Status

**Working (on `main`)**

- 3D adventure: exploration, combat, two bosses, solo or two players, Willow, the forest and the other regions.
- A short **demo run** as the default (Willow's briefing, one wave, Morwen, a result screen), with the full tale at `?story=full`.
- Gemini storyteller with a scripted fallback for every beat, and the personalised storybook (`?story=full`).
- Reality Rift: scan an object into a relic (relic card with your photo, in-browser armory), boss element weaknesses, and a story and storybook that mention the real object.
- The riddle door that checks a webcam photo with Gemini vision (`?story=full`).
- Phone joystick through the backend relay.
- cv_2 tracker as a standalone program: coloured wands, shape naming, phone slash, jump.
- cv_2 connected to the game through the backend relay: phone slash to strike, jump to jump, body motion to the freeze trial, wand shapes to the game (any shape, the wand panel, and pose seals opened by their rune) (tested with synthetic tracker frames; not yet with a live webcam).
- Two weapons per hero (sword and wand), drawn shapes casting spells, and relics infusing both weapons with their element. Keys 4-7 and 8-0- stand in for the camera wand.
- Classic 2.5D campaign at `?mode=classic`.

**In progress (not on `main` yet)**

- Rebuilding our 3D models in Blender (a pilot on the waystone shrine) so the team owns every model and the private art pack is optional. `TODO(after merge)`

**Not done**

- Aiming spells by pointing the wand.
- No hosted version: the game runs locally (frontend and backend on one laptop).
- cv_2 shape and slash detection has not been validated across different lighting, cameras or people. Slash recall depends on keeping the whole swing in view.
- The 3D game does not use the telemetry and leaderboard endpoints (`/api/event`, `/api/score`, `/api/leaderboard`, `/api/stats`); they exist in the backend only.
- Some supporting props and the boss models use simpler geometry than the forest.
- Without the private art pack, the hero's sword and wand are not drawn in the hand (the weapons still work), and characters are plain stand-ins.
- The camera tracker and the scanner both want the webcam. If the scanner cannot open the camera while `tools.publish` runs, scan first or use "Choose a photo".

## More docs

- [docs/3d-adventure.md](docs/3d-adventure.md): the 3D edition, asset pipeline, verification
- [docs/api-contract.md](docs/api-contract.md): backend request and response shapes
- [docs/devpost.md](docs/devpost.md): Devpost submission draft
- [docs/demo-script.md](docs/demo-script.md): 2-minute video shot list, live-judging script, pre-demo checklist
- [docs/art-direction.md](docs/art-direction.md), [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md)
