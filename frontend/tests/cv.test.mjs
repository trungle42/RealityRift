import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/adventure/cvMath.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseCv, newEvents, newlyComplete, bodyMoving, FREEZE_MOTION, CV_STALE_SECONDS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const WAND = { active: true, secondsLeft: 3.2, target: 'circle', next: 'triangle', shapes: { yellow: null }, complete: { yellow: false }, traces: { yellow: [] } };
const frame = (extra = {}) => ({ type: 'cv', slash: 2, jump: 1, motion: 0.04, wand: WAND, ...extra });

test('a relay frame parses into counts, motion and the wand round', () => {
  assert.deepEqual(parseCv(frame()), { slash: 2, jump: 1, motion: 0.04, wand: WAND });
});
test('motion is null when missing and clamped to 0-1', () => {
  assert.equal(parseCv(frame({ motion: null })).motion, null);
  assert.equal(parseCv(frame({ motion: 'x' })).motion, null);
  assert.equal(parseCv(frame({ motion: 3 })).motion, 1);
});
test('a malformed wand block is dropped but the counts survive', () => {
  for (const wand of [null, 'x', { active: 'yes' }, { ...WAND, shapes: [] }]) {
    const f = parseCv(frame({ wand }));
    assert.equal(f.wand, null); assert.equal(f.slash, 2);
  }
});
test('anything that is not a tracker frame is ignored', () => {
  for (const bad of [null, 5, 'x', {}, { type: 'move', x: 1, y: 0 }, { type: 'peer', role: 'tracker' }, frame({ slash: -1 }), frame({ slash: 1.5 }), frame({ jump: '2' }), frame({ slash: NaN })]) assert.equal(parseCv(bad), undefined);
});
test('an event is the count going up; the first count and a restart are a baseline', () => {
  assert.equal(newEvents(undefined, 7), 0);
  assert.equal(newEvents(7, 7), 0);
  assert.equal(newEvents(7, 8), 1);
  assert.equal(newEvents(7, 9), 2);
  assert.equal(newEvents(7, 0), 0);
});
test('a colour completes once, when its flag turns true', () => {
  assert.deepEqual(newlyComplete({ yellow: false, blue: false }, { yellow: true, blue: false }), ['yellow']);
  assert.deepEqual(newlyComplete({ yellow: true }, { yellow: true }), []);
  assert.deepEqual(newlyComplete(undefined, { yellow: true }), []);           // joining mid-round is not a completion
  assert.deepEqual(newlyComplete({ yellow: true }, { yellow: false }), []);   // the round ended
});
test('only fresh motion above the threshold counts as moving', () => {
  assert.equal(bodyMoving(FREEZE_MOTION, 10, 10), true);
  assert.equal(bodyMoving(FREEZE_MOTION - 0.01, 10, 10), false);
  assert.equal(bodyMoving(0.5, 10, 10 + CV_STALE_SECONDS + 0.01), false);
  assert.equal(bodyMoving(null, 10, 10), false);
  assert.equal(bodyMoving(undefined, -Infinity, 0), false);
});
