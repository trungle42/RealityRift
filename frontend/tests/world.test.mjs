import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { AnimationMixer, Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const cache = new Map();
async function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  let source = await readFile(url, 'utf8');
  let output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  for (const match of [...output.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const name = match[1];
    const resolved = name.startsWith('.') ? await moduleUrl(new URL(`${name}.ts`, url)) : import.meta.resolve(name);
    output = output.replace(match[0], `from '${resolved}'`);
  }
  const result = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  cache.set(url.href, result); return result;
}
const { cameraReach, encounterSpawn, heightAt, moveOnGround, objectiveFor, PATHS } = await import(await moduleUrl(new URL('../src/adventure/terrain.ts', import.meta.url)));
const { World } = await import(await moduleUrl(new URL('../src/adventure/World.ts', import.meta.url)));
const { ScriptedStory } = await import(await moduleUrl(new URL('../src/story/ScriptedStory.ts', import.meta.url)));
const { GameState } = await import(await moduleUrl(new URL('../src/game/GameState.ts', import.meta.url)));
const { Actor } = await import(await moduleUrl(new URL('../src/adventure/Actor.ts', import.meta.url)));
const world = new World(new Scene());
world.useArchModel(new Group());

test('the follow camera pulls in before a solid object, without changing open views', () => {
  const from = { x: 0, z: 0 }, to = { x: 0, z: 9 };
  assert.equal(cameraReach(from, to, []), 1);
  assert.ok(cameraReach(from, to, [{ x: 0, z: 5, radius: 1 }]) < 0.5);
  assert.equal(cameraReach(from, to, [{ x: 3, z: 5, radius: 1 }]), 1);
});

test('Blender characters embed textures, skeletons and every required animation', async () => {
  for (const name of ['evermere-ranger', 'evermere-spellweaver']) {
    const data = await readFile(new URL(`../public/models/${name}.glb`, import.meta.url));
    assert.equal(data.toString('ascii', 0, 4), 'glTF');
    const document = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    assert.ok(document.skins[0].joints.length >= 7);
    assert.deepEqual(document.animations.map((clip) => clip.name).sort(), ['arms-up', 'crouch', 'idle', 'strike', 't-pose', 'walk']);
    assert.ok(document.images.every((image) => image.bufferView !== undefined), 'models must work with embedded local textures');
    assert.ok(data.length < 3_000_000, 'character payload budget');
  }
});

test('exported pose animations visibly raise arms and lower the crouching body', async () => {
  const data = await readFile(new URL('../public/models/evermere-ranger.glb', import.meta.url));
  const oldLength = data.readUInt32LE(12), document = JSON.parse(data.subarray(20, 20 + oldLength).toString());
  // Keep real mesh/skin/animation bytes; omit image decoding in the Node test.
  delete document.materials; delete document.images; delete document.textures;
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  let json = JSON.stringify(document); json += ' '.repeat((4 - Buffer.byteLength(json) % 4) % 4);
  const bin = data.subarray(20 + oldLength), output = Buffer.alloc(20 + Buffer.byteLength(json) + bin.length);
  output.write('glTF'); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(Buffer.byteLength(json), 12); output.writeUInt32LE(0x4e4f534a, 16); output.write(json, 20); bin.copy(output, 20 + Buffer.byteLength(json));
  const asset = await new GLTFLoader().parseAsync(output.buffer, ''), mixer = new AnimationMixer(asset.scene);
  const arm = asset.scene.getObjectByName('ArmL'), root = asset.scene.getObjectByName('Root');
  const play = (name) => { mixer.stopAllAction(); mixer.clipAction(asset.animations.find((clip) => clip.name === name)).play(); mixer.update(0.1); asset.scene.updateMatrixWorld(true); };
  play('idle'); const rest = arm.getWorldQuaternion(new Quaternion()), restHeight = root.getWorldPosition(new Vector3()).y;
  const direction = () => new Vector3(0, -1, 0).applyQuaternion(arm.getWorldQuaternion(new Quaternion()).multiply(rest.clone().invert()));
  play('t-pose'); assert.ok(Math.abs(direction().x) > 0.85 && Math.abs(direction().y) < 0.2, 'T-pose must spread the arms');
  play('arms-up'); assert.ok(direction().y > 0.8, 'arms-up must raise the hands');
  play('crouch'); assert.ok(root.getWorldPosition(new Vector3()).y < restHeight - 0.2, 'crouch must lower the body');
});

test('roll animation folds both knees and tucks the forearms', () => {
  const model = new Group();
  model.add(new Mesh(new BoxGeometry(0.8, 2, 0.5), new MeshBasicMaterial()));
  const bone = (name, parent, y = 0) => { const item = new Bone(); item.name = name; item.position.y = y; parent.add(item); return item; };
  const hips = bone('Hips', model, 0.9), spine = bone('Spine', hips, 0.2);
  const leftArm = bone('LeftArm', spine, 0.3), rightArm = bone('RightArm', spine, 0.3);
  bone('LeftForeArm', leftArm, -0.2); bone('RightForeArm', rightArm, -0.2);
  const leftUpLeg = bone('LeftUpLeg', hips), rightUpLeg = bone('RightUpLeg', hips);
  bone('LeftLeg', leftUpLeg, -0.35); bone('RightLeg', rightUpLeg, -0.35);

  const actor = new Actor(); actor.useModel(model, [], false);
  const roll = actor.actions.get('roll');
  assert.ok(roll, 'the articulated rig needs a dedicated roll animation');
  const tracks = new Map(roll.getClip().tracks.map((track) => [track.name, track]));
  for (const name of ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftForeArm', 'RightForeArm']) {
    const track = tracks.get(`${name}.quaternion`);
    assert.ok(track, `${name} must animate during the roll`);
    const rest = new Quaternion().fromArray(track.values, 0);
    const tuck = new Quaternion().fromArray(track.values, 4);
    assert.ok(Math.abs(rest.dot(tuck)) < 0.98, `${name} must move into the tucked pose`);
  }
});

test('3D movement respects tree trunks and boundaries during long frames and dodges', () => {
  const solid = [{ x: 0, z: 0, radius: 1 }];
  const result = moveOnGround({ x: -5, z: 0 }, 50, 0, solid);
  assert.ok(result.x < -1.4, 'must not tunnel through a trunk');
  const edge = moveOnGround({ x: 0, z: 0 }, -200, 200, []);
  assert.ok(edge.x > -67 && edge.z < 58);
  const slide = moveOnGround({ x: -1.6, z: -1 }, 1.5, 2.5, solid);
  assert.ok(Math.hypot(slide.x, slide.z) >= 1.42, 'sliding must preserve the collision footprint');
});

test('castle walls block traversal and encounter spawns stay on open ground', () => {
  const blocked = moveOnGround({ x: -44, z: -46 }, 0, -6, world.solids);
  assert.ok(blocked.z > -48, 'front wall must be solid');
  const entrance = moveOnGround({ x: -40, z: -46 }, 0, -7, world.solids);
  assert.ok(entrance.z < -52, 'the central arch must remain open');
  const spawn = encounterSpawn({ x: -40, z: -62 }, { x: -40, z: -55 }, world.solids);
  assert.ok(world.solids.every((solid) => Math.hypot(spawn.x - solid.x, spawn.z - solid.z) > solid.radius + 1));
  assert.ok(spawn.z > -62, 'prefer the heroes side of the back wall');
});

test('terrain is finite throughout the playable map and the main trails stay above water', () => {
  for (let x = -66; x < 67; x += 3) for (let z = -68; z < 58; z += 3) assert.ok(Number.isFinite(heightAt(x, z)));
  for (const path of PATHS) for (let i = 1; i < path.length; i++) {
    for (let t = 0; t <= 1; t += 0.05) {
      const x = path[i - 1].x * (1 - t) + path[i].x * t, z = path[i - 1].z * (1 - t) + path[i].z * t;
      assert.ok(heightAt(x, z) > -0.4, 'quest path must not lead under the lake');
    }
  }
});

test('both story routes and every useful landmark have a reachable approach in the actual 3D scenery', async () => {
  const visited = new Set(['0,34']), queue = [{ x: 0, z: 34 }];
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const to = { x: from.x + dx, z: from.z + dz }, key = `${to.x},${to.z}`;
      if (visited.has(key)) continue;
      const actual = moveOnGround(from, dx, dz, world.solids);
      if (Math.hypot(actual.x - to.x, actual.z - to.z) < 0.01) { visited.add(key); queue.push(to); }
    }
  }
  const near = (target, radius) => queue.some((p) => Math.hypot(p.x - target.x, p.z - target.z) < radius);
  for (const object of world.objects) assert.ok(near(object, 2.4), `${object.name} needs an accessible approach`);
  for (const route of ['castle', 'cave']) {
    const story = new ScriptedStory(), state = new GameState([{ index: 0, name: 'Rowan' }, { index: 1, name: 'Wren' }]);
    let beat = await story.begin(state.party);
    while (!beat.isEnding) {
      const objective = objectiveFor(beat); assert.ok(near(objective, 3.2), `${route}: ${beat.id} is unreachable`);
      const outcome = { beatId: beat.id, kind: beat.boss ? 'boss' : beat.challenge?.type ?? 'story', success: true, choiceId: beat.id === 'crossroads' ? route : 'free', heartsLost: 0, summary: '', perPlayer: [{ success: true, stars: 0 }, { success: true, stars: 0 }] };
      state.outcomes.push(outcome); beat = await story.next(state.history(), outcome);
    }
  }
});

test('treasure and healing landmarks use the existing Dev 1 catalog with unique ids', () => {
  assert.equal(world.objects.length, 9); assert.equal(new Set(world.objects.map((o) => o.id)).size, 9);
  assert.equal(world.objects.filter((o) => o.kind === 'chest').length, 3);
  assert.equal(world.objects.filter((o) => o.kind === 'shrine').length, 3);
  for (const object of world.objects) assert.equal(object.root.position.y, heightAt(object.x, object.z));
});
