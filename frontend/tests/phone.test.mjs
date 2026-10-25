import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/adventure/phoneMath.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseStick, currentStick, NO_STICK, STICK_DEADZONE, STICK_STALE_SECONDS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test('pushing the stick up is forward, the same as pressing W (negative z)', () => {
  const s = parseStick({ type: 'move', x: 0, y: 1 });
  near(s.x, 0); near(s.z, -1); near(s.mag, 1);
});
test('right is +x and down is +z', () => {
  const r = parseStick({ type: 'move', x: 1, y: 0 }); near(r.x, 1); near(r.z, 0);
  const d = parseStick({ type: 'move', x: 0, y: -1 }); near(d.z, 1);
});
test('direction is exact on diagonals (no widening, no axis weighting)', () => {
  const s = parseStick({ type: 'move', x: 0.5, y: 0.5 });
  near(Math.hypot(s.x, s.z), 1); near(s.x, -s.z);
});
test('inside the deadzone nothing moves, and speed ramps from zero at its edge', () => {
  assert.deepEqual(parseStick({ type: 'move', x: STICK_DEADZONE * 0.9, y: 0 }), { x: 0, z: 0, mag: 0, sprint: false });
  near(parseStick({ type: 'move', x: STICK_DEADZONE + 1e-6, y: 0 }).mag, 0, 1e-4);
  near(parseStick({ type: 'move', x: 1, y: 0 }).mag, 1);
});
test('sprint needs the flag AND a full push', () => {
  assert.equal(parseStick({ type: 'move', x: 1, y: 0, sprint: true }).sprint, true);
  assert.equal(parseStick({ type: 'move', x: 0.4, y: 0, sprint: true }).sprint, false);
  assert.equal(parseStick({ type: 'move', x: 1, y: 0, sprint: 'yes' }).sprint, false);
});
test('malformed messages are ignored', () => {
  for (const bad of [null, undefined, 5, 'x', {}, { type: 'cast' }, { type: 'move', x: 'a', y: 0 }, { type: 'move', x: NaN, y: 0 }, { type: 'move', x: 0, y: Infinity }]) assert.equal(parseStick(bad), undefined);
});
test('a stale stick counts as released so the hero cannot run away on a dropped connection', () => {
  const s = parseStick({ type: 'move', x: 0, y: 1 });
  assert.equal(currentStick(s, 10, 10 + STICK_STALE_SECONDS - 0.01), s);
  assert.equal(currentStick(s, 10, 10 + STICK_STALE_SECONDS + 0.01), NO_STICK);
  assert.equal(currentStick(undefined, 0, 1), NO_STICK);
});
