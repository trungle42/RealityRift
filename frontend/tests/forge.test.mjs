import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const load = async (file) => ts.transpileModule(await readFile(new URL(`../src/adventure/${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const W = await import(url(await load('weapon.ts')));
const F = await import(url((await load('forge.ts')).replace("'./weapon'", `'${url(await load('weapon.ts'))}'`)));

const weapon = () => W.makeWeapon({ artifact: { object: 'mug', artifactName: 'Ember Chalice', artifactType: 'chalice', element: 'fire', ability: 'bolt', damage: 70, rarity: 'epic', description: 'Warm.' }, source: 'gemini' });

test('each tracker shape forges a different ability, keeping name, element and damage', () => {
  const abilities = F.WAND_SHAPES.map((shape) => F.reforge(weapon(), shape).ability);
  assert.deepEqual(abilities, ['nova', 'meteor', 'wave', 'chain']);
  const meteor = F.reforge(weapon(), 'triangle');
  assert.equal(meteor.shape, 'triangle');
  assert.deepEqual([meteor.artifactName, meteor.element, meteor.damage], ['Ember Chalice', 'fire', 70]);
  assert.deepEqual(meteor.spell, W.spellFor({ ...weapon(), ability: 'meteor' }));
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
