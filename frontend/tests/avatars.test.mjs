import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

// avatars.ts imports three and its SkeletonUtils; point those at the installed package so the pure helpers load in node.
let code = ts.transpileModule(await readFile(new URL('../src/adventure/avatars.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
code = code.replace("from 'three/addons/utils/SkeletonUtils.js'", `from '${import.meta.resolve('three/addons/utils/SkeletonUtils.js')}'`).replace("from 'three'", `from '${import.meta.resolve('three')}'`);
const A = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('each wand colour wears its own avatar; anything else is the ranger', () => {
  assert.equal(A.avatarFor('red'), 'crimson'); assert.equal(A.modelOf('crimson'), 'ranger');
  assert.equal(A.avatarFor('blue'), 'royal'); assert.equal(A.modelOf('royal'), 'maiden');
  assert.equal(A.avatarFor('yellow'), 'gold'); assert.equal(A.modelOf('gold'), 'ranger');
  for (const other of [undefined, '', 'green', 'Red']) assert.equal(A.avatarFor(other), 'ranger', String(other));
  assert.equal(new Set(['red', 'blue', 'yellow'].map(A.avatarFor)).size, 3, 'two colours share a look');
});

test("this laptop's colour is the first ?wand= colour, and only an explicit one picks a look", () => {
  assert.equal(A.localColour('?wand=blue,red,yellow'), 'blue');
  assert.equal(A.localColour('?wand=Yellow'), 'yellow');
  assert.equal(A.localColour(''), undefined, 'a plain link changed the default look');
  assert.equal(A.localColour('?wand=green,blue'), undefined);
  assert.equal(A.avatarFor(A.localColour('')), 'ranger');
});

test('the ranger borrows exactly the sword clips the shieldmaiden has natively', () => {
  assert.deepEqual(A.COMBAT_CLIPS, ['sword_idle', 'sword_slash_horizontal', 'sword_slash_overhead', 'sword_thrust', 'stagger_back']);
});

const px = (...rgb) => new Uint8ClampedArray([...rgb, 255]);
const hueOf = ([r, g, b]) => { const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; return d === 0 ? NaN : ((max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60); };
const valueOf = ([r, g, b]) => Math.max(r, g, b);

test('the ranger dyes recolour only the green cloak and keep its light and shade', () => {
  for (const [look, lo, hi] of [['crimson', 330, 360], ['gold', 30, 50]]) {
    const dark = px(30, 52, 28), light = px(70, 120, 60);
    A.dyePixels(dark, A.DYES[look]); A.dyePixels(light, A.DYES[look]);
    for (const c of [dark, light]) { const h = hueOf(c); assert.ok((h >= lo && h <= hi) || (lo > 300 && h < 5), `${look} gave hue ${h}`); }
    assert.ok(valueOf(light) > valueOf(dark) + 40, `${look} flattened the folds`);
    for (const untouched of [[224, 172, 140], [120, 80, 50], [60, 40, 30], [200, 200, 200], [20, 20, 20]]) {   // skin, leather, dark leather, grey, black
      const p = px(...untouched); A.dyePixels(p, A.DYES[look]); assert.deepEqual([...p.slice(0, 3)], untouched, `${look} touched ${untouched}`);
    }
  }
});

test('the royal dye turns the grey cloth blue but leaves steel, skin and highlights alone', () => {
  const cloth = px(110, 110, 112), steel = px(110, 110, 112), skin = px(224, 172, 140), white = px(250, 250, 250);
  const noMetal = px(0, 128, 0), metal = px(0, 128, 255);
  A.dyePixels(cloth, A.DYES.royal, noMetal); A.dyePixels(steel, A.DYES.royal, metal);
  A.dyePixels(skin, A.DYES.royal, noMetal); A.dyePixels(white, A.DYES.royal, noMetal);
  const h = hueOf(cloth); assert.ok(h > 205 && h < 240, `grey cloth became hue ${h}`);
  assert.deepEqual([...steel.slice(0, 3)], [110, 110, 112], 'steel was dyed');
  assert.deepEqual([...skin.slice(0, 3)], [224, 172, 140], 'skin was dyed');
  assert.deepEqual([...white.slice(0, 3)], [250, 250, 250], 'highlights were dyed');
});
