import * as T from 'three';
import { Adventure } from '../src/adventure/Adventure';
import { WAND_RECOVERY } from '../src/adventure/forge';
import { objectiveFor } from '../src/adventure/terrain';
import type { BeatOutcome, StoryBeat } from '../src/contracts';
import type { GameState } from '../src/game/GameState';

// Development-only harness. It exercises real renderer, inputs and game routines;
// no test globals or control hooks are added to the production application.
// These checks cover both heroes (companion, player two), so run the two-player mode.
(window as unknown as { RIFT_PLAYERS: number }).RIFT_PLAYERS = 2;
// They walk the full storyteller-driven tale, not the short demo run the game opens with by default.
(window as unknown as { RIFT_FULL_STORY: boolean }).RIFT_FULL_STORY = true;

interface Internals {
  state: GameState; beat: StoryBeat; busy: boolean; ended: boolean; yaw: number; stamina: number; time: number;
  trial?: { elapsed: number }; target?: { x: number; z: number }; invulnerable: number;
  enemies: { root: T.Group; hp: number; windup: number; cooldown: number; encounter: boolean; boss?: unknown; attack: string }[];
  narrator: { enabled: boolean }; sound: boolean;
  companionUntil: number;
  spellCooldown: number[];
  loadBeat(work: Promise<StoryBeat>): Promise<void>;
  interact(): Promise<void>; update(dt: number): void; cast(player: 0 | 1): void;
  updateBolts(dt: number): void;
  closestEnemy(p: T.Vector3, radius: number): unknown;
}
const status = document.querySelector('#status')!, results = document.querySelector('#results')!;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function key(code: string, down = true): void { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); }
async function until(predicate: () => boolean, message: string): Promise<void> {
  const limit = performance.now() + 7000;
  while (!predicate()) { if (performance.now() > limit) throw new Error(message); await wait(20); }
}
let running = false;
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  if (running) return; running = true; results.replaceChildren();
  const game = new Adventure(), inner = game as unknown as Internals;
  const check = async (name: string, task: () => Promise<void>) => {
    status.textContent = name; const row = document.createElement('li'); results.append(row);
    try { await task(); row.textContent = `PASS · ${name}`; row.style.color = '#bdedc4'; }
    catch (error) { row.textContent = `FAIL · ${name}: ${String(error)}`; row.style.color = '#ffc0b2'; throw error; }
  };
  const near = (x: number, z: number) => { game.heroes.forEach((hero, i) => hero.root.position.set(x + i * 1.2, 0, z + i)); };
  const clearDialogue = async () => { while (game.ui.speaking) { game.ui.advance(); await wait(10); } };
  // Hold for game time, not wall time, so a throttled background page still gets enough frames.
  const holdFor = async (seconds: number) => { const from = inner.time; await until(() => inner.time - from > seconds, 'game clock stalled'); };
  const beginBeat = async (beat: StoryBeat) => {
    await inner.loadBeat(Promise.resolve(beat)); const at = objectiveFor(beat); near(at.x, at.z);
    const work = inner.interact(); await until(() => game.ui.speaking, 'dialogue missing'); await clearDialogue(); return work;
  };
  try {
    const start = game.start();
    await until(() => !!document.querySelector('.adventure-start form'), 'models did not finish loading');
    document.querySelector<HTMLFormElement>('.adventure-start form')!.requestSubmit(); await start;
    inner.narrator.enabled = false; inner.sound = false;
    await check('Keyboard movement changes world position; camera follows', async () => {
      const before = game.heroes[0].root.position.clone(); key('KeyW'); await holdFor(0.22); key('KeyW', false);
      assert(game.heroes[0].root.position.distanceTo(before) > 0.4, 'hero did not walk');
      assert(game.camera.position.distanceTo(game.heroes[0].root.position) < 20, 'camera lost the hero');
    });
    await check('Sprint spends stamina, camera can orbit, player two moves independently', async () => {
      key('ShiftLeft'); key('KeyW'); await holdFor(0.16); key('KeyW', false); key('ShiftLeft', false); assert(inner.stamina < 1, 'sprint did not use stamina');
      const yaw = inner.yaw; key('KeyC'); await holdFor(0.12); key('KeyC', false); assert(inner.yaw !== yaw, 'camera did not orbit');
      const p = game.heroes[1].root.position.clone(); key('ArrowRight'); await holdFor(0.15); key('ArrowRight', false); assert(game.heroes[1].root.position.distanceTo(p) > 0.3, 'second hero did not move');
    });
    await check('Treasure can be claimed once and full health preserves healing springs', async () => {
      const chest = game.world.objects.find((o) => o.kind === 'chest')!; near(chest.x, chest.z); inner.update(0.02);
      await inner.interact(); const stars = [...inner.state.stars]; await inner.interact(); assert(inner.state.stars[0] === stars[0] && chest.used, 'duplicate treasure claim');
      const spring = game.world.objects.find((o) => o.kind === 'shrine')!; near(spring.x, spring.z); inner.update(0.02); await inner.interact(); assert(!spring.used, 'full health consumed the spring');
      inner.state.loseHeart(); await inner.interact(); assert(Number(inner.state.hearts) === 3 && Boolean(spring.used), 'spring did not heal');
    });
    await check('Story objectives open dialogue and advance the existing StoryProvider', async () => {
      const at = objectiveFor(inner.beat); near(at.x, at.z); const work = inner.interact(); await until(() => game.ui.speaking, 'intro missing'); await clearDialogue(); await work;
      assert(inner.beat.id === 'frost-spell', 'intro did not advance to freeze');
      assert(inner.state.outcomes.at(-1)?.perPlayer[0].stars === 0, 'story beat incorrectly reports stars');
    });
    await check('Freeze responds to actual movement and records a successful stillness challenge', async () => {
      const work = beginBeat(inner.beat); await until(() => !!inner.trial, 'freeze trial missing');
      inner.companionUntil = 0; game.heroes[1].root.position.x += 8;
      for (let i = 0; i < 55 && inner.trial; i++) inner.update(0.1);
      await work; await until(() => inner.beat.id === 'spirit-gift', 'freeze did not advance');
      assert(inner.state.outcomes.at(-1)?.kind === 'freeze' && inner.state.outcomes.at(-1)?.success, 'freeze outcome wrong');
    });
    await check('Choice UI records the selected route without changing the contract', async () => {
      const vote: StoryBeat = { id: 'crossroads', chapter: 'Check', environment: 'forest', narration: ['Choose your path.'], challenge: { type: 'vote', prompt: 'Which path?', options: [{ id: 'castle', label: 'Castle route' }, { id: 'cave', label: 'Cave route' }], timeLimitSec: 10 } };
      const work = beginBeat(vote); await until(() => game.ui.modal.open, 'choice dialog missing');
      key('KeyM'); key('KeyM', false); assert(game.ui.modal.open, 'journal shortcut dismissed a required choice');
      const button = [...game.ui.modal.querySelectorAll('button')].find((b) => b.textContent === 'Cave route')!; button.click(); await work;
      assert(inner.beat.id === 'gate' && inner.beat.environment === 'cave', 'choice did not reach cave gate');
      assert(inner.state.outcomes.at(-1)?.choiceId === 'cave', 'choice id missing from history');
    });
    await check('Pose seals require the requested inputs before opening', async () => {
      const gate = { ...inner.beat, challenge: { type: 'pose' as const, prompt: 'Copy the rune', poses: ['t-pose', 'arms-up', 'crouch'] as ('t-pose' | 'arms-up' | 'crouch')[], secondsPerPose: 4 } };
      const work = beginBeat(gate); await until(() => !!inner.trial, 'pose trial missing');
      for (const [one, two] of [['Digit2', 'KeyO'], ['Digit1', 'KeyI'], ['Digit3', 'KeyP']]) {
        key(one); key(two); for (let i = 0; i < 14; i++) inner.update(0.1); key(one, false); key(two, false);
      }
      await work; await until(() => inner.beat.id === 'show-me', 'pose sequence did not open the riddle door');
      assert(inner.state.outcomes.at(-1)?.success, 'pose success missing');
    });
    await check('Scanner shows the Scan button once the camera starts, and closing always releases the camera', async () => {
      const scanner = (game as unknown as { scanner: { open: boolean; show(): Promise<void>; close(): void } }).scanner;
      const media = navigator.mediaDevices, real = media.getUserMedia;
      const feed = document.createElement('canvas'); feed.width = 64; feed.height = 48; feed.getContext('2d')!.fillRect(0, 0, 64, 48);
      const streams: MediaStream[] = [], opened = () => streams.length, ended = (s: MediaStream) => s.getTracks().every((t) => t.readyState === 'ended');
      const labels = () => [...document.querySelectorAll('.rift-panel button')].map((b) => b.textContent ?? '');
      media.getUserMedia = async () => { const s = feed.captureStream(5); streams.push(s); return s; };
      try {
        void scanner.show();
        await until(() => labels().some((l) => l.startsWith('Scan the object')), `camera started but there was no Scan button (saw: ${labels().join(', ')})`);
        scanner.close(); assert(opened() === 1 && ended(streams[0]), 'closing left the camera on');
        // Closed while the browser is still asking for the camera: the late stream must be stopped, not kept.
        let grant!: () => void; const asking = new Promise<void>((resolve) => { grant = resolve; });
        media.getUserMedia = async () => { await asking; const s = feed.captureStream(5); streams.push(s); return s; };
        const pending = scanner.show(); scanner.close(); grant(); await pending;
        assert(opened() === 2 && ended(streams[1]), 'a camera granted after closing stayed on');
      } finally { media.getUserMedia = real; scanner.close(); }
    });
    await check('Tracker camera: its picture fills the wand panel, and the scanner scans from it without opening the webcam', async () => {
      // A fake tracker speaks to CvInput as the relay would (no backend needed): one program owns the webcam.
      const cv = (game as unknown as { cv: { handle(m: unknown): void; snapshot(): Promise<unknown> } }).cv;
      const hud = (game as unknown as { wandHud: { draw(now: number): void; canvas: HTMLCanvasElement } }).wandHud;
      const scanner = (game as unknown as { scanner: { show(): Promise<void>; close(): void } }).scanner;
      const paint = document.createElement('canvas'); paint.width = 64; paint.height = 48;
      const pen = paint.getContext('2d')!; pen.fillStyle = '#e02020'; pen.fillRect(0, 0, 64, 48);
      const jpeg = paint.toDataURL('image/jpeg', 0.9).split(',')[1];
      const wand = { active: true, secondsLeft: 0, target: null, next: null, shapes: { yellow: null }, complete: { yellow: false }, traces: { yellow: [[[0.2, 0.2], [0.4, 0.3]]] } };
      const media = navigator.mediaDevices, realCamera = media.getUserMedia, realFetch = window.fetch, realSnapshot = cv.snapshot;
      const labels = () => [...document.querySelectorAll('.rift-panel button')].map((b) => b.textContent ?? '');
      let cameraAsks = 0, sent = '';
      media.getUserMedia = async () => { cameraAsks++; throw new Error('the scanner opened the webcam while the tracker owns it'); };
      window.fetch = async (_url, init) => { sent = String(init?.body ?? ''); return new Response('{}', { status: 503 }); };
      cv.snapshot = async () => ({ jpeg, w: 64, h: 48 });
      const feed = () => { cv.handle({ type: 'cv', slash: 0, jump: 0, motion: 0, phone: { x: 0.7, y: 0.5, radius: 0.05 }, wand }); cv.handle({ type: 'frame', w: 64, h: 48, jpeg }); };
      try {
        cv.handle({ type: 'peer', role: 'tracker', state: 'joined' }); feed();
        // Drawn directly (not on an animation frame) so this also passes with the pane hidden.
        await until(() => { feed(); hud.draw(performance.now() / 1000); const [r, g] = hud.canvas.getContext('2d')!.getImageData(hud.canvas.width / 2, hud.canvas.height * 0.8, 1, 1).data; return r > 120 && g < 90; }, 'the tracker picture never appeared in the wand panel');
        void scanner.show(); feed();
        await until(() => labels().some((l) => l.startsWith('Scan the object')), `no Scan button with the tracker's picture (saw: ${labels().join(', ')})`);
        assert(document.querySelector<HTMLImageElement>('.rift-scan img.rift-video')!.src.startsWith('data:image/jpeg'), 'the scan screen does not show the tracker picture');
        [...document.querySelectorAll<HTMLButtonElement>('.rift-panel button')].find((b) => (b.textContent ?? '').startsWith('Scan the object'))!.click();
        await until(() => sent.includes('"imageBase64":"/9j/'), 'the scan did not send the tracker snapshot');
        assert(cameraAsks === 0, 'the scanner asked for the webcam while the tracker owns it');
      } finally {
        media.getUserMedia = realCamera; window.fetch = realFetch; cv.snapshot = realSnapshot; scanner.close();
        cv.handle({ type: 'peer', role: 'tracker', state: 'left' });
      }
    });
    await check('Show-me door: a wrong photo is refused with what Gemini saw, a right one opens it, and Skip fails without losing a heart', async () => {
      const scanner = (game as unknown as { scanner: { open: boolean; captureFromFile(f: File): Promise<void> } }).scanner;
      const phase = () => document.querySelector<HTMLElement>('.rift-scan')!.dataset.phase, panel = () => document.querySelector('.rift-panel')!.textContent ?? '';
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const photo = new File([await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))], 'object.png', { type: 'image/png' });
      const answers = [{ match: false, seen: 'a coffee mug', source: 'gemini' }, { match: true, seen: 'a book', source: 'gemini' }]; const asked: string[] = [];
      const realFetch = window.fetch;
      window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        if (!String(url).endsWith('/api/verify')) return realFetch(url, init);
        asked.push(JSON.parse(String(init?.body)).object);
        return new Response(JSON.stringify(answers.shift()), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch;
      try {
        const door = { ...inner.beat }; assert(door.challenge?.type === 'show' && door.challenge.object === 'a bottle or a cup', 'scripted story did not ask the cave door for a bottle or a cup');
        const hearts = inner.state.hearts, work = beginBeat(door); await until(() => scanner.open, 'scanner did not open for the quest');
        await scanner.captureFromFile(photo); await until(() => phase() === 'nomatch', 'wrong photo was not refused');
        assert(panel().includes('a coffee mug') && panel().includes('a bottle or a cup'), 'miss did not say what Gemini saw');
        key('Enter'); key('Enter', false); await until(() => phase() === 'live', 'Try again did not return to the camera');
        await scanner.captureFromFile(photo); await until(() => phase() === 'matched', 'right photo was not accepted');
        key('Enter'); key('Enter', false); await work;
        assert(!scanner.open && inner.state.outcomes.at(-1)?.kind === 'show' && inner.state.outcomes.at(-1)?.success, 'matched quest did not record a success');
        await until(() => inner.beat.id === 'lantern-fairy', 'story did not continue after the door opened');
        assert(asked.length === 2 && asked.every((o) => o === 'a bottle or a cup'), 'verify did not receive the requested object');
        // Skip: Escape closes the scanner, the quest fails, no heart is lost, and the story still moves on.
        const again = beginBeat({ ...door, id: 'show-me' }); await until(() => scanner.open, 'scanner did not reopen');
        key('Escape'); key('Escape', false); await again;
        const last = inner.state.outcomes.at(-1);
        assert(!scanner.open && last?.kind === 'show' && !last.success && last.heartsLost === 0 && inner.state.hearts === hearts, 'skip must fail the quest without costing a heart');
        await until(() => inner.beat.id === 'lantern-fairy', 'story did not continue after skipping');
      } finally { window.fetch = realFetch; }
    });
    await check('Spells hit real enemies and history stays isolated', async () => {
      inner.trial = undefined; inner.busy = false;
      const enemy = inner.enemies.find((e) => e.hp > 0)!;
      // Scenery blocks spells (by design), so stand where the real forest leaves a clear line of fire.
      for (const [ox, oz] of [[0, 4], [4, 0], [-4, 0], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3], [0, 6], [6, 0], [-6, 0], [0, -6]]) {
        near(enemy.root.position.x + ox, enemy.root.position.z + oz); inner.update(0.02);
        if (inner.closestEnemy(game.heroes[0].root.position, 19) === enemy) break;
      }
      for (let i = 0; i < 4; i++) { inner.spellCooldown[0] = 0; inner.cast(0); inner.update(0.22); }
      assert(enemy.hp <= 0, 'spell projectiles did not defeat enemy');
      const snapshot: BeatOutcome[] = inner.state.history().outcomes; if (snapshot[0]) snapshot[0].summary = 'mutated';
      assert(inner.state.outcomes[0]?.summary !== 'mutated', 'history leaked live state');
    });
    await check('Two weapons: drawing a shape casts its spell before any scan, per-shape cooldown and trials hold it, a relic infuses wand and sword', async () => {
      inner.trial = undefined; inner.busy = false; inner.enemies.forEach((enemy) => { enemy.hp = 0; enemy.root.visible = false; });
      type Spellish = { element?: string; color: number; damage: number };
      const rift = game as unknown as { scanner: { open: boolean; show(): Promise<void>; captureFromFile(f: File): Promise<void> }; weapons: unknown[]; strikes: Spellish[]; bolts: Spellish[]; hit: (...a: unknown[]) => void; strike(p: 0 | 1): void; resolveHits(): void };
      const draw = (code: string) => { key(code); key(code, false); };
      const hud = () => document.querySelector('.weapons-hud')?.textContent ?? '';
      assert(hud().includes('Sword') && hud().includes('Wand') && hud().includes('No relic'), 'weapons HUD does not show sword, wand and no relic');
      // Before any scan: a triangle drops an arcane meteor at once.
      const before = rift.strikes.length; draw('Digit5');
      const meteor = rift.strikes.at(-1);
      assert(rift.strikes.length === before + 1 && meteor?.element === undefined && meteor?.damage === 2, 'a drawn triangle did not cast an arcane meteor without a relic');
      assert(hud().includes('meteor'), 'HUD does not show the last shape');
      draw('Digit5'); assert(rift.strikes.length === before + 1, 'the same shape cast again inside its cooldown');
      // The wand recovers for WAND_RECOVERY after any spell: a different shape inside it is held, then goes off once it passes.
      const bolts = rift.bolts.length; draw('Digit6'); assert(rift.bolts.length === bolts, 'a different shape cast inside the wand recovery');
      inner.time += WAND_RECOVERY + 0.05;
      draw('Digit6'); assert(rift.bolts.length === bolts + 3, 'a different shape (square: wave) was blocked by the triangle cooldown');
      inner.time += WAND_RECOVERY + 0.05;
      inner.trial = { elapsed: 0 }; const during = rift.bolts.length; draw('Digit7'); inner.trial = undefined;
      assert(rift.bolts.length === during, 'a shape drawn during a trial also cast');
      // Relic: a fire scan infuses both weapons.
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const photo = new File([await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))], 'mug.png', { type: 'image/png' });
      const realFetch = window.fetch;
      window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => String(url).endsWith('/api/artifact')
        ? new Response(JSON.stringify({ artifact: { object: 'coffee mug', artifactName: 'Ember Chalice', artifactType: 'chalice', element: 'fire', ability: 'bolt', damage: 70, rarity: 'epic', description: 'Still warm.' }, source: 'gemini' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : realFetch(url, init)) as typeof fetch;
      const realHit = rift.hit; const elements: unknown[] = [];
      try {
        localStorage.removeItem('storybound.armory.v1');
        void rift.scanner.show(); await until(() => rift.scanner.open, 'scanner did not open');
        await rift.scanner.captureFromFile(photo); await until(() => !!document.querySelector('.relic-card'), 'relic card missing');
        assert((document.querySelector('.rift-panel')!.textContent ?? '').includes('infuses your wand and sword with fire'), 'card does not say the relic infuses both weapons');
        key('Enter'); key('Enter', false); await until(() => !rift.scanner.open, 'scanner did not close');
        assert(hud().includes('Relic: Ember Chalice') && hud().includes('Sword · fire') && hud().includes('Wand · fire'), 'HUD does not show the relic infusing both weapons');
        inner.time += WAND_RECOVERY + 0.05;
        const chain = rift.bolts.length; draw('Digit7');
        assert(rift.bolts.length === chain + 1 && rift.bolts.at(-1)?.element === 'fire', 'a drawn star did not cast a fire chain');
        assert(inner.state.history().relics?.[0]?.object === 'coffee mug', 'storyteller history is missing the relic');
        // The sword carries the element too, so boss weakness and resistance apply to slashes.
        rift.hit = (...a: unknown[]) => { elements.push(a[4]); return realHit.apply(game, a); };
        const p = game.heroes[0].root.position; (game as unknown as { spawnEnemy(x: number, z: number): void }).spawnEnemy(p.x, p.z + 1.3);
        (inner as unknown as { attackCooldown: number[] }).attackCooldown[0] = 0;
        // Swings land at their contact time, and only frame() advances the clock, so step it here as a frame would.
        rift.strike(0); for (let i = 0; i < 10; i++) { inner.time += 0.05; inner.update(0.05); }
        assert(elements.includes('fire'), 'a sword hit did not carry the relic element');
      } finally { window.fetch = realFetch; rift.hit = realHit; localStorage.removeItem('storybound.armory.v1'); rift.weapons.length = 0; inner.enemies.forEach((enemy) => { enemy.hp = 0; enemy.root.visible = false; }); }
    });
    await check('Boss wards block damage during the warning and admit spells during recovery', async () => {
      inner.enemies.forEach((enemy) => { enemy.hp = 0; enemy.root.visible = false; }); inner.state.hearts = 3;
      const beat: StoryBeat = { id: 'boss', chapter: 'Finale', environment: 'cave', narration: ['The guardian wakes.'], boss: { kind: 'shadow-dragon', name: 'Umbraxis', maxHp: 6, attacks: ['shadow-wave'], telegraphSec: 2.2, vulnerableSec: 4 } };
      await beginBeat(beat); const boss = inner.enemies.find((enemy) => enemy.boss)!;
      near(boss.root.position.x, boss.root.position.z + 4); boss.windup = 2; boss.cooldown = 0;
      inner.spellCooldown[0] = 0; inner.cast(0); inner.updateBolts(0.3); assert(boss.hp === 6, 'ward allowed damage');
      boss.windup = 0; boss.cooldown = 4; inner.spellCooldown[0] = 0; inner.cast(0); inner.updateBolts(0.3); assert(Number(boss.hp) === 5, 'vulnerable boss rejected damage');
    });
    await check('The solo companion defends a shadow wave; boss victory reaches the storybook', async () => {
      const boss = inner.enemies.find((enemy) => enemy.boss)!;
      inner.companionUntil = 0;
      boss.windup = 0.01; boss.attack = 'shadow-wave'; boss.cooldown = 0;
      key('Digit3'); inner.update(0.02); key('Digit3', false);
      assert(inner.state.hearts === 3, 'solo companion made a successful crouch lose health');
      for (let i = 0; i < 6; i++) { boss.windup = 0; boss.cooldown = 4; inner.spellCooldown[0] = 0; inner.cast(0); inner.updateBolts(0.3); }
      await until(() => game.ui.speaking, 'victory ending missing'); await clearDialogue();
      await until(() => game.ui.modal.open, 'storybook missing');
      assert(game.ui.modal.textContent?.includes('Happily Ever After'), 'boss victory did not produce a victory storybook');
      assert(inner.state.outcomes.some((outcome) => outcome.kind === 'boss' && outcome.success), 'boss outcome missing');
      for (let i = 0; i < 2; i++) { const cancel = new Event('cancel', { cancelable: true }); game.ui.modal.dispatchEvent(cancel); assert(cancel.defaultPrevented, 'storybook must preserve the replay control'); }
    });
    game.dispose();
    for (const type of ['freeze', 'pose'] as const) {
      await check(`A final-heart ${type} failure is recorded before the storybook`, async () => {
        const fatal = new Adventure(), core = fatal as unknown as Internals;
        try {
          const started = fatal.start(); await until(() => !!document.querySelector('.adventure-start form'), 'fresh setup missing');
          document.querySelector<HTMLFormElement>('.adventure-start form')!.requestSubmit(); await started; core.narrator.enabled = false; core.sound = false;
          core.state.hearts = 1; core.companionUntil = 0;
          const beat: StoryBeat = { id: type === 'freeze' ? 'frost-spell' : 'gate', chapter: 'Check', environment: 'forest', narration: ['The last heart is at stake.'], challenge: type === 'freeze' ? { type, prompt: 'Stillness', durationSec: 0.3, tolerance: 0.25 } : { type, prompt: 'Pose', poses: ['t-pose'], secondsPerPose: 0.3 } };
          await core.loadBeat(Promise.resolve(beat)); const p = objectiveFor(beat); fatal.heroes.forEach((hero, i) => hero.root.position.set(p.x + i, 0, p.z));
          const work = core.interact(); await until(() => fatal.ui.speaking, 'fatal challenge narration missing'); fatal.ui.advance(); await work;
          if (type === 'freeze') key('KeyW'); core.update(0.35); key('KeyW', false);
          await until(() => fatal.ui.modal.open, 'defeat storybook missing');
          const outcome = core.state.outcomes.at(-1);
          assert(outcome?.kind === type && !outcome.success && outcome.heartsLost === 1, 'fatal challenge outcome missing or incorrect');
          assert(core.state.hearts === 0 && !core.state.gainHeart(), 'defeat must remain terminal');
        } finally { fatal.dispose(); }
      });
    }
    status.textContent = `All ${results.children.length} 3D gameplay checks passed.`; document.body.dataset.result = 'passed';
  } catch (error) { status.textContent = String(error); document.body.dataset.result = 'failed'; console.error(error); }
  finally { game.dispose(); running = false; }
};
