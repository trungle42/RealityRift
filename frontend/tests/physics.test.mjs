import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as T from 'three';
import ts from 'typescript';

let source = ts.transpileModule(await readFile(new URL('../src/adventure/Physics.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
for (const name of ['three', '@dimforge/rapier3d-compat']) source = source.replace(`from '${name}'`, `from '${import.meta.resolve(name)}'`).replace(`from "${name}"`, `from '${import.meta.resolve(name)}'`);
const { Physics } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const mat = new T.MeshStandardMaterial();
function box(w, h, d, x, y, z) { const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); mesh.updateMatrixWorld(); return mesh; }
const floor = () => box(40, 0.2, 40, 0, -0.1, 0);
function advance(physics, pawn, at, delta, count = 1) { for (let i = 0; i < count; i++) { at = physics.move(pawn, at, delta); physics.step(1 / 60); } return at; }

test('the real capsule controller stops walking and long dodges at mesh walls', async () => {
  const physics = await Physics.create([floor(), box(4, 3, 0.3, 0, 1.5, -2)], []);
  try {
    let at = new T.Vector3(0, 0, 2); const pawn = physics.addCharacter(at);
    at = advance(physics, pawn, at, new T.Vector3(0, -0.03, -0.12), 60);
    assert.ok(at.z > -1.55 && at.z < -1.3, `wall stop: ${at.z}`);
    at = advance(physics, pawn, at, new T.Vector3(0, -0.03, -20));
    assert.ok(at.z > -1.55, 'a long dodge must not tunnel through the wall');
    assert.ok(physics.isGrounded(pawn), 'hero must remain grounded');
  } finally { physics.dispose(); }
});

test('gravity produces a jump arc and a stable landing on the rendered floor', async () => {
  const physics = await Physics.create([floor()], []);
  try {
    let at = new T.Vector3(0, 0, 0); const pawn = physics.addCharacter(at);
    at = advance(physics, pawn, at, new T.Vector3(0, -0.03, 0), 2);
    let vertical = 7, high = 0;
    for (let i = 0; i < 110; i++) { vertical -= 19 / 60; at = advance(physics, pawn, at, new T.Vector3(0, vertical / 60, 0)); if (physics.isGrounded(pawn) && vertical < 0) vertical = 0; high = Math.max(high, at.y); }
    assert.ok(high > 1 && high < 1.5, `jump height ${high}`);
    assert.ok(at.y >= -0.03 && at.y < 0.08, `landing ${at.y}`);
  } finally { physics.dispose(); }
});

test('crouching changes the body shape and prevents standing through a low ceiling', async () => {
  const physics = await Physics.create([floor(), box(4, 0.3, 2, 0, 1.5, -2)], []);
  try {
    let at = new T.Vector3(0, 0, 0); const pawn = physics.addCharacter(at);
    at = advance(physics, pawn, at, new T.Vector3(0, -0.02, -0.08), 35);
    assert.ok(at.z > -0.8, 'standing character must hit the low opening');
    assert.equal(physics.setCrouching(pawn, true), true);
    at = advance(physics, pawn, at, new T.Vector3(0, -0.02, -0.08), 18);
    assert.ok(at.z < -1.5, 'crouching character must enter the opening');
    assert.equal(physics.setCrouching(pawn, false), true, 'must stay crouched under the ceiling');
    at = advance(physics, pawn, at, new T.Vector3(0, -0.02, -0.08), 25);
    assert.equal(physics.setCrouching(pawn, false), false, 'standing is possible after leaving the ceiling');
  } finally { physics.dispose(); }
});

test('scenery blocks projectile and camera rays, while open passages stay clear', async () => {
  const physics = await Physics.create([floor(), box(1, 3, 1, -1.5, 1.5, 0), box(1, 3, 1, 1.5, 1.5, 0)], []);
  try {
    assert.equal(physics.wallDistance(new T.Vector3(0, 1, 2), new T.Vector3(0, 1, -2)), undefined);
    const wall = physics.wallDistance(new T.Vector3(-1.5, 1, 2), new T.Vector3(-1.5, 1, -2));
    assert.ok(wall > 1 && wall < 2);
  } finally { physics.dispose(); }
});

test('opposing simultaneous dodges do not let character capsules overlap', async () => {
  const physics = await Physics.create([floor()], []);
  try {
    let left = new T.Vector3(-1, 0, 0), right = new T.Vector3(1, 0, 0);
    const a = physics.addCharacter(left), b = physics.addCharacter(right);
    left = physics.move(a, left, new T.Vector3(0.855, -0.02, 0));
    right = physics.move(b, right, new T.Vector3(-0.855, -0.02, 0)); physics.step(0.045);
    assert.ok(right.x - left.x >= 0.63, `capsule separation ${right.x - left.x}`);
  } finally { physics.dispose(); }
});

test('hidden or transformed props update their collision instead of leaving ghost walls', async () => {
  const prop = box(1, 2, 1, 0, 1, 0), physics = await Physics.create([floor(), prop], []);
  try {
    const from = new T.Vector3(0, 1, 2), to = new T.Vector3(0, 1, -2);
    assert.ok(physics.wallDistance(from, to) !== undefined);
    prop.visible = false; physics.step(1 / 60); assert.equal(physics.wallDistance(from, to), undefined);
    prop.visible = true; prop.position.x = 3; physics.step(1 / 60); assert.equal(physics.wallDistance(from, to), undefined);
    assert.ok(physics.wallDistance(new T.Vector3(3, 1, 2), new T.Vector3(3, 1, -2)) !== undefined);
  } finally { physics.dispose(); }
});
