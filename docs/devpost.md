# Devpost draft: Storybound

Draft text for the HackTX 2026 Devpost page. Edit it into the team's own voice before pasting. Everything below describes what is on `main`, except lines marked `TODO(after merge)`: those cover work on other branches. Flip or delete them when the branches land, and cut anything that did not make it.

Before submitting: add the demo video link, tick the prizes you are entering on Devpost (see "Prize tracks" for the ones that need a condition met first), and make sure the GitHub repo is public.

## Name

Storybound

## Tagline

Don't just read the fairy tale. Become part of it.

Shorter options if the field is too small: "A fairy tale that reads your world" · "Hold up a real object. Fight with it."

## Inspiration

Fairy tales turn ordinary things into magic: a pumpkin becomes a carriage, a plain mirror starts talking. We wanted a game where that happens to the objects on your own desk. We also wanted a story that is not on rails. A bedtime storyteller changes the tale for the child in front of them, so the game's storyteller should notice what you did and say so.

## What it does

Storybound is a third-person 3D fairy-tale adventure that runs in the browser. You explore a small kingdom, talk to Willow the waykeeper, solve doors and fight a Frost Witch or a Shadow Wyrm, alone with an AI companion or with a friend on the same keyboard.

- **A storyteller that remembers.** Gemini writes each scene from what you did: which road you took, which challenge you failed, what you found. At the end it writes a personalised storybook of your exact playthrough.
- **Reality Rift.** Press X, hold up a real object (a bottle, a mug, a pen) and Gemini vision turns it into a magical weapon: a name, an element, a spell shape and a rarity. Bosses take double damage from the element they fear and half from the one they resist, so what you pick up matters.
- **The riddle door.** A door with carved eyes asks you to show it "a book" or "a bottle or a cup". Gemini checks your webcam photo, and tells you what it saw if you got it wrong.
- **Your phone is the joystick.** Press H, open the URL on your phone, and drag your thumb to move. No app to install.
- **Camera-tracked wands, slashes and jumps.** A separate OpenCV tracker follows coloured wands drawing a circle, triangle, square or star, spots a phone swung like a sword, and spots a jump. In the game, the phone slash swings the hero's sword, a real jump makes the hero jump, and moving during the freeze spell breaks it. `TODO(after merge)`: every hero carries two weapons, a sword and a wand, and drawing a shape with the wand casts that shape's spell (circle nova, triangle meteor, square wave, star chain). A scanned relic infuses both with its element, so a fire relic makes both your spells and your slashes burn the Frost Witch for double.

If the network or Gemini fails, the game keeps going: the story switches to a hand-written script for that scene, a scan returns a stand-in weapon, and the riddle door lets you through.

## How we built it

- **Game:** TypeScript, Vite, Three.js and Rapier physics (a kinematic character controller) in `frontend/src/adventure/`. Our own models are built in Blender from a script and exported as GLB. The earlier 2.5D (PixiJS) edition is still playable at `?mode=classic`.
- **Backend:** FastAPI on Python, calling Gemini (`gemini-3.8-flash`) with structured output and thinking turned off for speed. Three jobs: write story beats, turn a photo into an artifact (`/api/artifact`), and check a photo against a requested object (`/api/verify`).
- **Who owns what:** the game engine owns the rules (combat, hearts, timing); Gemini owns the words. The backend picks each beat's structure from a catalog the engine can run, and Gemini only writes narration, prompts, names and the storybook. It cannot invent a mechanic the game cannot play.
- **Phone joystick:** the phone opens a page served by the backend and streams a stick position over a WebSocket. The backend validates it and relays it to the game, and drops anything that is not a clamped `move` message.
- **Computer vision:** `cv_2/` is a Python + OpenCV tracker. It finds coloured objects by HSV thresholds (no model download), names the shape each wand draws using Fourier descriptors, spots a fast downward swing of a lime-taped phone, and spots a jump from optical flow.
- **Tests:** 32 backend tests, 60 frontend unit tests, 13 in-browser gameplay checks that drive the real renderer, and 211 tracker tests that run on synthetic frames with no camera.

## Challenges we ran into

- **Keeping Gemini inside the rules.** Left alone, a language model invents mechanics the game cannot run. We made the backend decide each beat's structure in code and let Gemini write only the text, with a per-beat fallback to a scripted story.
- **Latency.** A story beat has to arrive while the player walks to the next marker. We turned Gemini's thinking off, capped calls at one per beat, and set timeouts so a slow reply falls back instead of freezing the game.
- **Getting a phone to talk to a laptop.** A default `uvicorn` start only listens on the laptop itself, and venue Wi-Fi often blocks device-to-device traffic. The backend must bind to `0.0.0.0`, and a phone hotspot is the safe plan.
- **Tracking by colour.** Skin and lips sit next to red in hue, so red needs a roundness test. Webcam lighting varies by 2x across the frame, so the tracker finds an object strictly and then follows it loosely. A phone slash lasts about three camera frames and smears into motion blur, so we tracked bright lime tape and tuned the thresholds on recordings of real swings.
- **Windows on ARM64.** OpenCV has no native build, so the tracker needs the x86_64 Python under emulation.
- **Three people in one file.** `Adventure.ts` is the game's main loop and everyone touched it. We kept edits small and put new features in their own files (`Scanner.ts`, `weapon.ts`, `PhoneInput.ts`).
- **Art we can own.** Some third-party models are kept out of the repo, so the game falls back to stand-in characters without them. We are rebuilding the models ourselves in Blender. `TODO(after merge)`: update this once the pilot model lands.

## Accomplishments that we're proud of

- A complete run, start to storybook, that still works with no network and no API key.
- Two different uses of Gemini vision in one game: making a weapon from an object, and judging whether a photo matches what a door asked for.
- A phone that becomes a controller by opening one URL, with no install.
- A tracker that names a drawn shape and tells a jump or a slash from ordinary movement, with its false-positive rate measured rather than guessed.
- Tests on every layer, including a browser harness that plays the game.

## What we learned

- Structured output plus a catalog the engine already supports is what makes an LLM safe to put inside a game loop.
- Every AI call needs a fallback before it needs a prompt. Demos meet bad Wi-Fi.
- For computer vision, record real input and replay it offline; guessing thresholds does not work.
- Splitting the work by folder, with one shared file kept small, avoided most merge pain.

## What's next

- Finish wiring the tracker into the game: wand shapes for the pose seals. (Wand shapes already cast spells.) `TODO(after merge)`
- Reality Rift extras: the scanned weapon modelled in the hero's hand, and a clearer hint of what a boss fears. `TODO(after merge)`
- Our own models for the whole world, so every asset is ours.
- A hosted version, so a judge can play without cloning the repo.
- More bosses and more elements, so more kinds of objects matter.

## Built with

`typescript` · `three.js` · `rapier` · `vite` · `python` · `fastapi` · `google-gemini-api` · `gemini-vision` · `opencv` · `numpy` · `websockets` · `pydantic` · `blender` · `webgl` · `pixijs`

## Prize tracks

The first three rows come from the HackTX prize list the team saw; check the exact names and rules against the Devpost page when you submit. The last three rows are guesses.

| Track | Why it fits |
|---|---|
| **MLH Best Use of Gemini API** (main target) | Gemini writes every story beat and the storybook (structured output, with a scripted fallback for each beat), turns a photo into a weapon through `/api/artifact`, and judges the riddle-door photo through `/api/verify`. **Tick this prize on Devpost.** |
| **MLH Best Domain Name from .Tech** | Only counts if the team registers a .tech domain (for example `playstorybound.tech`) with MLH's free code and points it at the Devpost page, the video or the repo. `TODO(if registered)`: add the domain here and under Links, or delete this row. |
| **Cursor track** | Only if true: enter it only if teammates really built parts of the project with Cursor and can say which. Describe exactly what was built with it, and claim nothing more. `TODO(if true)`: write that sentence here, or delete this row. |
| Best overall (guess) | One complete game, from start screen to personalised storybook, with the phone, camera and AI all working together. |
| Best game or most creative hack (guess) | A 3D adventure where your real objects become spells. |
| Best theme fit, "Fairy Tale" (guess) | A fairy tale whose magic comes from the player's own world. |

## Links

- Code: https://github.com/trungle42/Storybound
- Demo video: _add the link_
- Try it: no hosted version yet; follow the README, "Run everything from a fresh clone".
