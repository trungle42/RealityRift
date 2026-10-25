import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/adventure/cvMath.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseCv, parsePicture, setupHint, NEAR_WAND, newEvents, newlyComplete, bodyMoving, completedShape, wandPrompt, POSE_SHAPE, FREEZE_MOTION, CV_STALE_SECONDS } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD' + 'A'.repeat(64) + '==';

const WAND = { active: true, secondsLeft: 3.2, target: 'circle', next: 'triangle', shapes: { yellow: null }, complete: { yellow: false }, traces: { yellow: [] } };
const frame = (extra = {}) => ({ type: 'cv', slash: 2, jump: 1, motion: 0.04, wand: WAND, ...extra });

test('a solo player gets one setup hint at a time', () => {
  const at = { x: 0.5, y: 0.5, radius: 0.03 }, tape = { x: 0.2, y: 0.6, radius: 0.06 };
  assert.equal(setupHint({ wands: { yellow: at }, phone: tape }), '');
  assert.equal(setupHint({ wands: { yellow: null }, phone: tape }), 'Yellow wand not seen');
  assert.equal(setupHint({ wands: { yellow: at }, phone: null }), 'Phone tape not seen');
  assert.equal(setupHint({ wands: {}, phone: null }), 'Wand and phone tape not seen');
  assert.equal(setupHint({ wands: { yellow: { ...at, radius: NEAR_WAND + 0.01 } }, phone: tape }), 'Step back a little');
  assert.equal(setupHint(undefined), '');
});
test('a relay frame parses into counts, motion, the phone marker and the wand round', () => {
  assert.deepEqual(parseCv(frame()), { slash: 2, jump: 1, motion: 0.04, phone: null, wands: {}, wand: WAND });
  assert.deepEqual(parseCv(frame({ wands: { yellow: { x: 0.5, y: 0.5, radius: 0.04 }, blue: 'x' } })).wands, { yellow: { x: 0.5, y: 0.5, radius: 0.04 }, blue: null });
  assert.deepEqual(parseCv(frame({ phone: { x: 0.2, y: 0.6, radius: 0.07 } })).phone, { x: 0.2, y: 0.6, radius: 0.07 });
  for (const phone of ['x', { x: 2, y: 0.5, radius: 0.1 }, { x: 0.5, y: 0.5 }]) assert.equal(parseCv(frame({ phone })).phone, null);
});
test('camera pictures parse only as base64 JPEG of their own type', () => {
  assert.deepEqual(parsePicture({ type: 'frame', w: 224, h: 168, jpeg: JPEG }, 'frame'), { jpeg: JPEG, w: 224, h: 168 });
  assert.deepEqual(parsePicture({ type: 'snapshot', id: 3, w: 512, h: 384, jpeg: JPEG }, 'snapshot'), { jpeg: JPEG, w: 512, h: 384, id: 3 });
  for (const bad of [null, { type: 'frame', w: 224, h: 168, jpeg: 'iVBORw0KGgo=' }, { type: 'frame', w: 0, h: 168, jpeg: JPEG }, { type: 'frame', w: 224, h: 168, jpeg: '/9j/"><script>' },
    { type: 'snapshot', w: 224, h: 168, jpeg: JPEG }, { type: 'cv', w: 224, h: 168, jpeg: JPEG }]) {
    assert.equal(parsePicture(bad, bad?.type === 'snapshot' ? 'snapshot' : 'frame'), undefined);
  }
  assert.equal(parsePicture({ type: 'frame', w: 224, h: 168, jpeg: JPEG }, 'snapshot'), undefined);
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
test('a completed shape is what the wand drew, else the asked-for target', () => {
  const wand = { ...WAND, target: null, shapes: { yellow: { shape: 'star', score: 0.1 }, blue: null }, complete: { yellow: true, blue: true } };
  assert.equal(completedShape(wand, 'yellow'), 'star');
  assert.equal(completedShape({ ...wand, target: 'square' }, 'blue'), 'square');
  assert.equal(completedShape(wand, 'blue'), undefined);
});
test('every pose seal has a distinct wand rune', () => {
  const runes = ['arms-up', 't-pose', 'crouch'].map((pose) => POSE_SHAPE[pose]);
  assert.deepEqual(runes, ['triangle', 'square', 'circle']);
});
test('the wand panel says what to draw', () => {
  assert.equal(wandPrompt({ ...WAND, target: null }), 'Hold still, then draw a shape');
  assert.equal(wandPrompt({ ...WAND, target: 'triangle' }), 'Draw a triangle');
  assert.equal(wandPrompt({ ...WAND, active: false }), '');
  assert.equal(wandPrompt(undefined), '');
});
