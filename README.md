# Storybound

**Don't just read the fairy tale. Become part of it.**

Storybound is a third-person 3D fairy-tale adventure in the browser, built for HackTX 2026 (theme: Fairy Tale). A Gemini-powered storyteller writes the tale from what you do, and your real world plays along: your phone is the controller, a stick with a coloured ball is the wand, and a mug held up to the webcam becomes a weapon.

## How you play

- **Phone = joystick and sword.** Scan the QR code on the start screen. Drag to move, tap to act, swing the lime-taped phone to strike.
- **Wand = draw the shape the game asks for.** Draw it in the air in front of the webcam: ▲ meteor, ● nova, ■ wave, ★ chain lightning.
- **Reality Rift = scan a real object.** Gemini turns it into a relic that powers both your weapons; bosses take double damage from the element they fear.
- **Up to 3 players on 3 laptops,** each with their own phone and wand colour, seeing each other's heroes.

```
  Phones                       Browser: the game                cv_2 tracker (Python)
  /joystick page               Three.js + Rapier, :5173         webcam colour tracker
       |                          |            ^                    |
       | WebSocket                | HTTP       | WebSocket          | WebSocket
       v                          v            |                    |
  +-------------------------------------------------------------------------+
  | FastAPI backend, :8000                                                  |
  |   /ws/joystick/{room}   phones -> game                                  |
  |   /ws/cv/{room}         tracker <-> game (camera picture, wand, slash)  |
  |   /ws/presence/{room}   the other laptops' heroes                       |
  |   /api/provider/*   story beats, storybook   ----> Gemini (text)        |
  |   /api/artifact     photo -> relic           ----> Gemini (vision)      |
  |   /api/verify       photo shows "a book"?    ----> Gemini (vision)      |
  +-------------------------------------------------------------------------+
```

## Quick start

After the one-time [setup](#setup-from-a-fresh-clone), one command starts the backend, the game and the tracker, opens the game, and shows a QR code for your phone:

```bash
./scripts/demo.sh --tunnel --color red --name You          # macOS / Linux
```

```powershell
.\scripts\demo.ps1 -Tunnel -Color red -Name You            # Windows
```

`--tunnel` lets phones on any network connect through a Cloudflare tunnel (install `cloudflared` once: `brew install cloudflared`, or `winget install --id Cloudflare.cloudflared`); drop it if the phone is on the same Wi-Fi. If Windows blocks the script, run it as `powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1 -Tunnel -Color red -Name You`. Scan the QR code, tap the phone to begin, hold the wand still, then draw.

Jump to: [Features](#features) · [Controls](#controls) · [Switches and launcher options](#switches-and-launcher-options) · [Setup](#setup-from-a-fresh-clone) · [Join from your laptop](#join-from-your-laptop-3-players-3-laptops) · [Testing](#testing) · [Architecture and folders](#architecture-and-folders) · [Team rules](#team-rules) · [Status](#status)

## Features

**Two ways to play.** The default is a short **demo run**: Willow's briefing, one wave of six shadows, then Morwen the Frost Witch, then a result screen (tuned for roughly a minute of fighting per the code comments; not timed). `?story=full` plays the whole tale: the freeze challenge, a crossroads vote (castle or cave), pose seals, the riddle door, a boss on either route, and a personalised storybook. The demo run has no storyteller, vote, seals, riddle door or storybook, and Gemini is only called for a scan.

**Gemini storyteller (`?story=full`).** Each beat is written by Gemini (`gemini-3.8-flash`, structured output, 12 s timeout) from what you did; the engine owns the rules and Gemini only writes the words. Every call has a hand-written fallback, so a dead network or a missing key never stops a run.

**Reality Rift.** Press **X**, click **Scan**, or tap **Scan** on the phone. A small panel docks at the right and the game keeps running underneath. Hold a real object up and take the photo; Gemini returns a relic (name, element, ability, power, rarity), shown on a card framed around your own photo with the boss matchup, such as "Morwen is weak to fire · x2 damage". The relic's element infuses the wand, the F bolt and the sword, and its power (1-3) sets how hard wand spells hit. A boss takes **x2** from the element it fears and **x0.5** from the one it resists, for spells and slashes; a hit shows "Weak point!" or "Resisted". Relics are kept in an in-browser armory (up to 8). In the full story Gemini and the storybook mention the real object. With no camera, "Choose a photo"; with no Gemini, a stand-in relic (Moonlit Orb of light or Frostbound Blade of ice, at random).

| Boss | Route | Weak to (x2) | Resists (x0.5) |
|---|---|---|---|
| Morwen the Frost Witch | castle (always, in the demo run) | fire | ice |
| Umbraxis the Shadow Wyrm | cave | light | shadow |

**Two weapons: sword and wand.** The sword is a three-hit combo. The wand casts the shape you draw, even before any scan: circle nova (2.2 s cooldown), triangle meteor (3 s), square wave (1.6 s), star chain lightning (1.8 s). In a fight the screen asks for one shape at a time ("▲ Draw a triangle · Meteor") and only that shape casts; another shape does nothing. The request moves on after a cast or 10 s. The wand needs 2 s between spells, and the tracker stops tracing whenever a spell could not be cast. A requested star is read leniently (96% of simulated stars accepted instead of 89%). `?runes=free` removes the requests.

**Phone control.** The start screen shows a QR code; the phone page needs no app. Drag moves, a tap does whatever Enter or E would, **Scan**, **Roll** and **Slash** are buttons. The backend gives each phone a player slot (up to three). Through `--tunnel` only the phone page and the phone and presence sockets answer; everything else (the API with the Gemini key, the camera relay) is refused, and each launch gets a random room code. Without the tunnel, the phone must reach the laptop on the same network (the backend listens on `0.0.0.0`; the page is `http://<laptop-ip>:8000/joystick`, and **H** shows it).

**Up to three players.** Hero one is the first phone and wand. Hero two is the AI companion until a second phone joins (or `?players=2`, keyboard). The third player flies **Pip the lantern fairy**: drag flies, tap throws pixie dust, Slash dashes, and the third wand casts from where Pip hovers; Pip cannot be hurt. Each player has a wand colour (`?wand=` or `--color`).

**Camera tracker (`cv_2/`, haicil).** A Python + OpenCV program finds the wand ball and the lime tape by colour (no model to download). It names the shape you draw, spots the phone slash and a real jump (the hero jumps and dodges: 1 s of invulnerability, at most once every 2.5 s), and in the full story reads body motion for the freeze challenge and opens pose seals to a drawn rune (triangle, square, circle). It is the only program that opens the webcam: it sends the game a camera picture about 15 times a second (the wand panel and the scanner use it). Tune it to your room with `./scripts/demo.sh --tune`. It was tuned on one webcam, and the link to the game is tested with synthetic frames, not yet with a live webcam.

**The riddle door (`?story=full`).** After the Chapter III pose gate, a door asks you to show a real object (a book, or a bottle or cup). Gemini vision checks the photo and says what it saw; Skip lets you through, and with no key the door accepts any photo.

**Also:** Willow the waykeeper (her briefing opens the demo run), roll, flash step, lock-on, boss wards, and Rishaan's earlier 2.5D campaign at `?mode=classic`.

## Controls

Phone first; the keyboard does everything too.

| Action | Phone | Camera and wand | Keyboard |
|---|---|---|---|
| Move | drag (past the ring to sprint) | | **WASD**, **Shift** |
| Act: start, talk, read on, accept, take the photo and the relic | tap | | **E** / **Enter** |
| Sword | **Slash** button | swing the lime-taped phone | **J** or click |
| Cast | | draw the asked-for shape | **4 5 6 7** circle, triangle, square, star (hero two: **8 9 0 -**); **F** plain bolt |
| Roll | **Roll** button | | **Q** (4 s cooldown, 1 s invulnerable) |
| Jump | | jump | **Space** |
| Scan a relic | **Scan** button | | **X** |

Keyboard only: **R** flash step, **Z** / **Tab** / right click lock on, **M** map and journal, **H** phone URL, **C** / **V** and drag rotate the camera, hold **1 / 2 / 3** for the pose seals. Second keyboard player (`?players=2`): arrows, **/** cast, **Right Shift** roll, **I / O / P** poses.

## Switches and launcher options

| URL switch | Effect |
|---|---|
| *(none)* | The demo run |
| `?story=full` | The whole tale. (`?story=scripted` uses the scripted story, but it replaces `full`; for an offline full run use `OFFLINE=1` on the backend or `VITE_STORY=scripted`) |
| `?players=2` | Hero two on the keyboard |
| `?wand=red,blue,yellow` | Wand colour per player: hero one, hero two, Pip (default `yellow,blue`) |
| `?fairy=1` | Bring Pip in from the start |
| `?runes=free` | Any shape casts in a fight |
| `?room=NAME` | Phone and camera room (default `storybound`) |
| `?mode=classic` | The 2.5D campaign |

| Launcher option (macOS / Windows) | Effect |
|---|---|
| `--tunnel` / `-Tunnel` | Phones on any network; prints a link and a random room code |
| `--color red,blue,yellow` / `-Color` | Wand colour per player, in order (default `yellow`); jump is off with more than one |
| `--name <you>` / `-Name` | Your name tag for the other laptops |
| `--join <link> --room <code>` / `-Join`, `-Room` | Join a host (see below) |
| `--tune` / `-Tune` | Tune the tracker's colours to your camera and room first (no keys; needs the camera) |
| `--no-tracker`, `--no-browser` / `-NoTracker`, `-NoBrowser` | Skip the webcam / the browser |
| `--jump rise` / `-Jump rise` | Experiment: fire jumps on the way up |
| `API_PORT=8020 WEB_PORT=5220` / `-ApiPort`, `-WebPort` | Other ports |

The launcher leaves anything already running alone, stops only what it started on Ctrl-C, and refuses a second launcher. It never reads `backend/.env`. The macOS script was tested; the Windows script has not been run yet.

## Setup from a fresh clone

You need Node 20.19+, Python 3.9+ and [uv](https://docs.astral.sh/uv/). A Gemini key is optional: without one the game plays on its scripted story, and scans and the riddle door fall back.

**macOS / Linux:**

```bash
git clone https://github.com/trungle42/Storybound.git
cd Storybound
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # then put your key after GEMINI_API_KEY=  (never commit .env)
cd ../frontend
npm install
cd ../cv_2
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
cd ..
```

**Windows** (about 10 minutes the first time). Install [Git](https://git-scm.com/download/win), [Node.js 20.19+ LTS](https://nodejs.org), [Python 3.12](https://www.python.org/downloads/) (on an ARM laptop take the x86-64 installer, because OpenCV has no ARM Windows build) and [uv](https://docs.astral.sh/uv/) (`winget install astral-sh.uv`). Close and reopen PowerShell so they are on the PATH, then:

```powershell
git clone https://github.com/trungle42/Storybound.git
cd Storybound
powershell -ExecutionPolicy Bypass -File .\scripts\install-art-pack.ps1 C:\Users\you\Downloads\storybound-art-pack.zip   # optional: the zip from Trung or Rishaan
cd backend;  py -3 -m venv .venv;  .venv\Scripts\pip install -r requirements.txt;  cd ..
cd frontend; npm.cmd install;  cd ..
cd cv_2;     uv venv --python cpython-3.12-windows-x86_64-none .venv;  uv pip install --python .venv\Scripts\python.exe -r requirements.txt;  cd ..
```

A Gemini key goes in `backend/.env` (`copy backend\.env.example backend\.env`, then put it after `GEMINI_API_KEY=`); a teammate's laptop does not need one. Two Windows traps this avoids: running a `.ps1` directly is blocked by the default script policy (hence `powershell -ExecutionPolicy Bypass -File ...`, which applies to that one run and changes no setting), and so is `npm`'s own `npm.ps1` (hence `npm.cmd`). The first time, Windows asks whether Python may use the network: allow it on private networks, or the phone cannot reach your laptop.

**Art pack (optional, private).** Everything except the character models is in the repo. For the full characters, ask Trung or Rishaan for `storybound-art-pack.zip`, then `./scripts/install-art-pack.sh ~/Downloads/storybound-art-pack.zip` (macOS / Linux; the Windows line is above). It unpacks into git-ignored folders; never commit it. Without it the game uses plain stand-in characters, and the sword and wand are not drawn in the hand (the weapons still work).

**Without the launcher,** start the pieces yourself:

```bash
cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000     # check: curl http://localhost:8000/api/health  ("gemini": true = key loaded)
cd frontend && npm run dev                                                    # http://localhost:5173
cd cv_2 && .venv/bin/python -m tools.publish                                  # the tracker; on Windows .venv\Scripts\python.exe
```

Open the game at `localhost`, not the laptop's network address: browsers only allow the webcam on `localhost` or HTTPS. `OFFLINE=1` in `backend/.env` forces the canned fallbacks (demo insurance).

## Join from your laptop (3 players, 3 laptops)

Each player runs their **own** game, backend, tracker (their own wand colour) and phone, and sees the other two heroes in their world. The host's backend is the meeting point, reached through its tunnel, so any network works.

**Host** (macOS): `./scripts/demo.sh --tunnel --color red --name Trung` (Windows: `.\scripts\demo.ps1 -Tunnel -Color red -Name Trung`). It prints the room code and one line per teammate, with the link and room filled in. Send each teammate their line.

**Teammate:** do the [setup](#setup-from-a-fresh-clone) once (Windows block above), then each time paste the line the host sent. It looks like this:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1 -Color blue -Name Rishaan -Join https://<words>.trycloudflare.com -Room <code>
```

macOS teammates run the same with `./scripts/demo.sh --color blue --name Rishaan --join <link> --room <code>`. It starts your backend, game and tracker (your colour only) and opens your game already connected to the others (`?presence=` the host's link). Scan the QR code with your phone as usual. If the venue Wi-Fi blocks your phone, add `-Tunnel` (your phone then uses your own tunnel; the room stays the host's). Paste the host's line as it is; if you type a link that contains `&` yourself, put it in quotes, since PowerShell treats `&` as an operator.

What crosses the internet: each hero's position, animation and health, and cosmetic spell and slash effects, through `/ws/presence/{room}` on the host (`backend/app/presence.py`: three players at most, every message rebuilt and clamped, 30 a second, nothing stored). The tunnel answers nothing else but the phone page and the phone and presence sockets.

## Testing

| What | Command | Result on `main` |
|---|---|---|
| Backend | `cd backend && OFFLINE=1 .venv/bin/python -m pytest` | 89 pass |
| Frontend unit tests | `cd frontend && npm test` | 108 pass |
| Type-check and build | `cd frontend && npm run build` | passes |
| cv_2 | `cd cv_2 && .venv/bin/python -m pytest` | 291 pass (no camera needed) |
| Browser checks | `npm run dev`, open the page, click its run button. Needs WebGL | `tests/adventure.html?story=scripted`: 18 checks, full story. `tests/demorun.html`: 12, the demo run with every input. `tests/phonerun.html`: 5, phone only (keep the tab visible). `./scripts/rehearse-multiplayer.sh --harness` (opens `tests/multiplayer.html`): 11, the presence relay and three games |
| Real Gemini | `cd backend && PYTHONPATH=. .venv/bin/python tools/live_smoke.py` (needs a key); `.venv/bin/python tools/test_photos.py <folder>` for `/api/artifact` | |

Live Gemini, the phone and the webcam are not covered by the automated checks; test them by hand ([docs/demo-script.md](docs/demo-script.md) has a checklist).

## Architecture and folders

- **The engine owns the rules, Gemini owns the words.** The backend fixes each story beat's structure from a catalog the engine can run; Gemini only writes narration, prompts, names and the storybook. If Gemini fails, the browser falls back to the scripted story per beat.
- **Relays.** Phones, the tracker and the other laptops each talk to the backend over a WebSocket; it validates and rebuilds every message. The game side of the phone and camera relays only accepts this laptop's own pages (loopback and the game's Origin).
- **Calls to Gemini** are one per story beat and one per photo, never per frame; the browser never sees the API key.

| Path | What is in it | Owner |
|---|---|---|
| `frontend/src/adventure/` | The 3D game. `Adventure.ts` is the main loop, input, combat and story flow; `Scanner.ts`, `weapon.ts`, `armory.ts` (Reality Rift); `forge.ts` (wand shapes, runes, `?wand=`), `WandModel.ts`, `WeaponsHud.ts`; `PhoneInput.ts`, `phoneActions.ts`, `players.ts`, `qr.ts` (phone); `CvInput.ts`, `cvMath.ts`, `WandHud.ts` (tracker); `Fairy.ts` (Pip); `Presence.ts` (other laptops' heroes); `Cinematics.ts`; `World.ts`, `Actor.ts`, `Willow.ts`, `Fx.ts`, `Physics.ts` | Rishaan, and everyone |
| `frontend/src/story/`, rest of `frontend/src/` | `ScriptedStory`, `GeminiStory`; `contracts.ts` (types shared with the backend); the classic 2.5D edition | Rishaan and Trung |
| `frontend/scripts/`, `frontend/public/models/` | Blender sources for our own models (`build-3d-kit.py`, `build-waystone.py`, `build-lantern.py`, `build-sword.py`) and their GLB output | Rishaan |
| `backend/app/` | `main.py` (routes), `provider.py`, `gemini.py`, `fallbacks.py`; `joystick.py`, `cv.py`, `presence.py` (relays); `tunnel.py` (the tunnel lockdown) | Trung |
| `backend/static/joystick.html` | The page the phone opens | Trung |
| `cv_2/` | The webcam tracker (`tools.publish`, `tools.autotune`, `tools.demo`), its own venv and tests | haicil |
| `scripts/` | `demo.sh` / `demo.ps1` (the launcher), `install-art-pack.sh` / `.ps1`, `rehearse-multiplayer.sh` | Trung |
| `docs/` | [3d-adventure.md](docs/3d-adventure.md), [api-contract.md](docs/api-contract.md), [art-direction.md](docs/art-direction.md), [devpost.md](docs/devpost.md), [demo-script.md](docs/demo-script.md); also [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md) | everyone |

The team: **Rishaan Malik** (game and art, on Windows), **Trung Le** (backend, Gemini, integration, Reality Rift), **haicil / Allen Ai** (computer vision, on Windows ARM64).

## Team rules

- **Work on a branch and open a PR against `main`.** Never push to `main` directly.
- **Never commit `backend/.env`** (the Gemini key) **or `frontend/public/models/assetyard/`** (the private art pack). Both are git-ignored.
- **Keep `Adventure.ts` edits small.** Everyone touches it. Put new logic in its own file and call it from `Adventure.ts` in a few lines.
- Touching someone else's folder (`backend/app`, `cv_2/`)? Tell the owner first.

## Status

**Working on `main`:** the 3D adventure (demo run and full story), the Gemini storyteller with scripted fallbacks and the storybook, Reality Rift relics and boss weaknesses, the riddle door, two weapons with rune requests, phone control through the tunnel, up to three players including Pip, the camera tracker connected to the game (with autotune), presence for three laptops, the one-command launcher, and our own waystone, lantern and sword models.

**In progress (not on `main` yet):**

- **Per-player avatar skins.** Today a remote hero is the ranger or the shield-maiden with the player's colour on the wand, sword glow, ground ring and name tag. `TODO(after merge)`
- **A permanent link through `storybound.tech`:** `demo.sh --domain play.storybound.tech` instead of a new `trycloudflare.com` link each launch (PR #51, a draft waiting on the domain). `TODO(after merge)`

**Not done:** aiming spells by pointing the wand; a hosted version (phones can join through a tunnel, but the game runs on a laptop); validating the tracker across lighting, cameras and people (slash recall needs the whole swing in view); the 3D game does not use the telemetry and leaderboard endpoints (`/api/event`, `/api/score`, `/api/leaderboard`, `/api/stats`); and the character models still come from the private pack.
