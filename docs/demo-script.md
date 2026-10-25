# Demo script: 2-minute video and live judging

Two things here: a shot list for the 2-minute Devpost video, and a script for showing the game live to judges. Both follow the same nine beats. Lines marked `TODO(after merge)` depend on work that is not on `main` yet; each has a version that is true today.

Facts the script relies on (all checked in the code):

- The story runs: wood (freeze challenge) -> crossroads vote (castle or cave) -> pose gate -> **riddle door** -> lantern fairy -> boss -> storybook.
- The castle route ends with **Morwen the Frost Witch** (weak to **fire**, resists ice). The cave route ends with **Umbraxis the Shadow Wyrm** (weak to **light**, resists shadow).
- Bosses are warded while they wind up an attack. Spells land only after the boss bar says "The ward is down". The bar also shows `weak to <element>`.
- You can press **X** to scan at any time before the boss, and scan again to replace the weapon.

## Part 1. The 2-minute video

Record the clips separately and cut them together; you cannot reach every beat in two minutes of real play. Use the castle route and rehearse the scan object first (see the checklist). Screen-record the game full screen; film the phone and your hands with a second camera or a phone propped on a stand.

| Time | Beat | On screen | Say (about) |
|---|---|---|---|
| 0:00-0:10 | **Hook** | Title screen, then the hero walking into the wood. | "Fairy tales turn ordinary things into magic. Storybound does it with *your* things. Don't just read the fairy tale. Become part of it." |
| 0:10-0:25 | **Phone joystick** | Press **H**; the URL toast; cut to a hand opening it on a phone; thumb drags, hero runs, push past the ring to sprint. Toast: "Phone joystick connected". | "No controller? Open one link on your phone and it is the joystick." |
| 0:25-0:35 | **Willow** | Walk up to Willow in the Whispering Wood, press **E**, her lines appear. | "Willow guides us. The story around her is written live by Gemini from what we do." |
| 0:35-0:55 | **Scan to get a weapon** | Press **X**. Hold up a mug of hot tea or coffee to the webcam, press Enter. "Reading your object" spinner, then the weapon card (name, element, rarity). Press Enter to take it. Cast with **F**: coloured bolts. | "Reality Rift. I hold up a real mug. Gemini looks at it and forges a weapon from it: a name, an element, a spell." Then name the element it chose. |
| 0:55-1:10 | **Riddle door** | The door with carved eyes: "Show me a book." Press Enter on the scanner with a real book in view. "The door accepts: it sees a book." Walk through. | "A door that has never seen our world asks to see a book. Gemini checks the photo. Show it the wrong thing and it tells you what it saw instead." |
| 1:10-1:20 | **Wand shape cast** | Split screen: the `cv_2` window, a person drawing a star with a coloured wand, the label turns to "star", then "OK". Today this is the tracker's own window. `TODO(after merge)`: if wand shapes cast spells in the game by then, cut to the spell firing in the game. | "A separate computer-vision tracker watches coloured wands and names the shape you draw: circle, triangle, square or star." |
| 1:20-1:28 | **Phone slash** | Cut to the game (`python -m tools.publish --window` running in `cv_2/`): swing the lime-taped phone down, the hero's sword strikes. If the camera misses the swing on the day, use the tracker window's **SLASHED!** shot instead. | "Swing a phone like a sword and the camera sees the slash." |
| 1:28-1:45 | **Boss weak to your element** | The Frost Witch. The boss bar shows "weak to fire". Dodge with **Q**, wait for "The ward is down", cast **F**: "Weak point!" flashes and the damage numbers are doubled. | "The Frost Witch fears fire. Because our weapon is fire, she takes double damage. What you pick up from your real room decides the fight." |
| 1:45-2:00 | **Storybook** | Victory, then the storybook pages naming the choices and the mug: a page tells how the real mug became the weapon. `TODO(after merge)`: true once feature/rift-next is on `main`. Close on the title and the repo URL. | "And the game writes the ending from what we actually did. Storybound: don't just read the fairy tale. Become part of it." |

Notes for the cut:

- Keep the scan result card on screen for at least two seconds so viewers can read the element.
- Do not show the stand-in weapon note ("Gemini was unavailable") in the video; retake the scan.
- If the CV bridge has not merged, say "tracked by a separate computer-vision program" and do not say the wand casts spells in the game.

## Part 2. Live judging script (3-4 minutes, then questions)

Have the game open, the backend running, and the phone connected before the judges arrive. Start already at the title screen.

1. **One sentence (15 s).** "Storybound is a 3D fairy tale where Gemini writes the story from what you do, and your real objects become the magic."
2. **Phone (20 s).** Hand the judge the phone, or show it: press **H**, open the link, drive the hero with a thumb. "This is the backend relaying a WebSocket; nothing to install."
3. **Willow and the first challenge (30 s).** Talk to Willow (**E**). Walk to the golden beacon, press **E**. The freeze challenge starts: "stay perfectly still". Let the judge try not to move.
4. **Scan (45 s).** Ask the judge for an object, or use your rehearsed mug. **X**, hold it up, Enter. Read the weapon card aloud. Cast it. "The element decides who it is strong against."
5. **Riddle door (30 s).** The door only appears after you pass the Chapter III pose gate (hold 1, 2, 3 for the requested poses), so reach it by playing on, or in a short slot say "the next door asks you to show it a real object" and play the video clip. Show the door the requested object. Mention Skip.
6. **Boss (45 s).** Show the boss bar's "weak to" line. Dodge, wait for the ward to fall, cast. Point at the "Weak point!" flash and the doubled damage.
7. **CV (30 s).** Start `python -m tools.publish --window` in `cv_2/` before judging. Show the tracker window with the wands drawing shapes (shapes stay in that window for now), then swing the lime-taped phone: the hero's sword strikes in the game. A real jump makes the hero jump.
8. **Storybook (20 s).** Finish the boss and scroll the storybook. "It writes this from what happened in your run."
9. **Close (10 s).** "If the network dies, everything falls back to a scripted version, so the game never stops."

If you only have a minute: do steps 1, 4 and 6, and show the phone for five seconds.

### Likely questions

- **What does Gemini actually do?** Writes each story beat and the storybook (text), turns a photo into a weapon (vision), and checks the riddle-door photo (vision). The engine owns the rules, so Gemini cannot invent mechanics.
- **What if Gemini is down or slow?** The story falls back to a hand-written script per beat, a scan returns a stand-in weapon, and the door lets you through.
- **Is the CV tracker in the game?** Be honest about the current state (see step 7).
- **Is it hosted?** No. It runs on a laptop; the README has run steps from a fresh clone.
- **Who built what?** Rishaan: game and art. Trung: backend, Gemini, integration, Reality Rift. haicil: computer vision.

## Pre-demo checklist

Run through this twice: once the night before, once ten minutes before judging.

**Backend and Gemini**

- [ ] `backend/.env` has your `GEMINI_API_KEY`.
- [ ] Backend is running as `uvicorn app.main:app --host 0.0.0.0 --port 8000`. Without `--host 0.0.0.0` the phone cannot connect.
- [ ] `curl http://localhost:8000/api/health` says `"gemini": true`.
- [ ] Do one full scan and one riddle-door check now, with the exact objects you will use, and note the element you got.

**Network and phone**

- [ ] Turn on the phone's hotspot and join the laptop to it. Venue Wi-Fi often blocks device-to-device traffic.
- [ ] Press **H** in the game, open the URL on the phone, and see "Phone joystick connected". If the address is wrong, use `http://<laptop-ip>:8000/joystick`.
- [ ] The phone's screen will not sleep or lock mid-demo (turn off auto-lock).

**Game**

- [ ] Open the game at `http://localhost:5173` (not the network address, or the browser will refuse the webcam).
- [ ] Art pack installed: the folder `frontend/public/models/assetyard/` exists. Without it the game runs with plain stand-in characters.
- [ ] Browser: allow the camera for `localhost` on the first scan. Do this before judges arrive.
- [ ] Close anything else using the webcam (video calls, the `cv_2` demo). Check this works on your OS before judging.
- [ ] Sound and spoken narration: use the sound button to match the room. Check the volume.
- [ ] `cd frontend && npm test` and `npm run build` pass. Optionally run the 13 browser checks at `/tests/adventure.html?story=scripted`.

**cv_2 (if you show it)**

- [ ] `python -m tools.demo` opens the camera view. Run `python -m tools.tune` in the room's light and paste the values it prints.
- [ ] Wands: yellow, blue and red balls on grey/black/white sticks. Phone: bright lime tape on the front, held in the left hand. Keep the whole swing in the picture.

**If Gemini is slow or down**

- Add `?story=scripted` to the game URL, or set `OFFLINE=1` in `backend/.env` and restart the backend. The whole run still plays.
- A scan waits up to 25 s before it gives up and offers Try again. Use **Choose a photo** with a photo of your object saved on the desktop to avoid camera trouble.
- The stand-in weapon is random: **Moonlit Orb (light)** or **Frostbound Blade (ice)**. On the castle route, ice is the Frost Witch's *resisted* element and does half damage. **Take the cave route** when Gemini is unreliable: light is double damage against the Shadow Wyrm and ice is normal damage. If you get a bad weapon, press **X** and scan again.
- At the riddle door, **Skip** opens it anyway with no heart lost. With no Gemini key, the door accepts any photo.
- Keep a recorded run of the video on the desktop as the last resort.
