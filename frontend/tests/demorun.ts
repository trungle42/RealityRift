import type * as T from 'three';
import { Adventure } from '../src/adventure/Adventure';
import { wandSeats, type WandShape } from '../src/adventure/forge';
import { listenPlayers, type PhoneButton, type PlayerSlot } from '../src/adventure/players';

/**
 * How long Morwen lasts (wand only, every shape drawn the moment the wand allows): faster with a fire relic, never trivial.
 * Measured 17.1 s and 37.0 s. A fire hit is exactly x2, so the fire fight is about half the plain one; these ranges keep a
 * margin either side and catch drift in the wand recovery, the shape cooldowns or the relic tier.
 */
const FIRE_FIGHT = [15, 25], PLAIN_FIGHT = [30, 42];
/** `?measure` reports the fight timings without asserting the ranges (for tuning). */
const measuring = new URLSearchParams(location.search).has('measure');
const inRange = (seconds: number, [lo, hi]: number[]) => measuring || (seconds >= lo && seconds <= hi);

// Development-only harness for the default demo run (Willow's briefing -> one shadow wave -> Morwen), with every input
// at once: the phone joystick and the camera tracker are fed relay-format messages through their real socket handlers,
// keys drive E / X / Enter / Space, and the relic scan goes through the scanner's photo path with a stubbed Gemini.
// It does NOT set RIFT_FULL_STORY, so the game runs exactly as it opens for a player. Game time is stepped here
// (update(dt) with inner.time advanced), so it passes with the browser pane hidden.

interface Foe { root: T.Group; hp: number; maxHp: number; windup: number; cooldown: number; encounter: boolean; boss?: { kind: string }; dying: number }
interface Inner {
  demo?: { stage: 'briefing' | 'wave' | 'boss' | 'done'; foes: number }; enemies: Foe[]; time: number; busy: boolean; ended: boolean; invulnerable: number;
  update(dt: number): void; resolveHits(): void; leap(player: 0 | 1): void; rollIframes: number[]; jump: number[]; startWave(): void; hurt(defer?: boolean): void; spellCooldown: number[];
  wandCooldowns: { ready(hero: 0 | 1, shape: WandShape, now: number): boolean }; runes: { target?: WandShape; rng: () => number; next(now: number): void }; runesTwo: { target?: WandShape; rng: () => number };
  seats: readonly string[]; companionFree: boolean; freeRunes: boolean; onSeat(slot: PlayerSlot, joined: boolean): void; onPlayerButton(kind: PhoneButton, slot: PlayerSlot): void; closingLine(victory: boolean): string;
  state: { relics: { hero: 0 | 1; object: string; name: string; element: string; ability: string }[]; party: { name: string }[]; hearts: number }; hit(enemy: Foe, damage: number, player: 0 | 1, heavy?: boolean, element?: string): void;
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
  let game!: Adventure, inner!: Inner;
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
  const paused = () => game.ui.blocked || inner.busy || inner.ended;   // the scanner no longer pauses the game

  // Every hit, from any weapon, with the hp it actually took (after boss weakness), so each input's effect is measurable.
  const hits: Hit[] = []; let swinging = false;
  const metrics: string[] = [];
  const tally = (from: number, label: string, started: number) => {
    const slice = hits.slice(from).filter((h) => h.taken > 0), kills = { sword: 0, wand: 0 };
    for (const h of slice) if (h.foe.hp <= 0 && h === slice.filter((x) => x.foe === h.foe).at(-1)) kills[h.sword ? 'sword' : 'wand']++;
    const dmg = (sword: boolean) => slice.filter((h) => h.sword === sword).reduce((n, h) => n + h.taken, 0);
    metrics.push(`${label}: ${(inner.time - started).toFixed(1)} s game time, kills sword ${kills.sword} / wand ${kills.wand}, damage sword ${dmg(true)} / wand ${dmg(false)}`);
  };
  const numbers: string[] = [];

  // Relay messages, through the same socket handlers the real phone and tracker feed.
  const deliver = (socket: WebSocket | undefined, message: unknown) => { assert(socket?.onmessage, 'input socket has no message handler'); socket.onmessage.call(socket, new MessageEvent('message', { data: JSON.stringify(message) })); };
  const stick = (x: number, y: number) => deliver(inner.phone?.socket, { type: 'move', x, y });
  let slashes = 0; const jumps = 0; const complete = { yellow: false, blue: false }; const shapes: Record<string, { shape: string; score: number } | null> = { yellow: null, blue: null };
  const cvFrame = () => deliver(inner.cv?.socket, { type: 'cv', slash: slashes, jump: jumps, motion: 0, wand: { active: true, secondsLeft: 0, target: null, next: null, shapes, complete, traces: {} } });
  const slash = () => { slashes++; cvFrame(); };
  /** Push the phone stick toward a foe: the inverse of the game's camera-relative mapping (stick y forward = -z in view). */
  const stickToward = (foe: Foe) => {
    const wx = foe.root.position.x - hero().x, wz = foe.root.position.z - hero().z, len = Math.hypot(wx, wz) || 1, v = inner.rig.viewYaw;
    const dx = (wx * Math.cos(v) - wz * Math.sin(v)) / len, dz = (wx * Math.sin(v) + wz * Math.cos(v)) / len;
    stick(dx, -dz);
  };
  /** The rune the game asks for now, and whether a player would draw it yet: the wand has recovered and, for a nova (which
   * bursts around the hero), a foe is close enough to be caught in it. */
  const asked = (): WandShape => { const rune = inner.runes.target; assert(rune, 'no rune requested in combat'); return rune; };
  const castable = (foes: Foe[]) => { const rune = inner.runes.target; return !!rune && inner.wandCooldowns.ready(0, rune, inner.time) && (rune !== 'circle' || foes.some((e) => dist(e) < (e.boss ? 6 : 4.8))); };
  const drawAs = (colour: string, shape: WandShape) => { shapes[colour] = { shape, score: 0.1 }; (complete as Record<string, boolean>)[colour] = true; cvFrame(); (complete as Record<string, boolean>)[colour] = false; shapes[colour] = null; cvFrame(); };
  const draw = (shape: WandShape) => drawAs('yellow', shape);

  // One game step, as frame() does it, while the world is running; the hero is kept from dying so a long scripted fight
  // never ends early on a stray hit (hurting is covered by the other harness).
  const step = (dt = 1 / 60, guard = true) => { if (guard) inner.invulnerable = 60; if (paused()) return; inner.time += dt; game.heroes.forEach((h) => h.update(dt, inner.time)); inner.update(dt); };
  const run = async (seconds: number, each?: () => boolean | void) => {
    const end = inner.time + seconds;
    for (let i = 0; inner.time < end; i++) { if (each?.() === true) return; step(); if (i % 20 === 19) await wait(0); if (paused()) await wait(5); }
  };

  /** A fresh game in the demo run, with hits and damage numbers recorded and this harness owning the clock. */
  const boot = async () => {
    game?.dispose(); document.querySelector('.run-result')?.remove();
    game = new Adventure(); inner = game as unknown as Inner;
    const realHit = inner.hit.bind(game), realResolve = inner.resolveHits.bind(game), realNumber = inner.fx.number.bind(inner.fx);
    inner.resolveHits = () => { swinging = true; try { realResolve(); } finally { swinging = false; } };
    inner.hit = (foe, damage, player, heavy, element) => { const before = foe.hp; realHit(foe, damage, player, heavy, element); hits.push({ foe, damage, element, taken: before - foe.hp, at: inner.time, sword: swinging }); };
    inner.fx.number = (at, text, color, big) => { numbers.push(text); realNumber(at, text, color, big); };
    const start = game.start();
    await until(() => !!document.querySelector('.adventure-start form'), 'models did not finish loading', 20000);
    document.querySelector<HTMLFormElement>('.adventure-start form')!.requestSubmit(); await start;
    game.renderer.setAnimationLoop(null);
    let seed = 20261025; inner.runes.rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // repeatable rune order
    slashes = 0; deliver(inner.cv?.socket, { type: 'peer', role: 'tracker', state: 'joined' }); cvFrame();
  };
  /** Her entrance waits on the wall clock; keep game time running meanwhile, as the real frame loop does. */
  const awaitMorwen = async () => {
    const limit = performance.now() + 6000;
    while (!boss() && performance.now() < limit) { await run(0.05); await wait(15); }
    assert(boss(), 'Morwen did not arrive after the wave');
  };
  /**
   * Fight Morwen by drawing every shape the moment the wand allows, while her ward is down, walking to her with the stick.
   * The timed fights are wand-only: the sword's x2 is checked on its own, and a perfectly timed sword alone would beat
   * any target this tuning could set.
   */
  const fightMorwen = async (limit = 150, sword = false) => {
    const witch = boss()!; const open = () => witch.windup <= 0 && witch.cooldown > 0;
    // The same rune order for every timed fight, whatever the checks before it drew.
    let seed = 4242; inner.runes.rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647; inner.runes.next(inner.time);
    await run(limit, () => {
      if (!boss()) return true;
      if (dist(witch) > 2.2) stickToward(witch); else stick(0, 0);
      if (open() && castable([witch])) draw(asked());
      if (sword && open() && dist(witch) < 3.2 && inner.attackCooldown[0] <= 0) slash();
    });
    stick(0, 0); return witch;
  };

  try {
    await boot();

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

    await check('The game asks for one rune at a time: only that shape casts, and every requested spell reaches a shadow', async () => {
      assert(wave().length === 6, `expected six shadows, got ${wave().length}`);
      await run(0.05);
      const first = asked(), prompt = document.querySelector('.rune-request:not([hidden])')?.textContent ?? '';
      assert(prompt.includes(first), `the requested rune is not on screen (prompt: "${prompt}")`);
      const wrong = (['circle', 'triangle', 'square', 'star'] as WandShape[]).find((shape) => shape !== first)!, quiet = { bolts: inner.bolts.length, strikes: inner.strikes.length, hits: hits.length };
      draw(wrong); await run(0.4);
      assert(inner.bolts.length === quiet.bolts && inner.strikes.length === quiet.strikes && hits.length === quiet.hits && asked() === first, `drawing ${wrong} when ${first} was asked still cast`);
      const cast = new Set<WandShape>(), missed: string[] = [];
      for (let i = 0; i < 12 && cast.size < 4; i++) {
        await run(8, () => castable(wave()));
        const shape = asked(), from = hits.length, nearest = Math.min(...wave().map(dist));
        draw(shape); assert(inner.runes.target !== shape, `the request stayed on ${shape} after it was cast`);
        await run(1.3);
        if (!hits.slice(from).some((h) => h.taken > 0)) missed.push(`${shape} (nearest shadow ${nearest.toFixed(1)} m)`);
        cast.add(shape);
      }
      assert(cast.size === 4, `only ${[...cast].join(', ')} were ever requested`);
      assert(!missed.length, `requested spells that never reached a shadow: ${missed.join(', ')}`);
    });

    await check('While the wand recovers the tracker stops tracing: a shape drawn then does not cast, and the gate comes back on', async () => {
      const cv = inner.cv as unknown as { wanted: { on: boolean; target: string | null }; sendGate(): void };
      const sent: string[] = [], realSend = cv.sendGate.bind(cv);
      cv.sendGate = () => { sent.push(`${cv.wanted.on}:${cv.wanted.target}`); realSend(); };
      try {
        await run(8, () => castable(wave()));
        const first = asked();
        assert(cv.wanted.on && cv.wanted.target === first, `the tracker is not asked for ${first} while the wand is ready (${JSON.stringify(cv.wanted)})`);
        draw(first); await run(0.05);
        assert(!cv.wanted.on, 'the tracker kept tracing while the wand recovers');
        const next = asked(), quiet = { bolts: inner.bolts.length, strikes: inner.strikes.length, hits: hits.length };
        draw(next); await run(0.3);   // drawn anyway (a real tracker would not even complete it now)
        assert(inner.bolts.length === quiet.bolts && inner.strikes.length === quiet.strikes && hits.length === quiet.hits && asked() === next, 'a shape drawn during the recovery cast');
        await run(4, () => inner.wandCooldowns.ready(0, next, inner.time));
        await run(0.05);
        assert(cv.wanted.on && cv.wanted.target === next, `the tracker did not come back on for ${next} (${JSON.stringify(cv.wanted)})`);
        assert(sent.length <= 3, `the gate was sent ${sent.length} times for one off/on cycle: ${sent.join(', ')}`);
      } finally { cv.sendGate = realSend; }
    });

    await check('?runes=free: any shape casts in combat (no request, no prompt), and the wand recovery still holds', async () => {
      inner.freeRunes = true;
      try {
        await run(0.05);
        assert(!inner.runes.target && document.querySelector('.rune-request')?.hasAttribute('hidden'), 'a rune was still requested with ?runes=free');
        await run(4, () => inner.wandCooldowns.ready(0, 'star', inner.time) && inner.wandCooldowns.ready(0, 'square', inner.time));
        const before = inner.bolts.length; draw('star');
        assert(inner.bolts.length === before + 1, 'with ?runes=free a star did not cast');
        draw('square');
        assert(inner.bolts.length === before + 1, 'the wand recovery did not hold the next shape');
        const cv = inner.cv as unknown as { wanted: { on: boolean } };
        await run(0.05);
        assert(!cv.wanted.on, 'with ?runes=free the tracker kept tracing while the wand recovers');
      } finally { inner.freeRunes = false; }
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
        // The scanner is a docked panel: the fight keeps going while it is open, and the hero can still swing.
        const open = wave().map((e) => ({ p: e.root.position.clone(), w: e.windup, c: e.cooldown })), clock = inner.time;
        await run(0.6);
        assert(inner.time > clock + 0.5 && wave().some((e, i) => e.hp <= 0 || e.root.position.distanceTo(open[i].p) > 0.05 || e.windup !== open[i].w || e.cooldown !== open[i].c), 'the game paused while the scanner was open');
        inner.attackCooldown[0] = 0; slash();
        assert(inner.attackCooldown[0] > 0 && inner.scanner.open, 'a phone slash did not swing while the scanner was open');
        assert((document.querySelector('.rift-scan')?.getBoundingClientRect().width ?? 9999) <= 340, 'the scanner is not a small docked panel');
        await inner.scanner.captureFromFile(photo); await until(() => !!document.querySelector('.relic-card'), 'relic card missing');
        const card = document.querySelector('.rift-panel')?.textContent ?? '';
        assert(card.includes('infuses your wand and sword with fire') && card.includes('Morwen is weak to fire · ×2 damage'), `the card does not say what the relic gives and that Morwen fears it: ${card}`);
        tap('Enter'); await until(() => !inner.scanner.open, 'scanner did not close');
        assert(inner.weapons[0]?.element === 'fire', 'the relic did not reach the hero');
        const hud = document.querySelector('.weapons-hud')?.textContent ?? '';
        assert(hud.includes('Sword · fire') && hud.includes('Wand · fire'), 'HUD does not show both weapons infused with fire');
        assert(inner.demo?.stage === 'wave' && inner.encounterKind === 'encounter' && wave().length === left, 'the scan broke the wave');
        // Alive again: shadows move, wind up or tick their attack cooldown (one standing in melee range only does the last two).
        const foes = wave(), before = foes.map((e) => ({ p: e.root.position.clone(), w: e.windup, c: e.cooldown })); await run(0.6);
        assert(foes.some((e, i) => e.hp <= 0 || e.root.position.distanceTo(before[i].p) > 0.05 || e.windup !== before[i].w || e.cooldown !== before[i].c), 'the wave did not resume after the scan');
        // A meteor or wave can miss a moving shadow; a couple of tries, as a player would.
        const from = hits.length;
        for (let i = 0; i < 3 && !hits.slice(from).some((h) => h.element === 'fire' && h.taken > 0); i++) { await run(8, () => castable(wave())); draw(asked()); await run(1.3); }
        assert(hits.slice(from).some((h) => h.element === 'fire' && h.taken > 0), 'a wand spell after the scan did not burn with fire');
      } finally { window.fetch = realFetch; localStorage.removeItem('storybound.armory.v1'); }
    });

    await check('Sword and wand together clear the wave, and Morwen arrives', async () => {
      const waveFrom = hits.length, waveStart = inner.time;
      await run(90, () => {
        if (inner.demo?.stage !== 'wave') return true;
        const near = wave().sort((x, y) => dist(x) - dist(y))[0];   // walk in with the phone stick, as a player would
        if (near && dist(near) > 2.2) stickToward(near); else stick(0, 0);
        if (castable(wave())) draw(asked());
        if (inner.attackCooldown[0] <= 0 && wave().some((e) => dist(e) < 2.6)) slash();
      });
      stick(0, 0); tally(waveFrom, 'Wave (rest, fire relic)', waveStart);
      assert(inner.demo?.stage === 'boss' || inner.demo?.stage === 'done', `the wave was not cleared (stage ${inner.demo?.stage}, ${wave().length} shadows left)`);
      await awaitMorwen();
    });

    await check('Fire sword and fire wand both hit Morwen\'s weak point for double damage, and she falls', async () => {
      const witch = boss()!; assert(witch.boss?.kind === 'frost-witch', 'the boss is not Morwen');
      const bossFrom = hits.length, bossStart = inner.time;
      const open = () => witch.windup <= 0 && witch.cooldown > 0;
      // Wand: whatever rune she is asked for, drawn while her ward is down and she is close.
      await run(20, () => { if (dist(witch) > 2.2) stickToward(witch); else stick(0, 0); return open() && dist(witch) < 5 && castable([witch]); });
      stick(0, 0);
      const from = hits.length, bolts = inner.bolts.length, wasOpen = open(), d0 = dist(witch); draw(asked()); const fired = inner.bolts.length - bolts; await run(1.2);
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
      // Then a timed wand-only fight from full health (the checks above chipped her): the relic should make it faster, not trivial.
      // Start it the way the no-relic fight starts: the moment her ward drops (she arrives with it down).
      witch.hp = witch.maxHp; await run(10, () => witch.windup > 0); await run(10, () => open());
      const fightFrom = hits.length, fightStart = inner.time;
      await fightMorwen(); tally(fightFrom, `Morwen, fire relic, wand only (${witch.maxHp} hp)`, fightStart);
      assert(!boss(), `Morwen did not fall (hp ${witch.hp} / ${witch.maxHp})`);
      const seconds = inner.time - fightStart; void bossFrom; void bossStart;
      assert(inRange(seconds, FIRE_FIGHT), `with a fire relic Morwen fell in ${seconds.toFixed(1)} s (want ${FIRE_FIGHT[0]}-${FIRE_FIGHT[1]} s)`);
    });

    await check('The closing screen tells the tale of the relic\'s real object, and inputs no longer act', async () => {
      await until(() => !!document.querySelector('.run-result'), 'the closing screen did not appear', 8000);
      const text = document.querySelector('.run-result')?.textContent ?? '';
      assert(text.includes('Quest complete'), 'the run did not end in victory');
      assert(text.includes('coffee mug'), 'the closing screen does not mention the relic\'s object');
      const bolts = inner.bolts.length; slash(); draw('star');
      assert(inner.bolts.length === bolts, 'a wand shape cast after the run ended');
      // Only the element she fears "broke her frost"; ice (which she resists) gets the neutral line, with "an" before a vowel.
      inner.state.relics.push({ hero: 0, object: 'umbrella', name: 'Rimeguard', element: 'ice', ability: 'pierce' });
      const neutral = inner.closingLine(true);
      assert(neutral.includes('An umbrella') && neutral.includes('carried you through') && !neutral.includes('broke her frost'), `wrong closing line for an ice relic: ${neutral}`);
    });
    await check('Keyboard alone (J strike, F bolt) clears the wave of six, and without a relic Morwen takes longer', async () => {
      await boot();
      inner.startWave();
      const waveFrom = hits.length, waveStart = inner.time; let wouldHit = 0; const realHurt = inner.hurt.bind(game);
      inner.hurt = (defer) => { if (game.heroes.length) wouldHit++; realHurt(defer); };
      await run(120, () => {
        if (stage() !== 'wave') return true;
        const near = wave().sort((a, b) => dist(a) - dist(b))[0];
        if (near && dist(near) < 2.6 && inner.attackCooldown[0] <= 0) tap('KeyJ');
        if (inner.spellCooldown[0] <= 0) tap('KeyF');
      });
      tally(waveFrom, `Wave, keyboard only (${wouldHit} attacks reached the hero)`, waveStart);
      assert(stage() === 'boss', `keyboard play did not clear the wave (${wave().length} shadows left)`);
      await awaitMorwen();
      const bossFrom = hits.length, bossStart = inner.time, witch = await fightMorwen();
      tally(bossFrom, `Morwen, no relic, wand only (${witch.maxHp} hp)`, bossStart);
      assert(!boss(), `without a relic Morwen did not fall (hp ${witch.hp})`);
      const seconds = inner.time - bossStart;
      assert(inRange(seconds, PLAIN_FIGHT), `without a relic Morwen fell in ${seconds.toFixed(1)} s (want ${PLAIN_FIGHT[0]}-${PLAIN_FIGHT[1]} s)`);
    });
    await check('A second phone makes hero two a real player (own stick, slash, scan, blue-wand runes), and ?wand=red casts for hero one', async () => {
      await boot();
      // The per-player PhoneInput's surface (on / connected / read), wired through the same adapter the game uses.
      const handlers = new Map<string, ((player: number) => void)[]>(), seated = new Set([0]);
      const sticks = [{ x: 0, z: 0, mag: 0, sprint: false }, { x: 0, z: 0, mag: 0, sprint: false }];
      const phone = { phoneConnected: true, connected: (p: number) => seated.has(p), read: (p = 0) => sticks[p], dispose() {}, phoneUrl: async () => '',
        on: (event: string, h: (player: number) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), h]); return () => {}; } };
      const emit = (event: string, player: number) => (handlers.get(event) ?? []).forEach((h) => h(player));
      (inner as unknown as { phone?: { dispose(): void } }).phone?.dispose(); (inner as unknown as { phone: unknown }).phone = phone;
      listenPlayers(phone, { joined: (slot) => inner.onSeat(slot, true), left: (slot) => inner.onSeat(slot, false), button: (kind, slot) => inner.onPlayerButton(kind, slot) });
      const two = game.heroes[1];
      assert(!two.root.visible, 'hero two should start off-stage in a solo run');
      seated.add(1); emit('joined', 1);
      assert(two.root.visible && two.root.position.distanceTo(game.heroes[0].root.position) < 4 && !inner.companionFree, 'the second phone did not bring hero two in');
      assert((document.querySelector('.weapons-hud')?.textContent ?? '').includes(inner.state.party[1].name), 'the HUD does not show hero two');
      inner.startWave(); let seed = 7; inner.runesTwo.rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      // Each phone's stick moves its own hero.
      const a = game.heroes[0].root.position.clone(), b = two.root.position.clone();
      sticks[0] = { x: 0, z: -1, mag: 1, sprint: false }; sticks[1] = { x: 0, z: 1, mag: 1, sprint: false };   // one forward, one back down the open path
      await run(0.5); sticks[0] = sticks[1] = { x: 0, z: 0, mag: 0, sprint: false };
      const da = game.heroes[0].root.position.clone().sub(a), db = two.root.position.clone().sub(b);
      assert(da.length() > 0.8 && db.length() > 0.8, `a stick did not move its hero (${da.length().toFixed(2)}, ${db.length().toFixed(2)})`);
      assert(da.normalize().dot(db.normalize()) < -0.5, 'the two heroes moved together instead of each by its own phone');
      // Hero two's own rune request, cast with the blue wand.
      await run(0.1);
      const p2 = inner.runesTwo.target; assert(p2, 'hero two got no rune request');
      assert((document.querySelector('.rune-request.p2:not([hidden])')?.textContent ?? '').includes('P2'), 'hero two\'s request is not shown');
      await run(4, () => inner.wandCooldowns.ready(1, p2, inner.time));
      drawAs('blue', (['circle', 'triangle', 'square', 'star'] as WandShape[]).find((x) => x !== p2)!);
      assert(inner.wandCooldowns.ready(1, p2, inner.time) && inner.runesTwo.target === p2, 'a shape hero two was not asked for cast');
      drawAs('blue', p2);
      assert(!inner.wandCooldowns.ready(1, p2, inner.time) && inner.runesTwo.target !== p2, 'the blue wand did not cast hero two\'s requested rune');
      // Phone slash and scan for hero two.
      inner.attackCooldown[1] = 0; emit('slash', 1); assert(inner.attackCooldown[1] > 0, 'player two\'s phone slash did not swing hero two\'s sword');
      emit('scan', 1); await until(() => inner.scanner.open, 'player two\'s phone did not open the scanner');
      assert((inner.scanner as unknown as { claim: number }).claim === 1, 'a scan from player two\'s phone is not offered to hero two');
      tap('Escape'); await until(() => !inner.scanner.open, 'scanner did not close');
      assert(!game.ui.blocked, 'Esc that closed the scanner also opened the journal');
      // The phone leaves: hero two stays, as the companion again.
      seated.delete(1); emit('left', 1);
      assert(two.root.visible && inner.companionFree, 'hero two did not go back to the companion when the phone left');
      // ?wand=red: red is hero one's wand now; yellow is nobody's.
      inner.seats = wandSeats('?wand=red');
      await run(4, () => !!inner.runes.target && inner.wandCooldowns.ready(0, inner.runes.target, inner.time));
      const mine = asked(); drawAs('yellow', mine);
      assert(inner.wandCooldowns.ready(0, mine, inner.time) && inner.runes.target === mine, 'a yellow wand still cast with ?wand=red');
      drawAs('red', mine);
      assert(!inner.wandCooldowns.ready(0, mine, inner.time), `with ?wand=red a red-wand shape did not cast for hero one: ${JSON.stringify({ mine, target: inner.runes.target, seats: inner.seats, busy: inner.busy, ended: inner.ended, scanner: inner.scanner.open, blocked: game.ui.blocked, encounter: inner.encounterKind })}`);
    });
    await check('A jump dodges for 1 s: a shadow strike landing then does nothing, one after it hurts, and jump spam cannot chain it', async () => {
      await boot(); inner.startWave();
      const foes = wave(), foe = foes[0];
      foes.slice(1).forEach((e) => { e.hp = 0; e.root.visible = false; });
      inner.invulnerable = 0; inner.state.hearts = 3;
      const raw = async (seconds: number, until?: () => boolean) => { const end = inner.time + seconds; while (inner.time < end && !until?.()) { step(1 / 60, false); await wait(0); } };
      /** The shadow, right next to the hero, finishes its windup now: a real strike. */
      const strike = async () => {
        const p = game.heroes[0].root.position; foe.root.position.set(p.x + 1.4, p.y, p.z); foe.windup = 0.02; foe.cooldown = 5;
        await raw(0.06);
      };
      await raw(0.5);                                    // settle on the ground
      const hearts = inner.state.hearts;
      inner.leap(0); const jumped = inner.time;
      assert(inner.rollIframes[0] >= 0.99, 'the jump gave no i-frames');
      await raw(1, () => inner.jump[0] === 0 && inner.time - jumped > 0.2);   // land
      assert(inner.time - jumped < 0.95, `the hero took ${(inner.time - jumped).toFixed(2)} s to land`);
      await strike();
      assert(inner.state.hearts === hearts, 'a strike landing inside the jump\'s 1 s hurt the hero');
      await raw(1.2 - (inner.time - jumped));
      await strike();
      assert(inner.state.hearts === hearts - 1, 'a strike after the jump\'s 1 s did no damage');
      inner.invulnerable = 0;                            // as if the hurt flash had passed
      inner.leap(0);
      assert(inner.rollIframes[0] === 0 && inner.invulnerable === 0, 'a second jump inside the guard cooldown refreshed the i-frames');
    });
    status.textContent = `All ${results.children.length} demo-run checks passed. ${metrics.join(' · ')}`; document.body.dataset.result = 'passed';
  } catch (error) { status.textContent = String(error); document.body.dataset.result = 'failed'; console.error(error); }
  finally { running = false; document.querySelector('.run-result')?.remove(); game?.dispose(); }
};
