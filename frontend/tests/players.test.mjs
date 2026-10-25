import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const load = async (file) => ts.transpileModule(await readFile(new URL(`../src/adventure/${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const P = await import(url((await load('players.ts')).replace("'./phoneMath'", `'${url(await load('phoneMath.ts'))}'`)));

/** The per-player PhoneInput's surface: on(event, handler(player)), connected(player), read(player). */
function perPlayerPhone() {
  const handlers = new Map(), sticks = [{ x: 0, z: -1, mag: 1, sprint: false }, { x: 1, z: 0, mag: 0.5, sprint: false }];
  const seated = new Set([0]);
  return {
    seated, emit: (event, player) => (handlers.get(event) ?? []).forEach((h) => h(player)),
    on: (event, handler) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); return () => handlers.set(event, handlers.get(event).filter((h) => h !== handler)); },
    connected: (player) => seated.has(player), read: (player = 0) => sticks[player],
  };
}

test('every slot is heard; player 0 only sends its slash here (its other buttons come through onCommand)', () => {
  const phone = perPlayerPhone(), seen = [];
  const off = P.listenPlayers(phone, { joined: (s) => seen.push(`joined ${s}`), left: (s) => seen.push(`left ${s}`), button: (k, s) => seen.push(`${k} ${s}`) });
  phone.emit('joined', 1); phone.emit('action', 0); phone.emit('scan', 0); phone.emit('slash', 0); phone.emit('slash', 1); phone.emit('roll', 2); phone.emit('scan', 7); phone.emit('left', 1);
  assert.deepEqual(seen, ['joined 1', 'slash 0', 'slash 1', 'roll 2', 'left 1']);
  off(); phone.emit('slash', 1); assert.equal(seen.length, 5, 'unsubscribed');
});

test('the single-phone PhoneInput (no on / connected) is left exactly as before', () => {
  const old = { phoneConnected: true, read: () => ({ x: 0, z: -1, mag: 1, sprint: false }) };
  assert.doesNotThrow(() => P.listenPlayers(old, { joined() { throw new Error('no'); }, left() {}, button() {} })());
  assert.equal(P.slotConnected(old, 0), true);
  assert.equal(P.slotConnected(old, 1), false);
  assert.deepEqual(P.stickOf(old, 1), { x: 0, z: 0, mag: 0, sprint: false }, 'hero two never reads the only phone');
});

test('hero two reads its own stick only while a slot-1 phone is connected', () => {
  const phone = perPlayerPhone();
  assert.equal(P.stickOf(phone, 1).mag, 0);
  phone.seated.add(1);
  assert.deepEqual(P.stickOf(phone, 1), { x: 1, z: 0, mag: 0.5, sprint: false });
  assert.equal(P.stickOf(phone, 0).z, -1);
  assert.equal(P.stickOf(undefined, 0).mag, 0);
});
