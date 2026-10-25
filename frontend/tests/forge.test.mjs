import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const load = async (file) => ts.transpileModule(await readFile(new URL(`../src/adventure/${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const W = await import(url(await load('weapon.ts')));
const F = await import(url((await load('forge.ts')).replace("'./weapon'", `'${url(await load('weapon.ts'))}'`)));

const weapon = () => W.makeWeapon({ artifact: { object: 'mug', artifactName: 'Ember Chalice', artifactType: 'chalice', element: 'fire', ability: 'bolt', damage: 70, rarity: 'epic', description: 'Warm.' }, source: 'gemini' });

test('each shape casts its own spell even with no relic: arcane colour, no element, tier 1', () => {
  const spells = F.WAND_SHAPES.map((shape) => W.wandSpell(F.SHAPE_ABILITY[shape]));
  assert.deepEqual(spells.map((s) => s.ability), ['nova', 'meteor', 'wave', 'chain']);
  assert.ok(spells.every((s) => s.element === undefined && s.color === W.ARCANE_COLOR));
  assert.deepEqual(spells.map((s) => s.damage), [1, 2, 1, 1]);
});

test('a relic infuses the drawn spell with its element, colour and power tier', () => {
  const relic = weapon();
  const meteor = W.wandSpell('meteor', relic), wave = W.wandSpell('wave', relic);
  assert.deepEqual([meteor.element, meteor.color], ['fire', W.ELEMENT_COLOR.fire]);
  assert.equal(wave.damage, W.relicTier(relic));
  assert.equal(meteor.damage, W.relicTier(relic) + 1);
  assert.equal(W.relicTier({ damage: 20, rarity: 'common' }), 1);
  assert.equal(W.relicTier({ damage: 50, rarity: 'legendary' }), 3);
  assert.equal(W.relicTier({ damage: 90, rarity: 'legendary' }), 3);
  // F's bolt keeps the hero's colour without a relic and takes the relic's element with one.
  assert.deepEqual([W.wandSpell('bolt', undefined, 0x123456).color, W.wandSpell('bolt', relic).element], [0x123456, 'fire']);
});

test('each hero and shape has its own cooldown on the game clock', () => {
  const cd = new F.ShapeCooldowns();
  assert.ok(cd.ready(0, 'triangle', 10));
  cd.use(0, 'triangle', 10);
  assert.ok(!cd.ready(0, 'triangle', 10 + F.SHAPE_COOLDOWN.triangle - 0.01));
  assert.ok(cd.ready(0, 'circle', 10) && cd.ready(1, 'triangle', 10), 'other shapes and the other hero stay ready');
  assert.ok(cd.ready(0, 'triangle', 10 + F.SHAPE_COOLDOWN.triangle));
  assert.ok(Object.values(F.SHAPE_COOLDOWN).every((s) => s >= 1 && s <= 3));
});

test('yellow is hero one, blue hero two (not in solo), red never', () => {
  assert.equal(F.heroFor('yellow', true), 0);
  assert.equal(F.heroFor('blue', false), 1);
  assert.equal(F.heroFor('blue', true), undefined);
  assert.equal(F.heroFor('red', false), undefined);
});

test('only tracker colours are wand colours', () => {
  assert.deepEqual(['yellow', 'blue', 'red', 'green', ''].map(F.colourOf), ['yellow', 'blue', 'red', undefined, undefined]);
});

test('a completed wand reports its shape; incomplete or malformed wand state is ignored', () => {
  const wand = (over) => ({ active: true, target: 'square', complete: { yellow: true, blue: false }, shapes: { yellow: { shape: 'square', score: 0.1 }, blue: null }, ...over });
  assert.equal(F.shapeFromWand('yellow', wand()), 'square');
  assert.equal(F.shapeFromWand('yellow', wand({ shapes: {} })), 'square');
  assert.equal(F.shapeFromWand('blue', wand()), undefined);
  for (const bad of [null, 'x', {}, wand({ target: 'hexagon', shapes: {} }), wand({ shapes: { yellow: { shape: 'blob' } }, target: undefined })]) assert.equal(F.shapeFromWand('yellow', bad), undefined);
});

test('the keyboard stand-in emits the same events as the tracker', () => {
  const target = new EventTarget(), seen = [];
  const source = new F.KeyboardShapes(target); const stop = source.subscribe((c, s) => seen.push(`${c}:${s}`));
  const press = (code, repeat = false) => { const e = new Event('keydown'); Object.assign(e, { code, repeat }); target.dispatchEvent(e); };
  press('Digit5'); press('Minus'); press('Digit5', true); press('KeyA');
  stop(); press('Digit4'); source.dispose();
  assert.deepEqual(seen, ['yellow:triangle', 'blue:star']);
});
