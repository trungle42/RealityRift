import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

// Transpile a src/adventure module and point its relative imports (and 'three') at loadable URLs, so Fairy.ts runs in node.
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const three = import.meta.resolve('three');
const cache = new Map();
async function load(file) {
  if (cache.has(file)) return cache.get(file);
  let code = ts.transpileModule(await readFile(new URL(`../src/adventure/${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  code = code.replace(/from 'three'/g, `from '${three}'`);
  for (const [, dep] of code.matchAll(/from '\.\/([A-Za-z]+)'/g)) code = code.replaceAll(`'./${dep}'`, `'${await load(`${dep}.ts`)}'`);
  const out = url(code); cache.set(file, out); return out;
}
globalThis.location = { search: '' };
const M = await import(await load('fairyMath.ts'));
const { Fairy, FAIRY_COLOR } = await import(await load('Fairy.ts'));
const T = await import(three);

const flat = () => 0;
const hill = (x) => x * 0.1;
const still = { x: 0, z: 0, mag: 0, sprint: false };
const motion = (over = {}) => ({ x: 0, y: 2, z: 0, heading: 0, dash: 0, dashCooldown: 0, ...over });

test('the fairy stays inside the map and inside its hover band', () => {
  const far = M.clampFairy({ x: 500, y: 90, z: -500 }, flat);
  assert.equal(far.x, M.FAIRY_BOUNDS.maxX); assert.equal(far.z, M.FAIRY_BOUNDS.minZ); assert.equal(far.y, M.HOVER_MAX);
  const low = M.clampFairy({ x: 20, y: -3, z: 0 }, hill);
  assert.equal(low.y, 2 + M.HOVER_MIN, 'the band follows the ground under the fairy');
  for (let t = 0; t < 10; t += 0.37) {
    const m = M.stepFairy(motion({ x: 10, z: 10 }), still, { x: 0, z: 0 }, 0.016, t, hill);
    const ground = hill(m.x);
    assert.ok(m.y >= ground + M.HOVER_MIN - 1e-9 && m.y <= ground + M.HOVER_MAX + 1e-9, `hover ${m.y - ground} outside the band at t=${t}`);
  }
});

test('a pushed stick flies the fairy; sprint is faster; it cannot leave the map', () => {
  const push = { x: 0, z: -1, mag: 1, sprint: false };
  const walked = M.stepFairy(motion(), push, { x: 50, z: 50 }, 0.5, 0, flat);
  assert.ok(Math.abs(walked.z + M.FAIRY_SPEED * 0.5) < 1e-9 && walked.x === 0, 'the stick did not move the fairy forward');
  assert.ok(Math.abs(walked.heading - Math.PI) < 1e-9, 'the fairy does not face where it flies');
  const sprinted = M.stepFairy(motion(), { ...push, sprint: true }, { x: 50, z: 50 }, 0.5, 0, flat);
  assert.ok(sprinted.z < walked.z, 'sprint was not faster');
  let m = motion({ z: M.FAIRY_BOUNDS.minZ + 1 });
  for (let i = 0; i < 100; i++) m = M.stepFairy(m, push, { x: 0, z: 0 }, 0.1, i, flat);
  assert.equal(m.z, M.FAIRY_BOUNDS.minZ, 'the fairy flew off the map');
});

test('without a stick the fairy drifts to hero 0 and circles there', () => {
  let m = motion({ x: 30, z: 30 });
  for (let i = 0; i < 400; i++) m = M.stepFairy(m, still, { x: 0, z: 0 }, 0.02, i * 0.02, flat);
  const d = Math.hypot(m.x, m.z);
  assert.ok(d > M.FOLLOW_RADIUS - 0.5 && d < M.FOLLOW_RADIUS + 0.5, `fairy is ${d.toFixed(2)} m from hero 0`);
});

test('a dash bursts along the heading and has a cooldown', () => {
  let m = M.startDash(motion({ heading: Math.PI / 2 }));
  assert.equal(m.dash, M.DASH_TIME);
  assert.equal(M.startDash(m), m, 'a second dash started during the cooldown');
  const x0 = m.x; m = M.stepFairy(m, still, { x: -60, z: 0 }, 0.1, 0, flat);
  assert.ok(m.x - x0 > M.DASH_SPEED * 0.1 - 1e-9, 'the dash did not burst forward');
});

// Cast routing: a stand-in game that records what Pip asks of it.
function rig({ canAct = true, foe = true, phone } = {}) {
  const calls = { bolts: [], strikes: [], toasts: [] };
  const scene = new T.Scene();
  const enemy = { root: new T.Object3D() }; enemy.root.position.set(0, 0, -8);
  let now = 10;
  const host = {
    now: () => now, hero: () => new T.Vector3(0, 0, 0), canAct: () => canAct,
    target: () => (foe ? enemy : undefined),
    bolt: (start, direction, spell) => calls.bolts.push({ start: start.clone(), direction: direction.clone(), spell }),
    strike: (at, spell) => calls.strikes.push({ at: at.clone(), spell }),
    sparkle: () => {}, toast: (text) => calls.toasts.push(text),
  };
  const pip = new Fairy(scene, host, phone);
  return { pip, calls, enemy, advance: (s) => { now += s; } };
}

test('wand slot 2 shapes cast that shape\'s spell from the fairy, in its own colour', () => {
  const { pip, calls, enemy, advance } = rig();
  assert.equal(pip.active, false, 'Pip shows up before any third player');
  assert.ok(pip.cast('square'));
  assert.ok(pip.active, 'casting did not bring Pip in');
  assert.equal(calls.bolts.length, 3, 'square (wave) should fire a fan of three bolts');
  for (const bolt of calls.bolts) {
    assert.equal(bolt.spell.color, FAIRY_COLOR); assert.equal(bolt.spell.element, undefined);
    assert.ok(bolt.start.distanceTo(pip.root.position) < 1e-6, 'bolts must start at the fairy');
  }
  const middle = calls.bolts[1].direction, toFoe = enemy.root.position.clone().add(new T.Vector3(0, 0.9, 0)).sub(pip.root.position).normalize();
  assert.ok(middle.dot(toFoe) > 0.999, 'the middle bolt does not fly at the nearest foe');
  assert.equal(pip.cast('square'), false, 'the same shape cast again inside its cooldown');
  advance(5);
  assert.ok(pip.cast('triangle'));
  assert.equal(calls.strikes.at(-1).spell.ability, 'meteor');
  assert.ok(calls.strikes.at(-1).at.distanceTo(enemy.root.position) < 1e-6, 'the meteor did not land on the foe');
  advance(5);
  assert.ok(pip.cast('circle'));
  const nova = calls.strikes.at(-1);
  assert.equal(nova.spell.ability, 'nova'); assert.ok(Math.hypot(nova.at.x - pip.root.position.x, nova.at.z - pip.root.position.z) < 1e-6, 'the nova did not burst below Pip');
  advance(5);
  assert.ok(pip.cast('star')); assert.equal(calls.bolts.at(-1).spell.ability, 'chain');
});

test('the fairy holds its spells whenever the heroes must', () => {
  const { pip, calls } = rig({ canAct: false });
  assert.equal(pip.cast('square'), false); assert.equal(pip.pixie(), false);
  assert.equal(calls.bolts.length + calls.strikes.length, 0);
});

test('only phone slot 2 flies the fairy; its seat and buttons bring it in, fire pixie dust and dash', () => {
  const sticks = { 0: { x: 1, z: 0, mag: 1, sprint: false }, 2: { x: 0, z: -1, mag: 1, sprint: false } };
  let slot2 = false;
  const phone = { read: (player = 0) => sticks[player] ?? still, connected: (player) => player === 2 && slot2 };
  const { pip, calls } = rig({ phone });
  assert.equal(pip.stick().mag, 0, 'the fairy read a stick before its phone joined');
  slot2 = true; pip.seat(true);
  assert.ok(pip.active && calls.toasts.length === 1, 'slot 2 joining did not bring Pip in');
  assert.deepEqual(pip.stick(), sticks[2], 'the fairy did not read its own slot');
  const z0 = pip.root.position.z; pip.update(0.25, 0, () => 0);
  assert.ok(pip.root.position.z < z0 - 1, "slot 2's stick did not fly the fairy");
  pip.button('scan'); pip.button('roll'); assert.equal(calls.bolts.length, 0, 'Scan or Roll did something for the fairy');
  pip.button('action'); assert.equal(calls.bolts.length, 1, 'a slot 2 tap did not fire pixie dust');
  assert.equal(calls.bolts[0].spell.ability, 'bolt'); assert.equal(calls.bolts[0].spell.damage, 1); assert.equal(calls.bolts[0].spell.color, FAIRY_COLOR);
  pip.button('action'); assert.equal(calls.bolts.length, 1, 'pixie dust ignored its cooldown');
  pip.button('slash'); assert.ok(pip.motion.dash > 0, 'a slot 2 slash did not dash');
  slot2 = false; pip.seat(false);
  assert.equal(pip.stick().mag, 0, 'the fairy kept reading a phone that left');
});

test('a relay without player slots never moves the fairy (it follows hero 0)', () => {
  const phone = { read: () => ({ x: 1, z: 0, mag: 1, sprint: false }) };
  const { pip } = rig({ phone });
  assert.equal(pip.stick().mag, 0, 'an old relay\'s single stick moved the fairy');
});
