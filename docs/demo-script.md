# Demo script: 2-minute video and live judging

Two things here: a shot list for the 2-minute Devpost video, and a script for showing the game live to judges. Both follow the same beats and the same setup.

## The setup

One person plays with their body. The webcam watches them, and the laptop runs the game.

- **Left hand: the phone.** Bright lime tape on the front of it. The joystick page is open on its screen; the thumb moves the hero. Swing the phone down like a sword and the hero strikes.
- **Right hand: the wand.** A yellow ball on a grey, black or white stick. Hold it still for a moment, then draw a circle, triangle, square or star in the air; the shape casts its spell. In a one-player game only the **yellow** wand casts (blue is for hero two with `?players=2`; red is unused). Keep other yellow things out of the picture: the largest yellow blob wins.
- **Standing:** 1.5-2 m back from the webcam, so the whole body is in the picture and a jump reads. Keep the whole swing of the phone inside the picture, from about shoulder height to the waist.
- **Laptop:** the backend, the dev server, the game in a full-screen browser at `localhost:5173`, and `python -m tools.publish --window` running in `cv_2/` (the tracker's view stays on a second screen or a hidden window; the game's own wand panel, bottom left, shows the camera trail).

Facts the script relies on, all checked in the code:

- **Story order:** the wood (a freeze challenge: stay still) -> crossroads vote (castle or cave) -> the pose gate -> the **riddle door** -> the lantern fairy -> the boss -> the storybook.
- **Bosses:** the castle route ends with **Morwen the Frost Witch** (weak to **fire**, resists ice). The cave route ends with **Umbraxis the Shadow Wyrm** (weak to **light**, resists shadow).
- **Wards:** bosses are warded while they wind up an attack. Spells and slashes land after the boss bar says "The ward is down". The bar also shows `weak to <element>`.
- **Two weapons:** the wand casts the drawn shape's spell even before a scan (circle nova, triangle meteor, square wave, star chain; cooldowns 1.6-3 s). A scanned **relic** infuses the wand, the F bolt and the sword with its element, so the boss's x2 / x0.5 applies to slashes too.
- **Pose seals:** besides holding **1 / 2 / 3**, a seal opens when you draw its rune with the wand: triangle for arms up, square for the T-pose, circle for the crouch.
- **Freeze challenge:** the camera counts the player as moving at about 6% of the picture in motion, so a lean or a wave breaks it. People walking behind the player count too.
- **Keyboard stand-ins:** if the camera fails, **4 5 6 7** draw circle, triangle, square, star; **J** strikes; **Space** jumps. The game plays the same.
- **Sword and wand models in the hero's hands** come with the private art pack. Without it the weapons still work, but nothing is drawn in the hand.

## Part 1. The 2-minute video

Record the clips separately and cut them together; you cannot reach every beat in two minutes of real play. Use the castle route and a fire object (see the checklist). Screen-record the game full screen and film the player with a second camera so the viewer sees the phone, the wand and the screen cause and effect. Keep the wand panel in frame: it is the proof that the camera drives the game.

| Time | Beat | On screen | Say (about) |
|---|---|---|---|
| 0:00-0:10 | **Hook** | Wide shot of the player holding a phone in one hand and a wand in the other. Title screen, then the hero walking into the wood. | "Fairy tales turn ordinary things into magic. In Storybound, your phone is a sword, a stick is a wand, and a mug is a power-up. Don't just read the fairy tale. Become part of it." |
| 0:10-0:25 | **Phone joystick** | Press **H**; the URL toast; the phone opens it; toasts "Phone joystick connected" and "Body tracker connected". The thumb drags and the hero runs; push past the ring to sprint. | "One link on my phone and it is the joystick. No app. The camera is also watching me." |
| 0:25-0:35 | **Willow** | Walk up to Willow in the Whispering Wood, press **E**, her lines appear. | "Willow guides us. The story around her is written live by Gemini from what we do." |
| 0:35-0:55 | **Scan to get a relic** | Press **X**. Hold up a mug of hot tea or coffee to the webcam, press Enter. "Reading your object" spinner, then the relic card with the player's own photo: "Relic: infuses your wand and sword with fire". Press Enter. The wand's crystal and the sword glow in that colour; the weapons row reads `Sword · fire` and `Wand · fire`. | "Reality Rift. I hold up a real mug. Gemini reads it and turns it into a relic. Now my wand and my sword both burn with fire." Name the element it chose. |
| 0:55-1:10 | **Riddle door** | At the Chapter III pose gate, draw the runes the gate asks for with the wand (square, triangle, circle on the standard gate) and each seal opens. Then the door with carved eyes: "Show me a book." Press Enter with a real book in view. "The door accepts: it sees a book." | "A seal that opens to a shape I draw. Then a door that has never seen our world asks to see a book. Gemini checks the photo." |
| 1:10-1:20 | **Wand shape cast** | Close-up of the player and the screen. Draw a triangle: a fire meteor falls on the nearest foe. Draw a circle: a nova bursts around the hero. The wand panel flashes "Triangle!" and the weapons row shows `△ meteor`. | "Two weapons. Draw a triangle and it is a meteor. A circle, a nova. The relic decides the element." |
| 1:20-1:28 | **Phone slash** | Swing the lime-taped phone down: the hero's sword strikes, with a fire-coloured slash. Optional: a real jump and the hero leaps. | "And the phone is my sword." |
| 1:28-1:45 | **Boss weak to your element** | The Frost Witch. The boss bar shows `weak to fire`. Dodge with **Q**, wait for "The ward is down", then a triangle and a slash: "Weak point!" flashes and the damage numbers are doubled. | "The Frost Witch fears fire. Because my relic is fire, she takes double damage from my spells and my sword. What I pick up from my real room decides the fight." |
| 1:45-2:00 | **Storybook** | Victory, then the storybook pages. A page tells how the real mug became the relic. Close on the title and the repo URL. | "And the game writes the ending from what we actually did, down to the mug. Storybound: don't just read the fairy tale. Become part of it." |

Notes for the cut:

- Keep the relic card on screen for at least two seconds so viewers can read the element.
- Do not show the stand-in note ("Gemini was unavailable") in the video; retake the scan.
- **The storybook page that names the mug** is written by Gemini on request, so it is not guaranteed. The offline script always adds one ("The Reality Rift"). If a live take misses it, record that beat with `?story=scripted`.
- The camera-to-game link has been tested end to end with synthetic tracker frames, but not much with a live webcam. Do a full take of the wand, slash and jump beats before the real recording, and keep the footage that works.

## Part 2. Live judging script (3-4 minutes, then questions)

Have the game open, the backend running, the tracker running, and the phone connected before the judges arrive. Start at the title screen.

1. **One sentence (15 s).** "Storybound is a 3D fairy tale where Gemini writes the story from what you do, and you play it with your real things: a phone, a wand, a mug."
2. **Phone (20 s).** Press **H**, open the link on the phone, drive the hero with a thumb. Point at the "Body tracker connected" toast: the camera is on.
3. **Willow and the first challenge (30 s).** Talk to Willow (**E**). Follow the golden beacons with **E**: the first is the intro, the next is the freeze challenge, "stay perfectly still". The camera sees you: let a judge try not to move.
4. **Scan (45 s).** Ask the judge for an object, or use your rehearsed mug. **X**, hold it up, Enter. Read the relic card aloud: it infuses the wand and the sword. "The element decides who it is strong against, for spells and slashes alike."
5. **Wand and sword (30 s).** Draw a triangle (meteor) and a circle (nova) at a foe, then swing the phone to strike. Point at the weapons row and the wand panel.
6. **Riddle door (30 s).** The door only appears after you pass the Chapter III pose gate: hold **1 / 2 / 3** or draw the runes (triangle, square, circle). Reach it by playing on, or say "the next door asks you to show it a real object" and play the video clip. Show the door the requested object. Mention Skip.
7. **Boss (45 s).** Show the boss bar's `weak to` line. Dodge, wait for the ward to fall, cast and slash. Point at the "Weak point!" flash and the doubled damage.
8. **Storybook (20 s).** Finish the boss and scroll the storybook. "It writes this from what happened in your run, including your object."
9. **Close (10 s).** "If the network dies, everything falls back to a scripted version, so the game never stops. The camera is optional too: the keyboard does the same."

If you only have a minute: do steps 1, 4, 5 and 7, and a jump for the crowd.

### Likely questions

- **What does Gemini actually do?** Writes each story beat and the storybook (text), turns a photo into a relic (vision), and checks the riddle-door photo (vision). The engine owns the rules, so Gemini cannot invent mechanics.
- **What if Gemini is down or slow?** The story falls back to a hand-written script per beat, a scan returns a stand-in relic, and the door lets you through.
- **How does the wand work?** An OpenCV program finds the yellow ball by colour, names the shape you draw, and sends it to the game through the backend. No machine-learning model to download.
- **How well is it tested?** Backend 44, frontend unit tests 81, 15 browser checks that play the game, tracker 243. The camera-to-game link is tested with synthetic frames; be honest that live-webcam time is limited.
- **Is it hosted?** No. It runs on a laptop; the README has run steps from a fresh clone.
- **Who built what?** Rishaan: game and art. Trung: backend, Gemini, integration, Reality Rift. haicil: computer vision.

## Pre-demo checklist

Run through this twice: once the night before, once ten minutes before judging.

**Backend and Gemini**

- [ ] `backend/.env` has your `GEMINI_API_KEY`.
- [ ] Backend is running as `uvicorn app.main:app --host 0.0.0.0 --port 8000`. Without `--host 0.0.0.0` the phone cannot connect.
- [ ] `curl http://localhost:8000/api/health` says `"gemini": true`.
- [ ] Do one full scan and one riddle-door check now, with the exact objects you will use, and note the element you got. A hot drink tends to come back as fire; confirm yours does.

**Network and phone**

- [ ] Turn on the phone's hotspot and join the laptop to it. Venue Wi-Fi often blocks device-to-device traffic.
- [ ] Press **H** in the game, open the URL on the phone, and see "Phone joystick connected". If the address is wrong, use `http://<laptop-ip>:8000/joystick`.
- [ ] The phone's screen will not sleep or lock mid-demo (turn off auto-lock).
- [ ] Lime tape on the front of the phone, in the left hand. Check it is tracked in the tracker window (`--window`); re-run `python -m tools.tune` (key 4) in the room's light if it is not.

**Camera tracker**

- [ ] Reinstall the `cv_2` requirements once (the link needs `websockets`): the `uv pip install` line in the README, step 5.
- [ ] `python -m tools.publish --window` in `cv_2/`, started after the backend. The terminal prints when the backend connects and when the game joins ("wand on, any shape").
- [ ] Yellow wand: ball on a neutral stick. Hold it still for a moment, then draw. Draw each of the four shapes once and watch the wand panel flash. Rest the wand between drawings.
- [ ] Stand 1.5-2 m back. Swing the phone from about shoulder height to the waist, inside the picture. Do five slashes and one jump.
- [ ] Nobody walks behind the player during the freeze challenge.
- [ ] **The tracker and the scanner both want the webcam.** Press **X** while the tracker runs and check the scanner shows a live camera. If it says the camera is busy, either scan before you start `tools.publish`, or use **Choose a photo** with a photo of your object saved on the desktop.

**Game**

- [ ] Open the game at `http://localhost:5173` (not the network address, or the browser will refuse the webcam).
- [ ] Art pack installed: the folder `frontend/public/models/assetyard/` exists. Without it the characters are plain stand-ins and the sword and wand are not drawn in the hands.
- [ ] Browser: allow the camera for `localhost` on the first scan. Do this before judges arrive.
- [ ] Sound and spoken narration: use the sound button to match the room. Check the volume.
- [ ] `cd frontend && npm test` and `npm run build` pass. Optionally run the 15 browser checks at `/tests/adventure.html?story=scripted`.

**If something fails**

- **Gemini slow or down:** add `?story=scripted` to the game URL, or set `OFFLINE=1` in `backend/.env` and restart the backend. The whole run still plays. A scan waits up to 25 s before offering Try again; use **Choose a photo** with a saved photo to avoid camera trouble.
- **Stand-in relic:** it is random between **Moonlit Orb (light)** and **Frostbound Blade (ice)**. On the castle route, ice is the Frost Witch's *resisted* element and does half damage. **Take the cave route** when Gemini is unreliable: light is double damage against the Shadow Wyrm and ice is normal damage. If you get a bad relic, press **X** and scan again (the armory also keeps earlier ones).
- **Camera tracker flaky or dead:** stop `tools.publish` and play on the keyboard: **4 5 6 7** for the shapes, **J** to strike, **Space** to jump, **1 / 2 / 3** for the pose seals. Say so plainly.
- **Phone will not connect:** WASD works the same. Check the backend was started with `--host 0.0.0.0` and the phone is on the same hotspot.
- **Riddle door:** **Skip** opens it anyway with no heart lost. With no Gemini key the door accepts any photo.
- **Last resort:** a recorded run of the video on the desktop.
