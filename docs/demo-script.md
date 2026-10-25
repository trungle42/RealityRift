# Demo script: 2-minute video and live judging

Two things here: a shot list for the 2-minute Devpost video, and a script for showing the game live to judges. Both use the same setup and the same beats. Every beat says which game mode it needs, because the game now opens a short demo run by default and keeps the whole tale behind `?story=full`.

## Which mode to open

| | **Demo run** (default) | **Full story** (`?story=full`) |
|---|---|---|
| URL | `http://localhost:5173/` | `http://localhost:5173/?story=full` |
| What it is | Willow's briefing, one wave of six shadows, then Morwen the Frost Witch, then a result screen | The whole tale: camps, freeze challenge, crossroads vote, pose seals, riddle door, lantern fairy, a boss on either route, the storybook |
| Story | Fixed text. No Gemini storyteller | Gemini beats (scripted fallback) and the personalised storybook |
| Gemini is used for | A scan (`/api/artifact`) | Story beats, the storybook, scans, the riddle door |
| Boss | Always Morwen: **fire** doubles your damage | Castle route Morwen (fire), cave route Umbraxis (light) |
| Length | Designed for roughly a minute of fighting after the briefing (the code says about 15-20 s for the wave and 25 s for the boss; not timed by me) | Much longer; not timed |

**Recommendation.** Use the **demo run for the live slot** and for the main video take. It has a clear start and end, and everything in the demo script except the freeze challenge, the pose seals, the riddle door and the storybook. **Record the riddle door and the storybook clips in `?story=full`** ahead of time, and cut them in. If a judge asks to see more, open a second tab at `?story=full` and say it is the long version.

Both modes have the scan and relics, the wand and the sword, the phone joystick and the camera tracker (slash, jump, wand).

## The setup

One person plays with their body. The webcam watches them, and the laptop runs the game.

- **Left hand: the phone.** Bright lime tape on the front of it. The joystick page is open on its screen; the thumb moves the hero. Swing the phone down like a sword and the hero strikes.
- **Right hand: the wand.** A yellow ball on a grey, black or white stick. Hold it still for a moment, then draw a circle, triangle, square or star in the air; the shape casts its spell. In a one-player game only the **yellow** wand casts (blue is for hero two with `?players=2`; red is unused). Keep other yellow things out of the picture: the largest yellow blob wins.
- **Standing:** 1.5-2 m back from the webcam, so the whole body is in the picture and a jump reads. Keep the whole swing of the phone inside the picture, from about shoulder height to the waist.
- **Laptop:** the backend, the dev server, the game in a full-screen browser at `localhost:5173`, and `python -m tools.publish --window` running in `cv_2/`. The simplest way to start all three is `./scripts/demo.sh` (`.\scripts\demo.ps1` on Windows); see "Demo in one command" in the README. The game's own wand panel, bottom left, shows the camera trail while the tracker is connected.

Facts the script relies on, all checked in the code:

- **Demo run order:** you start a few strides from Willow. Walk up and press **E** for her briefing (four lines, advanced with Space, Enter or E, then a quest card to accept with Enter). Six shadows follow, then Morwen, then a result screen with the time, foes defeated, hearts left and starlight. Before Morwen arrives, Willow tops your hearts back up.
- **Full story order** (`?story=full` only): the wood (a freeze challenge: stay still) -> crossroads vote (castle or cave) -> the pose gate -> the **riddle door** -> the lantern fairy -> the boss -> the storybook.
- **Bosses:** Morwen the Frost Witch is weak to **fire** and resists ice. Umbraxis the Shadow Wyrm (cave route, full story only) is weak to **light** and resists shadow.
- **Wards:** bosses are warded while they wind up an attack. Spells and slashes land after the boss bar says "The ward is down". The bar also shows `weak to <element>`. In the demo run the boss is locked on automatically when she arrives.
- **Two weapons:** the wand casts the drawn shape's spell even before a scan (circle nova, triangle meteor, square wave, star chain; cooldowns 1.6-3 s). A scanned **relic** infuses the wand, the F bolt and the sword with its element, so the boss's x2 / x0.5 applies to slashes too.
- **The game pauses while the scanner is open**, so you can scan in the middle of the wave without being hit.
- **Pose seals** (full story only): besides holding **1 / 2 / 3**, a seal opens when you draw its rune with the wand: triangle for arms up, square for the T-pose, circle for the crouch.
- **Freeze challenge** (full story only): the camera counts the player as moving at about 6% of the picture in motion, so a lean or a wave breaks it. People walking behind the player count too.
- **Keyboard stand-ins:** if the camera fails, **4 5 6 7** draw circle, triangle, square, star; **J** strikes; **Space** jumps. The game plays the same.
- **Sword and wand models in the hero's hands** come with the private art pack. Without it the weapons still work, but nothing is drawn in the hand.
- **Willow's briefing is read aloud** by the browser's speech voice. Mute it with the sound button if the room is loud.

## Part 1. The 2-minute video

Record the clips separately and cut them together; you cannot reach every beat in two minutes of real play. Each take starts from a fresh page (the result screen's button reloads the game), so record Willow's briefing on one load and the scan on another. Screen-record the game full screen and film the player with a second camera so the viewer sees the phone, the wand and the screen cause and effect. Keep the wand panel in frame: it is the proof that the camera drives the game.

| Time | Beat | Mode | On screen | Say (about) |
|---|---|---|---|---|
| 0:00-0:10 | **Hook** | Demo run | Wide shot of the player holding a phone in one hand and a wand in the other. Title screen, then the hero standing in the wood. | "Fairy tales turn ordinary things into magic. In Storybound, your phone is a sword, a stick is a wand, and a mug is a power-up. Don't just read the fairy tale. Become part of it." |
| 0:10-0:22 | **Phone joystick** | Demo run | Press **H**; the URL toast; the phone opens it; toasts "Phone joystick connected" and "Body tracker connected". The thumb drags and the hero walks up the path; push past the ring to sprint. | "One link on my phone and it is the joystick. No app. The camera is also watching me." |
| 0:22-0:34 | **Willow** | Demo run | Walk up to Willow, press **E**. Show two lines of her briefing, then the quest card "The Last Warm Spring" and Enter to accept. | "Willow tells us the Frost Witch has stolen the last warm spring. We have to hold the glade." |
| 0:34-0:52 | **Scan to get a relic** | Demo run | On a fresh load, press **X** before talking to Willow. Hold up a mug of hot tea or coffee to the webcam, press Enter. "Reading your object" spinner, then the relic card with the player's own photo: "Relic: infuses your wand and sword with fire". Press Enter. The wand's crystal and the sword glow in that colour; the weapons row reads `Sword · fire` and `Wand · fire`. | "Reality Rift. I hold up a real mug. Gemini reads it and turns it into a relic. Now my wand and my sword both burn with fire." Name the element it chose. |
| 0:52-1:05 | **Riddle door** | **Full story** clip | At the Chapter III pose gate, draw the runes the gate asks for with the wand (square, triangle, circle on the standard gate) and each seal opens. Then the door with carved eyes: "Show me a book." Press Enter with a real book in view. "The door accepts: it sees a book." | "A seal that opens to a shape I draw. Then a door that has never seen our world asks to see a book. Gemini checks the photo." |
| 1:05-1:15 | **Wand shape cast** | Demo run | The wave arrives. Draw a triangle: a fire meteor falls on the nearest foe. Draw a circle: a nova bursts around the hero. The wand panel flashes "Triangle!" and the weapons row shows `△ meteor`. | "Two weapons. Draw a triangle and it is a meteor. A circle, a nova. The relic decides the element." |
| 1:15-1:22 | **Phone slash** | Demo run | Swing the lime-taped phone down: the hero's sword strikes, with a fire-coloured slash. Optional: a real jump and the hero leaps. | "And the phone is my sword." |
| 1:22-1:40 | **Boss weak to your element** | Demo run | Morwen strides in. The boss bar shows `weak to fire`. Dodge with **Q**, wait for "The ward is down", then a triangle and a slash: "Weak point!" flashes and the damage numbers are doubled. | "The Frost Witch fears fire. Because my relic is fire, she takes double damage from my spells and my sword. What I pick up from my real room decides the fight." |
| 1:40-2:00 | **Storybook** | **Full story** clip | The ending of a full-story run, then the storybook pages. A page tells how the real mug became the relic. Close on the title and the repo URL. (If you have no full-story ending, use the demo run's result screen, "The Last Warm Spring", and skip the storybook line.) | "And the full game writes the ending from what we actually did, down to the mug. Storybound: don't just read the fairy tale. Become part of it." |

Notes for the cut:

- Keep the relic card on screen for at least two seconds so viewers can read the element.
- Do not show the stand-in note ("Gemini was unavailable") in the video; retake the scan.
- **The two full-story clips are the long part of the recording.** Getting from the title to the pose gate and to the ending of the full tale takes real play (not timed). Do it in a rehearsal take, keep the best one, and scan the mug in that run so the storybook can mention it.
- **The storybook page that names the mug** is written by Gemini on request, so it is not guaranteed. The offline script always adds one ("The Reality Rift"). To record with it, start the dev server with `VITE_STORY=scripted npm run dev` (scans still use Gemini) and open `?story=full`. Do not use `?story=scripted` for this: it replaces `full`, and you would get the demo run.
- The camera-to-game link has been tested end to end with synthetic tracker frames, but not much with a live webcam. Do a full take of the wand, slash and jump beats before the real recording, and keep the footage that works.

## Part 2. Live judging script (about 3 minutes in the demo run, then questions)

Have the game open at the plain URL (the demo run), the backend and the tracker running, and the phone connected before the judges arrive. Start at the title screen.

1. **One sentence (15 s).** "Storybound is a 3D fairy tale you play with your real things: a phone for a sword, a stick for a wand, a mug for a power-up. Gemini reads the mug and writes the rest."
2. **Phone (20 s).** Press **H**, open the link on the phone, drive the hero with a thumb. Point at the "Body tracker connected" toast: the camera is on.
3. **Scan, before Willow (45 s).** The hero starts a few strides from Willow, so there is time. Ask the judge for an object, or use your rehearsed mug. **X**, hold it up, Enter. Read the relic card aloud: it infuses the wand and the sword. "The element decides who it is strong against, for spells and slashes alike."
4. **Willow's briefing (25 s).** Walk up, press **E**. Press Space to finish a line and again to move on, then Enter on the quest card.
5. **The wave: wand and sword (40 s).** Six shadows come out of the trees. Draw a triangle (meteor) and a circle (nova) at them, then swing the phone to strike. Point at the weapons row and the wand panel. A real jump makes the hero leap.
6. **Boss (45 s).** Morwen strides in and your hearts are topped up. Show the boss bar's `weak to fire` line. Dodge with **Q**, wait for the ward to fall, cast and slash. Point at the "Weak point!" flash and the doubled damage.
7. **Result and close (15 s).** The result screen shows the time and foes defeated. "If the network dies, the story falls back to a scripted version, and the camera is optional too: the keyboard does the same."

If a judge wants more, say the demo run is the short version and open a second tab at `?story=full`: the freeze challenge reads the camera, the pose seals open to a drawn rune, the riddle door asks for a real object, and the game ends with a storybook of the run. Show the riddle door from the recorded clip if you do not have time to play to it.

If you only have a minute: do steps 1, 3, 5 and 6, and a jump for the crowd.

### Likely questions

- **What does Gemini actually do?** In the full story it writes each story beat and the storybook (text); in both modes it turns a photo into a relic (vision), and in the full story it checks the riddle-door photo (vision). The engine owns the rules, so Gemini cannot invent mechanics. In the short demo run the briefing is fixed text and Gemini only reads the scan.
- **What if Gemini is down or slow?** The story falls back to a hand-written script per beat, a scan returns a stand-in relic, and the door lets you through.
- **How does the wand work?** An OpenCV program finds the yellow ball by colour, names the shape you draw, and sends it to the game through the backend. No machine-learning model to download.
- **How well is it tested?** Backend 44, frontend unit tests 81, 15 browser checks that play the full story, tracker 243. The camera-to-game link is tested with synthetic frames; be honest that live-webcam time is limited.
- **Is it hosted?** No. It runs on a laptop; the README has run steps from a fresh clone.
- **Who built what?** Rishaan: game and art. Trung: backend, Gemini, integration, Reality Rift. haicil: computer vision.

## Pre-demo checklist

Run through this twice: once the night before, once ten minutes before judging.

**Start everything**

- [ ] One-time setup done: `backend/.venv`, `frontend/node_modules`, `cv_2/.venv` (README, "Run everything from a fresh clone").
- [ ] `./scripts/demo.sh` (macOS / Linux) or `.\scripts\demo.ps1` (Windows) starts the backend open to the network, the game and the tracker window, and prints the game URL and the phone URL. Its author tested the macOS script; the Windows script had not been run when the README was written. If it fails, start the three pieces by hand as the README describes.
- [ ] Open the plain URL for the demo run. Keep a second tab at `?story=full` ready only if you plan to show the long version.

**Backend and Gemini**

- [ ] `backend/.env` has your `GEMINI_API_KEY`.
- [ ] The backend is running with `--host 0.0.0.0` (the launcher does this). Without it the phone cannot connect.
- [ ] `curl http://localhost:8000/api/health` says `"gemini": true`.
- [ ] Do one full scan now with the exact object you will use, and note the element you got. A hot drink tends to come back as fire; confirm yours does. If you plan to show the riddle door, do one check of it too, in `?story=full`.

**Network and phone**

- [ ] Turn on the phone's hotspot and join the laptop to it. Venue Wi-Fi often blocks device-to-device traffic.
- [ ] Press **H** in the game, open the URL on the phone, and see "Phone joystick connected". If the address is wrong, use `http://<laptop-ip>:8000/joystick`.
- [ ] The phone's screen will not sleep or lock mid-demo (turn off auto-lock).
- [ ] Lime tape on the front of the phone, in the left hand. Check it is tracked in the tracker window (`--window`); re-run `python -m tools.tune` (key 4) in the room's light if it is not.

**Camera tracker**

- [ ] The tracker's terminal prints when the backend connects and when the game joins ("wand on, any shape"). The game toasts "Body tracker connected".
- [ ] Yellow wand: ball on a neutral stick. Hold it still for a moment, then draw. Draw each of the four shapes once and watch the wand panel flash. Rest the wand between drawings.
- [ ] Stand 1.5-2 m back. Swing the phone from about shoulder height to the waist, inside the picture. Do five slashes and one jump.
- [ ] Nobody walks behind the player (matters for the freeze challenge in `?story=full`).
- [ ] **The tracker and the scanner both want the webcam.** Press **X** while the tracker runs and check the scanner shows a live camera. If it says the camera is busy, either scan before you start the tracker (`./scripts/demo.sh --no-tracker`, scan, then start `tools.publish` yourself), or use **Choose a photo** with a photo of your object saved on the desktop.

**Game**

- [ ] Open the game at `http://localhost:5173` (not the network address, or the browser will refuse the webcam).
- [ ] Art pack installed: the folder `frontend/public/models/assetyard/` exists. Without it the characters are plain stand-ins and the sword and wand are not drawn in the hands.
- [ ] Browser: allow the camera for `localhost` on the first scan. Do this before judges arrive.
- [ ] Sound and spoken narration: use the sound button to match the room. Willow's briefing is read aloud. Check the volume.
- [ ] `cd frontend && npm test` and `npm run build` pass. Optionally run the 15 browser checks at `/tests/adventure.html?story=scripted` (they play the full story).

**If something fails**

- **Gemini slow or down:** the demo run does not need Gemini except for the scan. A scan waits up to 25 s before offering Try again; use **Choose a photo** with a saved photo, or press Escape and play on without a relic. For `?story=full`, set `OFFLINE=1` in `backend/.env` and restart the backend, or run the dev server with `VITE_STORY=scripted`. (`?story=scripted` will not do it: it replaces `full` and gives the demo run.)
- **Stand-in relic:** it is random between **Moonlit Orb (light)** and **Frostbound Blade (ice)**. Morwen is weak to fire, so in the demo run neither stand-in doubles your damage (light is normal, ice is **half** damage). If the scan falls back, press **X** and scan again; if Gemini is down, skip the "Weak point!" beat or use the recorded clip. In `?story=full` you can still show it: take the **cave route**, where light doubles damage against the Shadow Wyrm and ice is normal damage. The armory keeps earlier relics, so you can re-equip a good one without a new scan.
- **Camera tracker flaky or dead:** stop the tracker and play on the keyboard: **4 5 6 7** for the shapes, **J** to strike, **Space** to jump, **1 / 2 / 3** for the pose seals. Say so plainly.
- **Phone will not connect:** WASD works the same. Check the backend was started with `--host 0.0.0.0` and the phone is on the same hotspot.
- **Riddle door** (`?story=full`): **Skip** opens it anyway with no heart lost. With no Gemini key the door accepts any photo.
- **Last resort:** a recorded run of the video on the desktop.
