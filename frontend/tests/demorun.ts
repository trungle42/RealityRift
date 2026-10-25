import type * as T from 'three';
import { Adventure } from '../src/adventure/Adventure';
import { SHAPE_COOLDOWN, type WandShape } from '../src/adventure/forge';

// Development-only harness for the default demo run (Willow's briefing -> one shadow wave -> Morwen), with every input
// at once: the phone joystick and the camera tracker are fed relay-format messages through their real socket handlers,
// keys drive E / X / Enter / Space, and the relic scan goes through the scanner's photo path with a stubbed Gemini.
// It does NOT set RIFT_FULL_STORY, so the game runs exactly as it opens for a player. Game time is stepped here
// (update(dt) with inner.time advanced), so it passes with the browser pane hidden.

interface Foe { root: T.Group; hp: number; maxHp: number; windup: number; cooldown: number; encounter: boolean; boss?: { kind: string }; dying: number }
interface Inner {
  demo?: { stage: 'briefing' | 'wave' | 'boss' | 'done'; foes: number }; enemies: Foe[]; time: number; busy: boolean; ended: boolean; invulnerable: number;
  update(dt: number): void; resolveHits(): void; hit(enemy: Foe, damage: number, player: 0 | 1, heavy?: boolean, element?: string): void;
  strikes: unknown[]; bolts: unknown[]; weapons: ({ element: string } | undefined)[]; attackCooldown: number[]; encounterKind?: string;
  scanner: { open: boolean; captureFromFile(f: File): Promise<void> }; phone?: { socket?: WebSocket; read(): { mag: number } }; cv?: { socket?: WebSocket };
  fx: { number(at: unknown, text: string, color: string, big?: boolean): void }; rig: { viewYaw: number };
}
interface Hit { foe: Foe; damage: number; element?: string; taken: number; at: number; sword: boolean }

const status = document.querySelector('#status')!, results = document.querySelector('#results')!;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function key(code: string, down = true): void { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); }
const tap = (code: string) => { key(code); key(code, false); };
async function until(predicate: () => boolean, message: string, ms = 8000): Promise<void> {
  const limit = performance.now() + ms;
  while (!predicate()) { if (performance.now() > limit) throw new Error(message); await wait(20); }
}

let running = false;
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
  if (running) return; running = true; results.replaceChildren();
  const game = new Adventure(), inner = game as unknown as Inner;
  const check = async (name: string, task: () => Promise<void>) => {
    status.textContent = name; const row = document.createElement('li'); results.append(row);
    try { await task(); row.textContent = `PASS · ${name}`; row.style.color = '#bdedc4'; }
    catch (error) { row.textContent = `FAIL · ${name}: ${String(error)}`; row.style.color = '#ffc0b2'; throw error; }
  };
  const hero = () => game.heroes[0].root.position;
  const dist = (foe: Foe) => Math.hypot(foe.root.position.x - hero().x, foe.root.position.z - hero().z);
  const alive = () => inner.enemies.filter((e) => e.hp > 0);
  const wave = () => alive().filter((e) => e.encounter && !e.boss);
  const boss = () => inner.enemies.find((e) => e.boss && e.hp > 0);
  const stage = (): string | undefined => inner.demo?.stage;
  const paused = () => game.ui.blocked || inner.busy || inner.ended || inner.scanner.open;

  // Every hit, from any weapon, with the hp it actually took (after boss weakness), so each input's effect is measurable.
  const hits: Hit[] = []; const realHit = inner.hit;
  let swinging = false; const realResolve = inner.resolveHits;
  inner.resolveHits = () => { swinging = true; try { realResolve.call(game); } finally { swinging = false; } };
  inner.hit = (foe, damage, player, heavy, element) => { const before = foe.hp; realHit.call(game, foe, damage, player, heavy, element); hits.push({ foe, damage, element, taken: before - foe.hp, at: inner.time, sword: swinging }); };
  const metrics: string[] = [];
  const tally = (from: number, label: string, started: number) => {
    const slice = hits.slice(from).filter((h) => h.taken > 0), kills = { sword: 0, wand: 0 };
    for (const h of slice) if (h.foe.hp <= 0 && h === slice.filter((x) => x.foe === h.foe).at(-1)) kills[h.sword ? 'sword' : 'wand']++;
    const dmg = (sword: boolean) => slice.filter((h) => h.sword === sword).reduce((n, h) => n + h.taken, 0);
    metrics.push(`${label}: ${(inner.time - started).toFixed(1)} s game time, kills sword ${kills.sword} / wand ${kills.wand}, damage sword ${dmg(true)} / wand ${dmg(false)}`);
  };
  const numbers: string[] = []; const realNumber = inner.fx.number.bind(inner.fx);

  // Relay messages, through the same socket handlers the real phone and tracker feed.
  const deliver = (socket: WebSocket | undefined, message: unknown) => { assert(socket?.onmessage, 'input socket has no message handler'); socket.onmessage.call(socket, new MessageEvent('message', { data: JSON.stringify(message) })); };
  const stick = (x: number, y: number) => deliver(inner.phone?.socket, { type: 'move', x, y });
  let slashes = 0, jumps = 0; const complete = { yellow: false, blue: false }; const shapes: Record<string, { shape: string; score: number } | null> = { yellow: null, blue: null };
  const cvFrame = () => deliver(inner.cv?.socket, { type: 'cv', slash: slashes, jump: jumps, motion: 0, wand: { active: true, secondsLeft: 0, target: null, next: null, shapes, complete, traces: {} } });
  const slash = () => { slashes++; cvFrame(); };
  /** Push the phone stick toward a foe: the inverse of the game's camera-relative mapping (stick y forward = -z in view). */
  const stickToward = (foe: Foe) => {
    const wx = foe.root.position.x - hero().x, wz = foe.root.position.z - hero().z, len = Math.hypot(wx, wz) || 1, v = inner.rig.viewYaw;
    const dx = (wx * Math.cos(v) - wz * Math.sin(v)) / len, dz = (wx * Math.sin(v) + wz * Math.cos(v)) / len;
    stick(dx, -dz);
  };
  const draw = (shape: WandShape) => { shapes.yellow = { shape, score: 0.1 }; complete.yellow = true; cvFrame(); complete.yellow = false; shapes.yellow = null; cvFrame(); };

  // One game step, as frame() does it, while the world is running; the hero is kept from dying so a long scripted fight
  // never ends early on a stray hit (hurting is covered by the other harness).
  const step = (dt = 1 / 60) => { inner.invulnerable = 60; if (paused()) return; inner.time += dt; game.heroes.forEach((h) => h.update(dt, inner.time)); inner.update(dt); };
  const run = async (seconds: number, each?: () => boolean | void) => {
    const end = inner.time + seconds;
    for (let i = 0; inner.time < end; i++) { if (each?.() === true) return; step(); if (i % 20 === 19) await wait(0); if (paused() && !inner.scanner.open) await wait(5); }
  };

  try {
    const start = game.start();
    await until(() => !!document.querySelector('.adventure-start form'), 'models did not finish loading', 20000);
    document.querySelector<HTMLFormElement>('.adventure-start form')!.requestSubmit(); await start;
    game.renderer.setAnimationLoop(null);   // this harness owns the clock
    deliver(inner.cv?.socket, { type: 'peer', role: 'tracker', state: 'joined' }); cvFrame();

    await check('Phone joystick walks the hero to Willow; tracker slashes and wand shapes are ignored during her briefing', async () => {
      assert(inner.demo?.stage === 'briefing', 'the game did not open in the demo run');
      const from = hero().clone();
      await run(8, () => { stick(0, 1); return Math.hypot(hero().x - from.x, hero().z - from.z) > 2.6; });
      stick(0, 0);
      assert(Math.hypot(hero().x - from.x, hero().z - from.z) > 2.6, 'the phone stick did not walk the hero');
      tap('KeyE'); await until(() => inner.busy, 'E next to Willow did not start the briefing');
      const bolts = inner.bolts.length, strikes = inner.strikes.length;
      slash(); draw('star'); draw('triangle');
      assert(inner.attackCooldown[0] === 0 && inner.bolts.length === bolts && inner.strikes.length === strikes, 'tracker input acted during the briefing');
      for (let i = 0; i < 80 && stage() === 'briefing'; i++) { tap('Space'); await wait(40); }
      assert(stage() === 'wave' && !inner.busy, 'the briefing did not lead into the wave');
    });

    await check('Each wand shape, drawn as the horde arrives, reaches and damages a shadow (auto-aimed)', async () => {
      assert(wave().length === 6, `expected six shadows, got ${wave().length}`);
      const missed: string[] = [];
      for (const shape of ['triangle', 'star', 'square', 'circle'] as WandShape[]) {
        const from = hits.length, nearest = Math.min(...wave().map(dist));
        draw(shape); await run(1.3);
        const landed = hits.slice(from).filter((h) => h.taken > 0);
        if (!landed.length) missed.push(`${shape} (nearest shadow ${nearest.toFixed(1)} m)`);
      }
      assert(!missed.length, `spells that never reached a shadow: ${missed.join(', ')}`);
    });

    await check('A phone slash swings the sword and kills a shadow', async () => {
      await run(8, () => wave().some((e) => dist(e) < 2.4));
      const foe = wave().sort((a, b) => dist(a) - dist(b))[0]; assert(foe && dist(foe) < 2.6, 'no shadow came within sword reach');
      const from = hits.length;
      for (let i = 0; i < 8 && foe.hp > 0; i++) { await run(1, () => inner.attackCooldown[0] <= 0); slash(); await run(0.35); }
      assert(foe.hp <= 0, `six slashes did not kill the shadow (hp ${foe.hp})`);
      assert(hits.slice(from).some((h) => h.foe === foe && h.taken > 0 && h.element === undefined), 'the kill did not come from the sword');
    });

    await check('A relic scanned mid-fight infuses both weapons with fire, and the wave carries on', async () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
      const photo = new File([await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))], 'mug.png', { type: 'image/png' });
      const realFetch = window.fetch;
      window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => String(url).endsWith('/api/artifact')
        ? new Response(JSON.stringify({ artifact: { object: 'coffee mug', artifactName: 'Ember Chalice', artifactType: 'chalice', element: 'fire', ability: 'nova', damage: 70, rarity: 'epic', description: 'Still warm.' }, source: 'gemini' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : realFetch(url, init)) as typeof fetch;
      try {
        const left = wave().length;
        tap('KeyX'); await until(() => inner.scanner.open, 'X did not open the scanner during the wave');
        const quiet = { bolts: inner.bolts.length, strikes: inner.strikes.length };
        slash(); draw('star');   // a tracker event while the scanner is open must not act
        assert(inner.bolts.length === quiet.bolts && inner.strikes.length === quiet.strikes && inner.attackCooldown[0] <= 0, 'a tracker slash or wand shape acted behind the open scanner');
        await inner.scanner.captureFromFile(photo); await until(() => !!document.querySelector('.relic-card'), 'relic card missing');
        tap('Enter'); await until(() => !inner.scanner.open, 'scanner did not close');
        assert(inner.weapons[0]?.element === 'fire', 'the relic did not reach the hero');
        const hud = document.querySelector('.weapons-hud')?.textContent ?? '';
        assert(hud.includes('Sword · fire') && hud.includes('Wand · fire'), 'HUD does not show both weapons infused with fire');
        assert(inner.demo?.stage === 'wave' && inner.encounterKind === 'encounter' && wave().length === left, 'the scan broke the wave');
        const at = wave().map((e) => e.root.position.clone()); await run(0.6);
        assert(wave().some((e, i) => at[i] && e.root.position.distanceTo(at[i]) > 0.05), 'the wave did not resume after the scan');
        const from = hits.length; draw('star'); await run(1.3);
        assert(hits.slice(from).some((h) => h.element === 'fire' && h.taken > 0), 'a wand spell after the scan did not burn with fire');
      } finally { window.fetch = realFetch; localStorage.removeItem('storybound.armory.v1'); }
    });

    await check('Sword and wand together clear the wave, and Morwen arrives', async () => {
      let next = 0; const order: WandShape[] = ['triangle', 'star', 'square', 'circle']; const cast = new Map<WandShape, number>();
      const waveFrom = hits.length, waveStart = inner.time;
      await run(90, () => {
        if (inner.demo?.stage !== 'wave') return true;
        const shape = order[next % order.length];
        if ((cast.get(shape) ?? -99) + SHAPE_COOLDOWN[shape] < inner.time) { draw(shape); cast.set(shape, inner.time); next++; }
        if (inner.attackCooldown[0] <= 0 && wave().some((e) => dist(e) < 2.6)) slash();
      });
      tally(waveFrom, 'Wave (rest, fire relic)', waveStart);
      assert(inner.demo?.stage === 'boss' || inner.demo?.stage === 'done', `the wave was not cleared (stage ${inner.demo?.stage}, ${wave().length} shadows left)`);
      // Her entrance waits on the wall clock; keep game time running meanwhile, as the real frame loop does.
      const limit = performance.now() + 6000;
      while (!boss() && performance.now() < limit) { await run(0.05); await wait(15); }
      assert(boss(), 'Morwen did not arrive after the wave');
    });

    await check('Fire sword and fire wand both hit Morwen\'s weak point for double damage, and she falls', async () => {
      inner.fx.number = (at, text, color, big) => { numbers.push(text); realNumber(at, text, color, big); };
      const witch = boss()!; assert(witch.boss?.kind === 'frost-witch', 'the boss is not Morwen');
      const bossFrom = hits.length, bossStart = inner.time;
      const open = () => witch.windup <= 0 && witch.cooldown > 0;
      // Wand: a star (chain) while her ward is down.
      await run(3.2);   // every wand shape off its cooldown from the wave
      await run(20, () => open() && dist(witch) < 18);
      const from = hits.length, bolts = inner.bolts.length, wasOpen = open(), d0 = dist(witch); draw('star'); const fired = inner.bolts.length - bolts; await run(1.2);
      const spell = hits.slice(from).find((h) => h.foe === witch && h.taken > 0);
      const seen = hits.slice(from).map((h) => ({ boss: !!h.foe.boss, d: h.damage, t: h.taken, e: h.element }));
      assert(spell && spell.element === 'fire' && spell.taken === spell.damage * 2, `the fire spell did not deal double damage to Morwen: ${JSON.stringify({ fired, wasOpen, d0: d0.toFixed(1), seen, windup: witch.windup, cooldown: witch.cooldown })}`);
      // Sword: slashes in reach while the ward is down.
      let sword: Hit | undefined;
      await run(40, () => {
        if (!boss()) return true;
        if (dist(witch) > 2.2) stickToward(witch); else stick(0, 0);
        if (open() && dist(witch) < 3.2 && inner.attackCooldown[0] <= 0) slash();
        sword = hits.find((h) => h.foe === witch && h.taken > 0 && h.at > (spell?.at ?? 0) + 0.05 && h.element === 'fire' && h.damage <= 3);
        return !!sword;
      });
      assert(sword && sword.taken === sword.damage * 2, 'a fire sword slash did not deal double damage to Morwen');
      assert(numbers.includes('Weak point!'), '"Weak point!" never showed');
      // Then everything together until she falls.
      let next = 0; const order: WandShape[] = ['star', 'triangle', 'square', 'circle']; const cast = new Map<WandShape, number>();
      await run(120, () => {
        if (!boss()) return true;
        const shape = order[next % order.length];
        if (dist(witch) > 2.2) stickToward(witch); else stick(0, 0);
        if (open() && (cast.get(shape) ?? -99) + SHAPE_COOLDOWN[shape] < inner.time) { draw(shape); cast.set(shape, inner.time); next++; }
        if (open() && dist(witch) < 3.2 && inner.attackCooldown[0] <= 0) slash();
      });
      stick(0, 0); tally(bossFrom, `Morwen (${witch.maxHp} hp)`, bossStart);
      assert(!boss(), `Morwen did not fall (hp ${witch.hp} / ${witch.maxHp})`);
    });

    await check('The closing screen tells the tale of the relic\'s real object, and inputs no longer act', async () => {
      await until(() => !!document.querySelector('.run-result'), 'the closing screen did not appear', 8000);
      const text = document.querySelector('.run-result')?.textContent ?? '';
      assert(text.includes('Quest complete'), 'the run did not end in victory');
      assert(text.includes('coffee mug'), 'the closing screen does not mention the relic\'s object');
      const bolts = inner.bolts.length; slash(); draw('star');
      assert(inner.bolts.length === bolts, 'a wand shape cast after the run ended');
    });
    status.textContent = `All ${results.children.length} demo-run checks passed. ${metrics.join(' · ')}`; document.body.dataset.result = 'passed';
  } catch (error) { status.textContent = String(error); document.body.dataset.result = 'failed'; console.error(error); }
  finally { inner.hit = realHit; inner.resolveHits = realResolve; running = false; document.querySelector('.run-result')?.remove(); game.dispose(); }
};
