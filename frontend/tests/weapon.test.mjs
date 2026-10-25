import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(await readFile(new URL('../src/adventure/weapon.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const W = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const artifact = (over = {}) => ({ object: 'water bottle', artifactName: 'Tidebreaker', artifactType: 'staff', element: 'water', ability: 'wave', damage: 70, rarity: 'epic', description: 'A staff that remembers the sea.', ...over });
const response = (over = {}, source = 'gemini') => ({ artifact: artifact(over), source });

test('every element has a colour and every ability a base spell', () => {
  for (const e of W.ELEMENTS) assert.ok(Number.isInteger(W.ELEMENT_COLOR[e]));
  for (const a of W.ABILITIES) { const s = W.spellFor(artifact({ ability: a })); assert.equal(s.ability, a); assert.ok(s.cooldown > 0); }
});

test('damage tiers stay 1..3 so a scanned weapon cannot trivialise the boss', () => {
  assert.deepEqual([1, 30, 31, 65, 66, 100].map(W.damageTier), [1, 1, 2, 2, 3, 3]);
  for (const d of [1, 50, 100]) assert.ok(W.spellFor(artifact({ damage: d, ability: 'bolt' })).damage <= 3);
});

test('a meteor hits one tier harder, and only a meteor does', () => {
  assert.equal(W.spellFor(artifact({ damage: 70, ability: 'meteor' })).damage, 4);
  assert.equal(W.spellFor(artifact({ damage: 70, ability: 'nova' })).damage, 3);
});

test('abilities behave as labelled', () => {
  const s = (ability) => W.spellFor(artifact({ ability }));
  assert.equal(s('wave').count, 3); assert.ok(s('wave').spread > 0);
  assert.ok(s('pierce').pierce >= 3); assert.ok(s('pierce').speed > s('bolt').speed);
  assert.equal(s('chain').chain, 2); assert.ok(s('chain').radius > 0);
  assert.ok(s('nova').radius > 0); assert.equal(s('nova').count, 0);
  assert.ok(s('meteor').delay > 0); assert.ok(s('meteor').radius > 0);
  assert.equal(s('bolt').count, 1); assert.equal(s('bolt').pierce, 0);
});

test('the default spell is the plain bolt in the hero colour', () => {
  const d = W.defaultSpell(0xb2f6d5); assert.equal(d.color, 0xb2f6d5); assert.equal(d.damage, 1); assert.equal(d.ability, 'bolt'); assert.equal(d.cooldown, 0.8);
});

test('a valid Gemini response is accepted and a weapon is built from it', () => {
  const parsed = W.parseArtifactResponse(response());
  assert.equal(parsed.source, 'gemini');
  const weapon = W.makeWeapon(parsed);
  assert.equal(weapon.artifactName, 'Tidebreaker'); assert.equal(weapon.spell.color, W.ELEMENT_COLOR.water); assert.equal(weapon.spell.count, 3);
});

test('responses with unknown enums, bad numbers or missing fields are rejected', () => {
  for (const bad of [null, undefined, 5, 'x', {}, { artifact: null, source: 'gemini' },
    response({ element: 'plasma' }), response({ ability: 'laser' }), response({ rarity: 'mythic' }), response({ artifactType: 'gun' }),
    response({ damage: 'a lot' }), response({ damage: NaN }), response({ artifactName: '' }), response({ description: undefined }),
    { artifact: artifact(), source: 'openai' }]) assert.equal(W.parseArtifactResponse(bad), undefined);
});

test('out-of-range damage is clamped and long text is cut, not trusted', () => {
  const p = W.parseArtifactResponse(response({ damage: 9999, artifactName: 'x'.repeat(200), description: 'y'.repeat(900) }));
  assert.equal(p.artifact.damage, 100); assert.equal(p.artifact.artifactName.length, 40); assert.equal(p.artifact.description.length, 200);
  assert.equal(W.parseArtifactResponse(response({ damage: -5 })).artifact.damage, 1);
});

test('camera frames are downscaled to the upload size without stretching', () => {
  assert.deepEqual(W.fitWithin(1280, 720), { width: 512, height: 288 });
  assert.deepEqual(W.fitWithin(480, 640), { width: 384, height: 512 });
  assert.deepEqual(W.fitWithin(200, 100), { width: 200, height: 100 });
  assert.ok(W.fitWithin(0, 0).width >= 1);
});

test('bosses take double from the element they fear, half from the one they resist, normal otherwise', () => {
  assert.equal(W.elementMultiplier('frost-witch', 'fire'), 2);
  assert.equal(W.elementMultiplier('frost-witch', 'ice'), 0.5);
  assert.equal(W.elementMultiplier('frost-witch', 'water'), 1);
  assert.equal(W.elementMultiplier('shadow-dragon', 'light'), 2);
  assert.equal(W.elementMultiplier('shadow-dragon', 'shadow'), 0.5);
});

test('no element, an unknown boss, or no boss means no change', () => {
  assert.equal(W.elementMultiplier('frost-witch', undefined), 1);
  assert.equal(W.elementMultiplier('mystery-boss', 'fire'), 1);
  assert.equal(W.elementMultiplier(undefined, 'fire'), 1);
});

test('scaled damage stays a whole number and never drops below 1', () => {
  assert.equal(W.scaledDamage(3, 2), 6);
  assert.equal(W.scaledDamage(3, 0.5), 2);
  assert.equal(W.scaledDamage(1, 0.5), 1);
  assert.equal(W.scaledDamage(4, 2), 8);
});

test('every boss has a different weak and resisted element, and both are real elements', () => {
  for (const [kind, e] of Object.entries(W.BOSS_ELEMENTS)) { assert.notEqual(e.weak, e.resists, kind); assert.ok(W.ELEMENTS.includes(e.weak) && W.ELEMENTS.includes(e.resists), kind); }
});

test('a scanned weapon carries its element so hits can use it, the default spell has none', () => {
  assert.equal(W.spellFor(artifact({ element: 'fire' })).element, 'fire');
  assert.equal(W.defaultSpell(0xffffff).element, undefined);
});
