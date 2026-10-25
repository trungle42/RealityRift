import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/adventure/presenceMath.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const P = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const state = (over = {}) => ({ x: 0, y: 0, z: 0, heading: 0, speed: 0, anim: 'idle', hp: 3, ...over });
const local = (over = {}) => ({ dead: false, stagger: 0, roll: -1, airborne: false, casting: false, attack: 0, pose: '', speed: 0, ...over });

test('relay messages are parsed exactly as the contract says; numeric ids become strings', () => {
  assert.deepEqual(P.parsePresence({ type: 'welcome', id: 1, peers: [{ id: 0, name: 'Trung', colour: 'red' }] }), { type: 'welcome', id: '1', peers: [{ id: '0', name: 'Trung', colour: 'red' }], started: false });
  assert.equal(P.parsePresence({ type: 'welcome', id: 1, peers: [], started: true }).started, true);
  assert.deepEqual(P.parsePresence({ type: 'start', id: 2 }), { type: 'start', id: '2' });
  assert.deepEqual(P.parsePresence({ type: 'hit', id: 0, enemy: 'e3', damage: 2 }), { type: 'hit', id: '0', enemy: 'e3', damage: 2 });
  assert.deepEqual(P.parsePresence({ type: 'foes', id: 0, f: [['e0', 1, 2, 0.5, 1, 2], ['e1', 3, 4, 0, 0, 9]] }).foes, [{ id: 'e0', x: 1, z: 2, h: 0.5, w: true, a: 2 }, { id: 'e1', x: 3, z: 4, h: 0, w: false, a: 0 }]);
  assert.equal(P.parsePresence({ type: 'foes', id: 0, f: [['e0', 'x', 2, 0, 0, 0]] }), undefined);
  for (const bad of [{ type: 'hit', id: 0, enemy: 'E<3', damage: 2 }, { type: 'hit', id: 0, enemy: 'e3', damage: -1 }, { type: 'hit', id: 0, enemy: 'e3' }, { type: 'start' }]) assert.equal(P.parsePresence(bad), undefined, JSON.stringify(bad));
  assert.deepEqual(P.parsePresence({ type: 'peer', state: 'left', id: 2, name: 'haicil', colour: 'yellow' }), { type: 'peer', state: 'left', peer: { id: '2', name: 'haicil', colour: 'yellow' } });
  assert.deepEqual(P.parsePresence({ type: 'state', id: 0, x: 1, y: 2, z: 3, heading: 0.5, speed: 4, anim: 'run', hp: 3 }), { type: 'state', id: '0', state: { x: 1, y: 2, z: 3, heading: 0.5, speed: 4, anim: 'run', hp: 3 } });
  assert.deepEqual(P.parsePresence({ type: 'fx', id: 0, kind: 'cast', x: 1, y: 0, z: 2, dx: 0, dz: -1, ability: 'nova', element: 'fire' }).fx, { kind: 'cast', ability: 'nova', element: 'fire', x: 1, y: 0, z: 2, dx: 0, dz: -1 });
  assert.deepEqual(P.parsePresence({ type: 'full' }), { type: 'full' });
  assert.deepEqual(P.parsePresence({ type: 'replaced' }), { type: 'replaced' });
});

test('malformed or unknown messages are ignored, never thrown', () => {
  for (const bad of [null, 7, 'x', {}, { type: 'state', id: 0, x: NaN, y: 0, z: 0, heading: 0 }, { type: 'state', x: 1, y: 2, z: 3, heading: 0 },
    { type: 'fx', id: 0, kind: 'boom', x: 0, y: 0, z: 0, dx: 0, dz: 0 }, { type: 'peer', state: 'maybe', id: 1 }, { type: 'enemy', id: 0 }, { type: 'welcome' }]) {
    assert.equal(P.parsePresence(bad), undefined, JSON.stringify(bad));
  }
  assert.equal(P.parsePresence({ type: 'state', id: 0, x: 0, y: 0, z: 0, heading: 0, anim: 'moonwalk' }).state.anim, 'idle', 'an unknown anim did not fall back to idle');
  assert.deepEqual(P.parsePresence({ type: 'welcome', id: 1, peers: [{ id: 1, name: 'me', colour: 'red' }, { name: 'no id' }] }).peers, [], 'welcome listed this player or an id-less peer');
});

test('the anim other players see: the most specific thing wins', () => {
  assert.equal(P.animOf(local()), 'idle');
  assert.equal(P.animOf(local({ speed: 3 })), 'walk');
  assert.equal(P.animOf(local({ speed: 7 })), 'run');
  assert.equal(P.animOf(local({ speed: 7, attack: 0.3 })), 'strike');
  assert.equal(P.animOf(local({ attack: 0.3, casting: true })), 'cast');
  assert.equal(P.animOf(local({ casting: true, airborne: true })), 'jump');
  assert.equal(P.animOf(local({ airborne: true, roll: 0.4 })), 'roll');
  assert.equal(P.animOf(local({ roll: 0.4, stagger: 0.2 })), 'hurt');
  assert.equal(P.animOf(local({ stagger: 0.2, dead: true })), 'dead');
  assert.equal(P.animOf(local({ pose: 't-pose', speed: 3 })), 'pose');
  for (const anim of ['idle', 'walk', 'run', 'strike', 'roll', 'jump', 'cast', 'hurt', 'dead', 'pose']) assert.ok(P.ANIMS.includes(anim));
});

test('snapshots are blended 100 ms in the past, holding at either end', () => {
  const b = new P.SnapshotBuffer();
  assert.equal(b.sample(1), undefined);
  b.push(state({ x: 0, z: 0, heading: 0, anim: 'walk' }), 1.0);
  b.push(state({ x: 10, z: -4, heading: 1, anim: 'run' }), 1.2);
  const mid = b.sample(1.2); // renders t = 1.1, halfway
  assert.ok(Math.abs(mid.x - 5) < 1e-9 && Math.abs(mid.z + 2) < 1e-9 && Math.abs(mid.heading - 0.5) < 1e-9, JSON.stringify(mid));
  assert.equal(b.sample(1.05).x, 0, 'before the first snapshot it should hold the oldest');
  assert.equal(b.sample(9).x, 10, 'past the newest it should hold, not extrapolate');
  assert.equal(b.sample(9).anim, 'run');
  b.push(state({ x: 99 }), 1.1); assert.equal(b.size, 2, 'an out-of-order snapshot was kept');
  for (let i = 0; i < 50; i++) b.push(state({ x: i }), 2 + i * 0.08);
  assert.equal(b.size, P.BUFFER_SIZE, 'the buffer grew without bound');
});

test('heading blends the short way round', () => {
  const b = new P.SnapshotBuffer();
  b.push(state({ heading: Math.PI - 0.1 }), 0); b.push(state({ heading: -Math.PI + 0.1 }), 0.2);
  const h = P.wrapAngle(b.sample(0.2).heading);
  assert.ok(Math.abs(Math.abs(h) - Math.PI) < 1e-6, `heading swung the long way: ${h}`);
});

test('presence is off without ?presence; the URL is built and cleaned for the relay', () => {
  assert.equal(P.presenceConfig(''), null);
  assert.equal(P.presenceConfig('?presence=http://nope'), null);
  const c = P.presenceConfig('?presence=wss://words.trycloudflare.com/&room=rift!&name=Tr%C3%BCng%3Cb%3E%20Le&wand=red,blue,yellow');
  assert.equal(c.url, 'wss://words.trycloudflare.com/ws/presence/rift?name=Trngb%20Le&colour=red');
  assert.equal(c.name, 'Trngb Le', 'characters the relay refuses were not stripped');
  assert.equal(c.colour, 'red'); assert.equal(c.room, 'rift');
  const d = P.presenceConfig('?wand=green', 'ws://localhost:8000');
  assert.equal(d.url, 'ws://localhost:8000/ws/presence/storybound?name=Player&colour=yellow', 'a bad colour or empty name was sent to the relay');
  assert.ok(P.presenceConfig(`?presence=ws://h&name=${'x'.repeat(40)}`).name.length <= 16);
});
