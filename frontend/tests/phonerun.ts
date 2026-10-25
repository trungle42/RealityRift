import type * as T from 'three';
import { Adventure } from '../src/adventure/Adventure';

// Development-only harness: the demo run played with the phone alone (no keyboard, no mouse) plus the camera tracker.
// Every input arrives as a relay-format message through the real socket handlers: the phone's stick, its tap ("action"),
// its Scan and Roll buttons, and the tracker's state and camera pictures. This file never dispatches a key or a click;
// the game turns a phone tap into its own Enter / E internally. Game time is stepped here, so it passes with the pane hidden.

interface Foe { root: T.Group; hp: number; encounter: boolean; boss?: unknown }
interface Inner {
  demo?: { stage: string }; enemies: Foe[]; time: number; busy: boolean; ended: boolean; invulnerable: number; update(dt: number): void;
  rollTime: number[]; weapons: ({ element: string } | undefined)[];
  scanner: { open: boolean }; phone?: { socket?: WebSocket }; cv?: { socket?: WebSocket; snapshot(): Promise<unknown> }; rig: { viewYaw: number };
}

const status = document.querySelector('#status')!, results = document.querySelector('#results')!;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
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
  // Keys and clicks would defeat the point: count any that reach the window from outside the game.
  let outsideInput = 0; const count = (event: Event) => { if (event.isTrusted) outsideInput++; };
  for (const type of ['keydown', 'pointerdown', 'click']) window.addEventListener(type, count, true);

  const deliver = (socket: WebSocket | undefined, message: unknown) => { assert(socket?.onmessage, 'input socket has no message handler'); socket.onmessage.call(socket, new MessageEvent('message', { data: JSON.stringify(message) })); };
  const phone = (message: unknown) => deliver(inner.phone?.socket, message);
  const stick = (x: number, y: number) => phone({ type: 'move', x, y });
  const tapPhone = () => phone({ type: 'action' });
  const hero = () => game.heroes[0].root.position;
  const stage = () => inner.demo?.stage;
  const paused = () => game.ui.blocked || inner.busy || inner.ended || inner.scanner.open;
  const step = (dt = 1 / 60) => { inner.invulnerable = 60; if (paused()) return; inner.time += dt; game.heroes.forEach((h) => h.update(dt, inner.time)); inner.update(dt); };
  const run = async (seconds: number, each?: () => boolean | void) => {
    const end = inner.time + seconds;
    for (let i = 0; inner.time < end; i++) { if (each?.() === true) return; step(); if (i % 20 === 19) await wait(0); if (paused()) await wait(5); }
  };
  // A fake tracker: state frames and a camera picture, as cv_2's tools.publish sends them.
  const paint = document.createElement('canvas'); paint.width = 64; paint.height = 48;
  const pen = paint.getContext('2d')!; pen.fillStyle = '#c8a040'; pen.fillRect(0, 0, 64, 48);
  const jpeg = paint.toDataURL('image/jpeg', 0.9).split(',')[1];
  const tracker = () => {
    deliver(inner.cv?.socket, { type: 'cv', slash: 0, jump: 0, motion: 0, phone: { x: 0.3, y: 0.6, radius: 0.05 }, wands: { yellow: { x: 0.6, y: 0.4, radius: 0.03 } }, wand: { active: true, secondsLeft: 0, target: null, next: null, shapes: {}, complete: {}, traces: {} } });
    deliver(inner.cv?.socket, { type: 'frame', w: 64, h: 48, jpeg });
  };

  try {
    await check('The start screen shows a QR code for the phone, and one tap on the phone starts the game', async () => {
      game = new Adventure(); inner = game as unknown as Inner;
      const started = game.start();
      await until(() => !!document.querySelector('.adventure-start form') && !!inner.phone?.socket, 'models did not finish loading', 20000);
      await until(() => !!document.querySelector('.start-phone svg path'), 'the start screen has no QR code for the phone');
      phone({ type: 'peer', role: 'phone', state: 'joined' });
      await until(() => /Phone connected/.test(document.querySelector('.start-phone')?.textContent ?? ''), 'the start screen did not notice the phone');
      tapPhone();
      await started;
      assert(!document.querySelector('.adventure-start'), 'a phone tap did not start the game');
      game.renderer.setAnimationLoop(null);
      deliver(inner.cv?.socket, { type: 'peer', role: 'tracker', state: 'joined' }); tracker();
    });

    await check('The stick walks to Willow; taps talk to her, read her briefing, accept the quest, and the wave begins', async () => {
      assert(stage() === 'briefing', 'the game did not open in the demo run');
      assert(/tap your phone/.test(document.body.textContent ?? ''), 'the quest hint does not tell a phone player to tap');
      const from = hero().clone();
      await run(8, () => { stick(0, 1); return Math.hypot(hero().x - from.x, hero().z - from.z) > 2.6; });
      stick(0, 0);
      tapPhone(); await until(() => inner.busy, 'a tap next to Willow did not start her briefing');
      for (let i = 0; i < 80 && stage() === 'briefing'; i++) { tapPhone(); await wait(40); }
      assert(stage() === 'wave' && !inner.busy, 'phone taps did not get through the briefing into the wave');
      await run(0.5);
      assert(inner.enemies.some((e) => e.hp > 0 && e.encounter && !e.boss), 'no shadows arrived');
    });

    await check("Scan opens the rift on the tracker's picture; taps take the photo, then take the relic", async () => {
      const realFetch = window.fetch, realSnapshot = inner.cv!.snapshot, media = navigator.mediaDevices, realCamera = media.getUserMedia;
      let webcam = 0; media.getUserMedia = async () => { webcam++; throw new Error('the scanner opened the webcam'); };
      inner.cv!.snapshot = async () => ({ jpeg, w: 64, h: 48 });
      window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => String(url).endsWith('/api/artifact')
        ? new Response(JSON.stringify({ artifact: { object: 'coffee mug', artifactName: 'Ember Chalice', artifactType: 'chalice', element: 'fire', ability: 'bolt', damage: 70, rarity: 'epic', description: 'Still warm.' }, source: 'gemini' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : realFetch(url, init)) as typeof fetch;
      try {
        tracker(); phone({ type: 'scan' });
        await until(() => inner.scanner.open, 'the Scan button did not open the scanner');
        await until(() => (document.querySelector<HTMLImageElement>('.rift-scan img.rift-video')?.src ?? '').startsWith('data:image/jpeg'), "the scan screen did not show the tracker's picture");
        tapPhone(); await until(() => !!document.querySelector('.relic-card'), 'a tap did not take the photo', 8000);
        tapPhone(); await until(() => !inner.scanner.open, 'a tap on the relic card did not take the relic');
        assert(inner.weapons[0]?.element === 'fire' && webcam === 0, 'the relic was not equipped, or the webcam was opened');
      } finally { window.fetch = realFetch; inner.cv!.snapshot = realSnapshot; media.getUserMedia = realCamera; }
    });

    await check('Roll rolls, and nothing in this run needed a key or a click', async () => {
      phone({ type: 'roll' }); assert(inner.rollTime[0] > 0, 'the Roll button did not roll');
      await run(1);
      assert(outsideInput === 0, `${outsideInput} real key / pointer event(s) reached the game`);
    });

    await check('Three phones: each has its own stick and buttons; only player 1 drives the old single-phone path', async () => {
      const input = inner.phone as unknown as import('../src/adventure/PhoneInput').PhoneInput;
      const heard: string[] = [];
      const stop = (['slash', 'action', 'roll', 'joined', 'left'] as const).map((event) => input.on(event, (player) => heard.push(`${event}:${player}`)));
      const rolls = inner.rollTime[0];
      for (const player of [1, 2]) phone({ type: 'peer', role: 'phone', state: 'joined', player });
      assert(input.players().join() === '0,1,2' && input.connected(2), `players ${input.players().join()}`);
      phone({ type: 'move', x: 1, y: 0, player: 1 }); phone({ type: 'move', x: 0, y: 1, player: 2 });
      assert(input.read(1).x > 0.9 && input.read(2).z < -0.9 && input.read(0).mag === 0, 'the sticks are not kept per player');
      phone({ type: 'slash', player: 2 }); phone({ type: 'roll', player: 1 }); phone({ type: 'slash', player: 7 });
      assert(inner.rollTime[0] === rolls, "player 2's Roll rolled player 1's hero");
      phone({ type: 'peer', role: 'phone', state: 'left', player: 1 });
      assert(input.phoneConnected && !input.connected(1) && input.read(1).mag === 0, 'one phone leaving disconnected the others');
      assert(heard.join() === 'joined:1,joined:2,slash:2,roll:1,left:1', `events: ${heard.join()}`);
      stop.forEach((off) => off());
    });

    status.textContent = `All ${results.children.length} phone-only checks passed.`;
  } catch (error) {
    status.textContent = `Error: ${String(error)}`;
  } finally {
    for (const type of ['keydown', 'pointerdown', 'click']) window.removeEventListener(type, count, true);
    running = false;
  }
};
