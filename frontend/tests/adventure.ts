import * as T from 'three';
import { Adventure } from '../src/adventure/Adventure';
import { objectiveFor } from '../src/adventure/terrain';
import type { BeatOutcome, StoryBeat } from '../src/contracts';
import type { GameState } from '../src/game/GameState';

// Development-only harness. It exercises real renderer, inputs and game routines;
// no test globals or control hooks are added to the production application.
// These checks cover both heroes (companion, player two), so run the two-player mode.
(window as unknown as { RIFT_PLAYERS: number }).RIFT_PLAYERS = 2;

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
      // Hold for game time, not wall time, so a throttled background page still gets enough frames.
      const before = game.heroes[0].root.position.clone(), from = inner.time; key('KeyW'); await until(() => inner.time - from > 0.22, 'game clock stalled'); key('KeyW', false);
      assert(game.heroes[0].root.position.distanceTo(before) > 0.4, 'hero did not walk');
      assert(game.camera.position.distanceTo(game.heroes[0].root.position) < 20, 'camera lost the hero');
    });
    await check('Sprint spends stamina, camera can orbit, player two moves independently', async () => {
      key('ShiftLeft'); key('KeyW'); await wait(160); key('KeyW', false); key('ShiftLeft', false); assert(inner.stamina < 1, 'sprint did not use stamina');
      const yaw = inner.yaw; key('KeyC'); await wait(120); key('KeyC', false); assert(inner.yaw !== yaw, 'camera did not orbit');
      const p = game.heroes[1].root.position.clone(); key('ArrowRight'); await wait(150); key('ArrowRight', false); assert(game.heroes[1].root.position.distanceTo(p) > 0.3, 'second hero did not move');
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
