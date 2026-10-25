import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';

const load = async (file) => ts.transpileModule(await readFile(new URL(`../src/adventure/${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const weaponUrl = url(await load('weapon.ts'));
const A = await import(url((await load('armory.ts')).replace("'./weapon'", `'${weaponUrl}'`)));

const response = (name = 'Tidebreaker', object = 'water bottle') => ({ artifact: { object, artifactName: name, artifactType: 'staff', element: 'water', ability: 'wave', damage: 70, rarity: 'epic', description: 'A staff that remembers the sea.' }, source: 'gemini' });
const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const entry = (name, object, savedAt = 1) => ({ response: response(name, object), photo, savedAt });
const memory = () => { const data = new Map(); return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };

test('a saved armory reads back exactly, newest first', () => {
  const store = memory();
  const saved = A.writeArmory(store, A.addToArmory(A.addToArmory([], entry('Tidebreaker', 'water bottle', 1)), entry('Ember Chalice', 'mug', 2)));
  assert.deepEqual(A.readArmory(store), saved);
  assert.deepEqual(saved.map((e) => e.response.artifact.artifactName), ['Ember Chalice', 'Tidebreaker']);
  assert.equal(A.weaponOf(saved[0]).spell.ability, 'wave');
});

test('re-forging the same weapon replaces it and the armory keeps at most 8', () => {
  let list = [];
  for (let i = 0; i < 10; i++) list = A.addToArmory(list, entry(`Blade ${i}`, 'pen', i));
  list = A.addToArmory(list, entry('Blade 9', 'pen', 99));
  assert.equal(list.length, A.ARMORY_MAX);
  assert.equal(list.filter((e) => e.response.artifact.artifactName === 'Blade 9').length, 1);
  assert.equal(list[0].savedAt, 99);
});

test('corrupt or hostile storage never breaks the armory', () => {
  const store = memory();
  for (const bad of ['not json', '{"a":1}', 'null']) { store.data.set(A.ARMORY_KEY, bad); assert.deepEqual(A.readArmory(store), []); }
  store.data.set(A.ARMORY_KEY, JSON.stringify([{ response: { artifact: { artifactName: 'x' }, source: 'gemini' } }, { ...entry('Ok', 'cup'), photo: 'javascript:alert(1)' }, { ...entry('Big', 'cup'), photo: `data:image/jpeg;base64,${'A'.repeat(A.PHOTO_MAX)}` }]));
  const read = A.readArmory(store);
  assert.deepEqual(read.map((e) => [e.response.artifact.artifactName, e.photo]), [['Ok', ''], ['Big', '']]);
  assert.deepEqual(A.readArmory(undefined), []);
});

test('a full browser drops the oldest entries instead of failing', () => {
  const store = memory(); let calls = 0;
  store.setItem = (k, v) => { calls++; if (JSON.parse(v).length > 2) throw new Error('QuotaExceededError'); store.data.set(k, v); };
  const kept = A.writeArmory(store, [entry('a', '1'), entry('b', '2'), entry('c', '3')]);
  assert.deepEqual(kept.map((e) => e.response.artifact.artifactName), ['a', 'b']);
  assert.equal(calls, 2);
  assert.deepEqual(A.writeArmory({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, [entry('a', '1')]), []);
});
