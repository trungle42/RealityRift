# Demo script: 2-minute video and live judging

Two things here: a shot list for the 2-minute Devpost video, and a script for showing the game live to judges. Both use the same setup and the same beats. Every beat says which game mode it needs, because the game opens a short demo run by default and keeps the whole tale behind `?story=full`.

## Which mode to open

| | **Demo run** (default) | **Full story** (`?story=full`) |
|---|---|---|
| URL | `http://localhost:5173/` (the launcher opens `/?wand=yellow` for you) | `http://localhost:5173/?story=full` |
| What it is | Willow's briefing, one wave of six shadows, then Morwen the Frost Witch, then a result screen | The whole tale: camps, freeze challenge, crossroads vote, pose seals, riddle door, lantern fairy, a boss on either route, the storybook |
| Story | Fixed text. No Gemini storyteller | Gemini beats (scripted fallback) and the personalised storybook |
| Gemini is used for | A scan (`/api/artifact`) | Story beats, the storybook, scans, the riddle door |
| Boss | Always Morwen: **fire** doubles your damage | Castle route Morwen (fire), cave route Umbraxis (light) |
| Length | Designed for roughly a minute of fighting after the briefing (the code says about 15-20 s for the wave and 25 s for the boss; not timed by me) | Much longer; not timed |

**Recommendation.** Use the **demo run for the live slot** and for the main video take. It has a clear start and end, and everything in this script except the freeze challenge, the pose seals, the riddle door and the storybook. **Record the riddle door and the storybook clips in `?story=full`** ahead of time, and cut them in. If a judge asks to see more, open a second tab at `?story=full` and say it is the long version.

Both modes have the scan and relics, the wand and the sword, the phone and the camera tracker (slash, jump, wand), up to three players and the rune requests.

## The setup

One person plays with their body, phone first. The webcam watches them, and the laptop runs the game.

- **Left hand: the phone.** Bright lime tape on the front of it. The joystick page is open on its screen (a QR code on the game's start screen opens it). The thumb drags to move and taps to act; **Scan**, **Roll** and **Slash** are buttons on the page. Swing the phone down like a sword and the camera sees the strike.
- **Right hand: the wand.** A yellow ball on a grey, black or white stick. Hold it still for a moment, then draw the shape the screen asks for in the air. Which colour is whose comes from the launcher's `--color` (default `yellow`, hero one). Keep other yellow things out of the picture: the largest yellow blob wins.
- **Standing:** 1.5-2 m back from the webcam, so the whole body is in the picture and a jump reads. Keep the whole swing of the phone inside the picture, from about shoulder height to the waist.
- **Laptop:** `./scripts/demo.sh` (`.\scripts\demo.ps1` on Windows) starts the backend open to the network, the game and the tracker, and opens the game in your browser. The tracker has no window of its own: its camera picture, with the wand trails drawn on it, shows inside the game (the wand panel, bottom left, with a hint such as "Yellow wand not seen" or "Step back a little" for a solo player). Options: `--tune` (tune the colours to this camera and room first), `--tunnel` (phones on any network), `--color red,blue,yellow` (a wand colour per player), `--no-tracker`, `--no-browser`. See "Demo in one command" in the README.

Facts the script relies on, all checked in the code:

- **Demo run order:** you start a few strides from Willow. Walk up and tap (or press **E**) for her briefing (four lines: one tap finishes a line, the next moves on; then a quest card to accept). Six shadows follow, then Morwen, then a result screen with the time, foes defeated, hearts left and starlight. Before Morwen arrives, Willow tops your hearts back up.
- **Full story order** (`?story=full` only): the wood (a freeze challenge: stay still) -> crossroads vote (castle or cave) -> the pose gate -> the **riddle door** -> the lantern fairy -> the boss -> the storybook.
- **Bosses:** Morwen the Frost Witch is weak to **fire** and resists ice. Umbraxis the Shadow Wyrm (cave route, full story only) is weak to **light** and resists shadow.
- **Wards:** bosses are warded while they wind up an attack. Spells and slashes land after the boss bar says "The ward is down". The bar also shows `weak to <element>`. In the demo run the boss is locked on automatically when she arrives.
- **Runes in fights:** in the wave and against Morwen, a prompt near the top of the screen asks for one shape ("▲ Draw a triangle · Meteor"). Only that shape casts; any other shakes the prompt with "Not that rune". A cast, or 10 s without one, moves the request on. The wand needs 2 s between spells. Out of fights any shape casts. (`?runes=free` removes the requests.)
- **Two weapons:** the wand's shapes are circle nova, triangle meteor, square wave, star chain lightning (cooldowns 1.6-3 s). A scanned **relic** infuses the wand, the F bolt and the sword with its element, so the boss's x2 / x0.5 applies to slashes too.
- **One webcam:** while the tracker runs it owns the camera. The scanner shows the tracker's picture and scans from a full-size snapshot the tracker sends, so scanning does not fight the wand. With no tracker, the scanner opens the camera itself.
- **The game pauses while the scanner is open**, so you can scan in the middle of the wave without being hit.
- **A jump** (camera or key) gives 1 s of invulnerability, at most once every 2.5 s.
- **Pose seals** (full story only): besides holding **1 / 2 / 3**, a seal opens when you draw its rune with the wand: triangle for arms up, square for the T-pose, circle for the crouch.
- **Freeze challenge** (full story only): the camera counts the player as moving at about 6% of the picture in motion, so a lean or a wave breaks it. People walking behind the player count too.
- **Keyboard stand-ins:** if the camera fails, **4 5 6 7** draw circle, triangle, square, star; **J** strikes; **Space** jumps; the phone's **Slash** button strikes. The game plays the same.
- **Sword and wand models in the hero's hands** come with the private art pack. Without it the weapons still work, but nothing is drawn in the hand.
- **Willow's briefing is read aloud** by the browser's speech voice. Mute it with the sound button if the room is loud.

## Part 1. The 2-minute video

Record the clips separately and cut them together; you cannot reach every beat in two minutes of real play. Each take starts from a fresh page (the result screen's button reloads the game), so record Willow's briefing on one load and the scan on another. Screen-record the game full screen and film the player with a second camera so the viewer sees the phone, the wand and the screen cause and effect. Keep the wand panel in frame: it shows the camera, the wand trails and the shape you drew.

| Time | Beat | Mode | On screen | Say (about) |
|---|---|---|---|---|
| 0:00-0:10 | **Hook** | Demo run | Wide shot of the player holding a phone in one hand and a wand in the other. The title screen with its QR code in the corner. | "Fairy tales turn ordinary things into magic. In Storybound, your phone is a controller and a sword, a stick is a wand, and a mug is a power-up. Don't just read the fairy tale. Become part of it." |
| 0:10-0:22 | **Phone joystick** | Demo run | The phone scans the QR code; the start screen flips to "Phone connected · Tap your phone to begin". One tap and the game starts. The thumb drags and the hero walks up the path; push past the ring to sprint. | "Scan a code and my phone is the controller. No app, no keyboard. The camera is also watching me." |
| 0:22-0:34 | **Willow** | Demo run | Walk up to Willow, tap. Show two lines of her briefing, then the quest card "The Last Warm Spring" and a tap to accept. | "Willow tells us the Frost Witch has stolen the last warm spring. We have to hold the glade." |
| 0:34-0:52 | **Scan to get a relic** | Demo run | On a fresh load, tap **Scan** (top right of the phone) before talking to Willow. The scanner shows the camera picture. Hold up a mug of hot tea or coffee, tap to take the photo. "Reading your object" spinner, then the relic card with the player's own photo: "Relic: infuses your wand and sword with fire". Tap to take it. The wand's crystal and the sword glow in that colour; the weapons row reads `Sword · fire` and `Wand · fire`. | "Reality Rift. I hold up a real mug. Gemini reads it and turns it into a relic. Now my wand and my sword both burn with fire." Name the element it chose. |
| 0:52-1:05 | **Riddle door** | **Full story** clip | At the Chapter III pose gate, draw the runes the gate asks for with the wand (square, triangle, circle on the standard gate) and each seal opens. Then the door with carved eyes: "Show me a book." Take the photo with a real book in view. "The door accepts: it sees a book." | "A seal that opens to a shape I draw. Then a door that has never seen our world asks to see a book. Gemini checks the photo." |
| 1:05-1:15 | **Wand shape cast** | Demo run | The wave arrives and the prompt asks for a shape: "▲ Draw a triangle · Meteor". Draw it: a fire meteor falls on the nearest foe. The prompt moves to the next shape; draw a circle if it asks for one: a nova bursts around the hero. The wand panel flashes "Triangle!". | "The game asks me for a shape and I draw it in the air. A triangle is a meteor, a circle is a nova. The relic decides the element." |
| 1:15-1:22 | **Phone slash** | Demo run | Swing the lime-taped phone down: the hero's sword strikes, with a fire-coloured slash. Optional: a real jump, and the hero leaps and dodges. | "And the phone is my sword." |
| 1:22-1:40 | **Boss weak to your element** | Demo run | Morwen strides in. The boss bar shows `weak to fire`. Roll away (tap **Roll**), wait for "The ward is down", then draw the asked shape and slash: "Weak point!" flashes and the damage numbers are doubled. | "The Frost Witch fears fire. Because my relic is fire, she takes double damage from my spells and my sword. What I pick up from my real room decides the fight." |
| 1:40-2:00 | **Storybook** | **Full story** clip | The ending of a full-story run, then the storybook pages. A page tells how the real mug became the relic. Close on the title and the repo URL. (If you have no full-story ending, use the demo run's result screen, "The Last Warm Spring", and skip the storybook line.) | "And the full game writes the ending from what we actually did, down to the mug. Storybound: don't just read the fairy tale. Become part of it." |

Notes for the cut:

- Keep the relic card on screen for at least two seconds so viewers can read the element.
- Do not show the stand-in note ("Gemini was unavailable") in the video; retake the scan.
- **The two full-story clips are the long part of the recording.** Getting from the title to the pose gate and to the ending of the full tale takes real play (not timed). Do it in a rehearsal take, keep the best one, and scan the mug in that run so the storybook can mention it.
- **The storybook page that names the mug** is written by Gemini on request, so it is not guaranteed. The offline script always adds one ("The Reality Rift"). To record with it, start the dev server with `VITE_STORY=scripted npm run dev` (scans still use Gemini) and open `?story=full`. Do not use `?story=scripted` for this: it replaces `full`, and you would get the demo run.
- The camera-to-game link has been tested end to end with synthetic tracker frames, but not much with a live webcam. Do a full take of the wand, slash and jump beats before the real recording, and keep the footage that works.
- Optional extra shots, all working on `main`: a second phone joins and hero two moves on its own stick; a third phone flies Pip the fairy (see the live script, step 8).

## Part 2. Live judging script (about 3 minutes in the demo run, then questions)

Have the game open at the plain URL (the demo run) on the start screen, the backend and the tracker running (the launcher does both), and the phone ready to scan the QR code. Phone and wand first; the keyboard stays untouched unless something fails.

1. **One sentence (15 s).** "Storybound is a 3D fairy tale you play with your real things: a phone for a controller and a sword, a stick for a wand, a mug for a power-up. Gemini reads the mug and writes the rest."
2. **Pair the phone (20 s).** Scan the QR code on the start screen. It says "Phone connected · Tap your phone to begin". Tap. The "Body tracker connected" toast and the wand panel with your camera picture show that the camera is on.
3. **Scan a relic, before Willow (40 s).** The hero starts a few strides from Willow, so there is time. Tap **Scan** on the phone. Ask the judge for an object, or use your rehearsed mug. Hold it up, tap to take the photo, tap to take the relic. Read the relic card aloud: it infuses the wand and the sword. "The element decides who it is strong against, for spells and slashes alike."
4. **Willow's briefing (25 s).** Drag to walk up to her, tap to talk. Tap through the four lines, and tap to accept the quest.
5. **The wave: wand, sword, roll (45 s).** Six shadows come out of the trees and the screen asks for a shape. Draw it. Swing the phone to strike. Tap **Roll** when a shadow winds up. A real jump makes the hero leap and dodge for a second. Point at the prompt and the wand panel.
6. **Morwen (45 s).** She strides in and your hearts are topped up. Show the boss bar's `weak to fire` line. Roll away from her frost, wait for the ward to fall, draw the asked shape and slash. Point at the "Weak point!" flash and the doubled damage.
7. **Result (10 s).** The result screen shows the time and foes defeated, and, if you scanned a relic, Willow's closing line names your real object. "If the network dies, the story falls back to a scripted version, and the camera is optional too: the keyboard does the same."
8. **More players (30 s, optional, working on `main`).** The QR code is only on the start screen, so a second phone either scans it there (before you tap to begin) or opens the URL that **H** shows. It says "Player 2", hero two joins and moves on that phone's stick, and the phone has its own Roll, Slash and Scan. A third phone flies Pip the lantern fairy (drag to fly, tap for pixie dust, Slash to dash). For the extra wands to cast, start the launcher with the colours, for example `./scripts/demo.sh --color yellow,blue` for hero two or `--color red,blue,yellow` for Pip too.
9. **Networked multiplayer (if multiplayer is merged).** `TODO(after merge)`: a second laptop joins the host through the tunnel, each laptop runs its own game, and the other player's avatar appears in your world. Write the exact steps from the README's multiplayer section once it exists. Until it is merged, do not show or promise this.

If a judge wants more, say the demo run is the short version and open a second tab at `?story=full`: the freeze challenge reads the camera, the pose seals open to a drawn rune, the riddle door asks for a real object, and the game ends with a storybook of the run. Show the riddle door from the recorded clip if you do not have time to play to it.

If you only have a minute: do steps 1, 2, 3 and 6, and a jump for the crowd.

### Likely questions

- **What does Gemini actually do?** In the full story it writes each story beat and the storybook (text); in both modes it turns a photo into a relic (vision), and in the full story it checks the riddle-door photo (vision). The engine owns the rules, so Gemini cannot invent mechanics. In the short demo run the briefing is fixed text and Gemini only reads the scan.
- **What if Gemini is down or slow?** The story falls back to a hand-written script per beat, a scan returns a stand-in relic, and the door lets you through.
- **How does the wand work?** An OpenCV program finds the yellow ball by colour, names the shape you draw, and sends it to the game through the backend. The game asks for one shape at a time. No machine-learning model to download.
- **Is the tunnel safe?** Through it only the phone page and the phone socket answer, and the room code is random. The API behind the Gemini key, the camera relay and the game's side of the controls answer 403 or close. The game side of the relays only accepts this laptop's own pages.
- **How well is it tested?** Backend 78, frontend unit tests 101, 34 browser checks that play the game (17 full story, 12 demo run with every input at once, 5 phone-only), tracker 273. The camera-to-game link is tested with synthetic frames; be honest that live-webcam time is limited.
- **Is it hosted?** No. It runs on a laptop; the README has run steps from a fresh clone. Phones can join through a tunnel.
- **Who built what?** Rishaan: game and art. Trung: backend, Gemini, integration, Reality Rift. haicil: computer vision.

## Pre-demo checklist

Run through this twice: once the night before, once ten minutes before judging.

**Start everything**

- [ ] One-time setup done: `backend/.venv`, `frontend/node_modules`, `cv_2/.venv` (README, "Run everything from a fresh clone").
- [ ] `./scripts/demo.sh` (macOS / Linux) or `.\scripts\demo.ps1` (Windows) starts the backend open to the network, the game and the tracker, opens the game in your browser, and prints the game URL, the phone URL and the room. Its author tested the macOS script; the Windows script had not been run when the README was written. If it fails, start the three pieces by hand as the README describes.
- [ ] Tune the camera to the room: run the launcher with `--tune` once (it needs the camera, so no tracker may already be running). It asks you to hold the wand ball and the phone tape in a box, then checks the result and saves it. Re-tune if the light changes.
- [ ] Open the plain URL for the demo run. Keep a second tab at `?story=full` ready only if you plan to show the long version.

**Backend and Gemini**

- [ ] `backend/.env` has your `GEMINI_API_KEY`.
- [ ] The backend is running with `--host 0.0.0.0` (the launcher does this). Without it the phone cannot connect.
- [ ] `curl http://localhost:8000/api/health` says `"gemini": true`.
- [ ] Do one full scan now with the exact object you will use, and note the element you got. A hot drink tends to come back as fire; confirm yours does. If you plan to show the riddle door, do one check of it too, in `?story=full`.

**Network and phone**

- [ ] The phone can reach the laptop: the same Wi-Fi, a phone hotspot with the laptop joined to it, or `./scripts/demo.sh --tunnel` (needs `cloudflared`, installed once with `brew install cloudflared`; each launch prints a fresh phone link and room). Venue Wi-Fi often blocks device-to-device traffic.
- [ ] Scan the QR code on the start screen and see "Phone connected". If the QR does not open, use `http://<laptop-ip>:8000/joystick`.
- [ ] The phone's screen will not sleep or lock mid-demo (turn off auto-lock).
- [ ] Lime tape on the front of the phone, in the left hand. The wand panel should show no "Phone tape not seen" hint.
- [ ] For a second or third player: up to three phones per room; each shows "Player N · colour". A fourth is told the room is full.

**Camera tracker**

- [ ] The launcher or the tracker's terminal prints when the backend connects and when the game joins ("wand on, any shape"). The game toasts "Body tracker connected".
- [ ] Yellow wand: ball on a neutral stick. Hold it still for a moment, then draw. In a fight the game asks for one shape; draw each of the four once before judging and watch the wand panel flash. A star is the hardest shape for the tracker to recognise; the request changes after 10 s if you cannot get it.
- [ ] Stand 1.5-2 m back. Swing the phone from about shoulder height to the waist, inside the picture. Do five slashes and one jump. If you see "Step back a little" or "Yellow wand not seen" in the wand panel, fix that first.
- [ ] Nobody walks behind the player (matters for the freeze challenge in `?story=full`).
- [ ] Press **Scan** while the tracker runs and check the scanner shows the tracker's camera picture. The scanner uses the tracker's camera, so the two do not fight. If the picture is missing, use **Choose a photo** with a photo of your object saved on the desktop.

**Game**

- [ ] Open the game at `http://localhost:5173` (not the network address, or the browser will refuse the webcam).
- [ ] Art pack installed: the folder `frontend/public/models/assetyard/` exists. Without it the characters are plain stand-ins and the sword and wand are not drawn in the hands.
- [ ] Browser: allow the camera for `localhost` on the first scan. Do this before judges arrive.
- [ ] Sound and spoken narration: use the sound button to match the room. Willow's briefing is read aloud. Check the volume.
- [ ] `cd frontend && npm test` and `npm run build` pass. Optionally run the browser checks: `/tests/adventure.html?story=scripted` (full story), `/tests/demorun.html` (demo run, every input) and `/tests/phonerun.html` (phone only).

**If something fails**

- **Gemini slow or down:** the demo run does not need Gemini except for the scan. A scan waits up to 25 s before offering Try again; use **Choose a photo** with a saved photo, or press Escape and play on without a relic. For `?story=full`, set `OFFLINE=1` in `backend/.env` and restart the backend, or run the dev server with `VITE_STORY=scripted`. (`?story=scripted` will not do it: it replaces `full` and gives the demo run.)
- **Stand-in relic:** it is random between **Moonlit Orb (light)** and **Frostbound Blade (ice)**. Morwen is weak to fire, so in the demo run neither stand-in doubles your damage (light is normal, ice is **half** damage). If the scan falls back, scan again; if Gemini is down, skip the "Weak point!" beat or use the recorded clip. In `?story=full` you can still show it: take the **cave route**, where light doubles damage against the Shadow Wyrm and ice is normal damage. The armory keeps earlier relics, so you can re-equip a good one without a new scan.
- **Wand shapes not registering:** add `?runes=free` to the URL so any shape casts in a fight (the cooldowns still apply), or use the keyboard stand-in **4 5 6 7**.
- **Camera tracker flaky or dead:** stop the tracker and play with the phone and keyboard: **4 5 6 7** for the shapes, the phone's **Slash** button (or **J**) to strike, **Space** to jump, **1 / 2 / 3** for the pose seals. Say so plainly.
- **Phone will not connect:** WASD works the same. Check the backend was started with `--host 0.0.0.0`, the phone is on the same hotspot, or switch to `--tunnel`.
- **Riddle door** (`?story=full`): **Skip** opens it anyway with no heart lost. With no Gemini key the door accepts any photo.
- **Last resort:** a recorded run of the video on the desktop.
