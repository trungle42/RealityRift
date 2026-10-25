import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { BeatOutcome, BossSpec, OutcomeKind, PlayerIndex, PoseId, StoryBeat, StoryProvider } from '../contracts';
import { Sfx } from '../audio/Sfx';
import { Narrator } from '../audio/Narrator';
import { REGIONS } from '../campaign/locations';
import { GameState } from '../game/GameState';
import { ScriptedStory } from '../story/ScriptedStory';
import { GeminiStory } from '../story/GeminiStory';
import { Actor, material, mesh } from './Actor';
import { Interface } from './Interface';
import { World, type WorldObject } from './World';
import { Physics } from './Physics';
import { cameraReach, encounterSpawn, heightAt, moveOnGround, objectiveFor, regionAt, type Position } from './terrain';
import './adventure.css';

interface Enemy {
  root: T.Group; ring: T.Mesh; core: T.Mesh; hp: number; maxHp: number; home: Position;
  windup: number; cooldown: number; boss?: BossSpec; encounter: boolean; attack: string; pawn?: number; visual?: T.Object3D; actor?: Actor;
}
interface Bolt { mesh: T.Mesh; velocity: T.Vector3; life: number; player: PlayerIndex }
interface Spark { mesh: T.Mesh; velocity: T.Vector3; life: number; max: number }
interface Trial { type: 'freeze' | 'pose'; elapsed: number; duration: number; moved: number; held: number; poseIndex: number; poses: PoseId[]; secondsPerPose: number; before: number }
const MOVE = [['KeyA', 'KeyD', 'KeyW', 'KeyS'], ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']];
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = T.MathUtils.clamp;

/** Continuous traversal and combat. The storyteller still owns only the tale. */
export class Adventure {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(57, innerWidth / innerHeight, 0.1, 350);
  readonly renderer: T.WebGLRenderer;
  readonly world: World;
  readonly heroes: [Actor, Actor] = [new Actor(), new Actor(true)];
  readonly ui = new Interface();
  private state?: GameState;
  private readonly story: StoryProvider;
  private readonly sfx = new Sfx();
  private readonly narrator = new Narrator();
  private sound = true;
  private readonly keys = new Set<string>();
  private readonly events = new AbortController();
  private readonly enemies: Enemy[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkGeometry = new T.IcosahedronGeometry(0.055, 0);
  private readonly fairy = new T.Group();
  private readonly focus = new T.Vector3(0, 1.4, 32);
  private beat?: StoryBeat;
  private target?: Position & { name: string };
  private nearest?: WorldObject;
  private busy = false;
  private ended = false;
  private stamina = 1;
  private yaw = 0;
  private pitch = 0.47;
  private zoom = 9;
  private jump = [0, 0];
  private velocityY = [0, 0];
  private dodge = [0, 0];
  private readonly dodgeDirection = [new T.Vector3(), new T.Vector3()];
  private readonly movementVelocity = [new T.Vector3(), new T.Vector3()];
  private physics?: Physics;
  private monster?: GLTF;
  private dragon?: GLTF;
  private queen?: GLTF;
  private invulnerable = 0;
  private attackCooldown = [0, 0];
  private spellCooldown = [0, 0];
  private companionUntil = 0;
  private companionCast = 0;
  private trial?: Trial;
  private encounterBefore = 3;
  private encounterKind?: 'encounter' | 'boss';
  private bossWon = false;
  private time = 0;
  private previous = 0;
  private disposed = false;
  private mapTimer = 0;
  private region = '';
  private drag?: { x: number; y: number; moved: number; pointer: number };
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly sun = new T.DirectionalLight(0xffedcc, 2.6);

  constructor() {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.07;
    this.renderer.domElement.className = 'adventure-canvas'; this.renderer.domElement.setAttribute('aria-label', 'Storybound interactive 3D world'); this.renderer.domElement.tabIndex = 0;
    document.getElementById('app')!.append(this.renderer.domElement);
    this.scene.background = new T.Color(0xb9d9d4); this.scene.fog = new T.FogExp2(0xc4d7bc, 0.0085);
    this.scene.add(new T.HemisphereLight(0xd0ecec, 0x657340, 1.65));
    const sky = new T.Mesh(new T.SphereGeometry(270, 32, 18), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { zenith: { value: new T.Color(0x8dbec5) }, horizon: { value: new T.Color(0xe4e4c7) } },
      vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 zenith;uniform vec3 horizon;varying vec3 direction;void main(){float h=pow(max(0.0,normalize(direction).y),0.55);gl_FragColor=vec4(mix(horizon,zenith,h),1.0);}',
    }));
    this.scene.add(sky);
    this.sun.position.set(-28, 48, 20); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 110 });
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.04; this.scene.add(this.sun, this.sun.target);
    this.world = new World(this.scene);
    mesh(new T.SphereGeometry(0.1, 8, 6), material(0xf6d6e4, 0xf6d6e4), this.fairy);
    for (const side of [-1, 1]) { const wing = mesh(new T.SphereGeometry(0.16, 8, 5), material(0xdcf2df, 0x6b9474), this.fairy, side * 0.12, 0.07); wing.scale.set(0.5, 1, 0.15); }
    this.fairy.visible = false; this.scene.add(this.fairy);
    this.heroes.forEach((hero, i) => { hero.root.position.set(i ? 1.6 : 0, heightAt(i ? 1.6 : 0, 34), i ? 35 : 34); this.scene.add(hero.root); });
    this.camera.position.set(13, 10, 45); this.camera.lookAt(0, 2, 17);
    const scripted = new ScriptedStory();
    this.story = import.meta.env.VITE_STORY === 'scripted' || new URLSearchParams(location.search).get('story') === 'scripted' ? scripted : new GeminiStory(scripted);
    this.bindInput(); this.renderer.setAnimationLoop((time) => this.frame(time));
    this.ui.root.classList.add('before-start');
  }

  async start(): Promise<void> {
    await this.loadModels();
    if (this.disposed) return;
    const physics = await Physics.create(this.world.collisionSurfaces(), this.world.treeSolids);
    if (this.disposed) { physics.dispose(); return; }
    this.physics = physics; this.heroes.forEach((hero) => physics.addCharacter(hero.root.position));
    document.getElementById('loading')?.remove();
    const party = await this.ui.start();
    this.state = new GameState(party); this.sfx.unlock(); this.ui.discover('Whispering Wood');
    this.ui.toast('WASD to explore · drag to look around · follow the golden beacon');
    this.spawnEnemy(17, -5); this.spawnEnemy(-23, -24); this.spawnEnemy(24, -28);
    await this.loadBeat(this.story.begin(party));
  }

  private async loadModels(): Promise<void> {
    const loader = new GLTFLoader(), textures = new T.TextureLoader();
    const ranger = Promise.all([loader.loadAsync('/models/assetyard/ashfen-ranger.glb'), loader.loadAsync('/models/assetyard/hollow-warden.glb')]).then(([asset, combat]) => { if (!this.disposed) this.heroes[0].useModel(clone(asset.scene), asset.animations, false, combat.animations.filter((clip) => clip.name === 'sword_slash_horizontal')); });
    const companion = loader.loadAsync('/models/assetyard/vale-shieldmaiden.glb').then((asset) => { this.queen = asset; if (!this.disposed) this.heroes[1].useModel(clone(asset.scene), asset.animations, false); });
    const jobs = [
      ranger, companion,
      loader.loadAsync('/models/evermere-arch.glb').then((asset) => { if (!this.disposed) this.world.useArchModel(asset.scene); }),
      loader.loadAsync('/models/evermere-oak.glb').then((asset) => { if (!this.disposed) this.world.useTreeModel(asset.scene); }),
      loader.loadAsync('/models/evermere-moonwell.glb').then((asset) => { if (!this.disposed) this.world.useMoonwellModel(asset.scene); }),
      loader.loadAsync('/models/forest/tree.glb').then((asset) => { if (!this.disposed) this.world.useDetailedTrees(asset.scene); }),
      Promise.all([loader.loadAsync('/models/polyhaven/fern_02/fern_02.gltf'), loader.loadAsync('/models/polyhaven/rock_moss_set_01/rock_moss_set_01.gltf')]).then(([fern, rocks]) => { if (!this.disposed) this.world.useForestDressing(fern.scene, rocks.scene); }),
      loader.loadAsync('/models/assetyard/reach-shrine.glb').then((asset) => { if (!this.disposed) this.world.useWaystone(asset.scene); }),
      loader.loadAsync('/models/assetyard/wayfarer-lantern.glb').then((asset) => { if (!this.disposed) this.world.useLanterns(asset.scene); }),
      Promise.all([ranger, companion, loader.loadAsync('/models/assetyard/arming-sword.glb')]).then(([, , asset]) => { if (!this.disposed) this.heroes.forEach((hero) => hero.holdWeapon(asset.scene)); }),
      loader.loadAsync('/models/assetyard/gloom-stalker.glb').then((asset) => { this.monster = asset; }),
      loader.loadAsync('/models/assetyard/ashfen-dragon.glb').then((asset) => { this.dragon = asset; }),
      Promise.all(['forest_floor/Diffuse', 'mossy_cobblestone/Diffuse', 'mossy_cobblestone/nor_gl', 'forest_floor/nor_gl'].map((name) => textures.loadAsync(`/models/polyhaven/${name}.jpg`))).then(([grass, stone, normal, grassNormal]) => { if (!this.disposed) this.world.useGroundTextures(grass, stone, normal, grassNormal); }),
    ];
    let completed = 0;
    const outcomes = await Promise.allSettled(jobs.map((job) => job.finally(() => { completed++; const progress = document.querySelector<HTMLProgressElement>('#loading-progress'); if (progress) progress.value = completed / jobs.length; })));
    if (outcomes[0].status === 'rejected' || outcomes[1].status === 'rejected') throw new Error('Character artwork could not load');
    if (outcomes.some((outcome) => outcome.status === 'rejected')) this.ui.toast('Some artwork could not load. The adventure remains playable; refresh to retry.');
  }

  private bindInput(): void {
    const options = { signal: this.events.signal };
    window.addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }, options);
    window.addEventListener('blur', () => { this.keys.clear(); this.drag = undefined; this.previous = 0; }, options);
    document.addEventListener('visibilitychange', () => { this.keys.clear(); this.previous = 0; }, options);
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || !this.state) return;
      if (['Space', ...MOVE.flat()].includes(event.code)) event.preventDefault();
      if (this.ui.speaking) {
        if (!event.repeat && ['Enter', 'Space', 'KeyE'].includes(event.code)) { event.preventDefault(); this.ui.advance(); }
        return;
      }
      if (this.ui.modal.open) { if (event.code === 'KeyM' && this.ui.journalOpen) this.ui.modal.close(); return; }
      if (event.code === 'Escape' || event.code === 'KeyM') { event.preventDefault(); this.openJournal(); return; }
      this.keys.add(event.code);
      if (MOVE[1].includes(event.code)) this.companionUntil = this.time + 5;
      if (event.repeat || this.busy || this.ended) return;
      if (event.code === 'KeyE') void this.interact();
      if (event.code === 'KeyJ') this.strike(0);
      if (event.code === 'KeyF') this.cast(0);
      if (event.code === 'Slash') this.cast(1);
      if (event.code === 'KeyQ') this.roll(0);
      if (event.code === 'ShiftRight') this.roll(1);
      if (event.code === 'Space') this.leap(0);
    }, options);
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), options);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    canvas.addEventListener('pointerdown', (event) => {
      this.drag = { x: event.clientX, y: event.clientY, moved: 0, pointer: event.pointerId }; canvas.setPointerCapture(event.pointerId);
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag || this.drag.pointer !== event.pointerId) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy); this.yaw -= dx * 0.005; this.pitch = clamp(this.pitch + dy * 0.003, 0.12, 1.1);
      this.drag.x = event.clientX; this.drag.y = event.clientY;
    }, options);
    canvas.addEventListener('pointerup', (event) => {
      if (this.drag && this.drag.moved < 5 && event.button === 0) this.strike(0);
      this.drag = undefined;
    }, options);
    canvas.addEventListener('pointercancel', () => { this.drag = undefined; }, options);
    canvas.addEventListener('wheel', (event) => { event.preventDefault(); this.zoom = clamp(this.zoom + event.deltaY * 0.008, 4.5, 19); }, { ...options, passive: false });
    this.ui.onInteract = () => { void this.interact(); }; this.ui.onAttack = () => this.strike(0); this.ui.onSpell = () => this.cast(0); this.ui.onDodge = () => this.roll(0); this.ui.onMap = () => this.openJournal();
    this.ui.onSound = () => { this.sound = !this.sound; this.narrator.enabled = this.sound; if (!this.sound) this.narrator.stop(); this.ui.sound(this.sound); };
    this.ui.onNarrate = (text) => this.narrator.speak(text); this.ui.onSilence = () => this.narrator.stop();
    this.ui.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
      const key = button.dataset.key!;
      button.onpointerdown = (event) => { event.preventDefault(); button.setPointerCapture(event.pointerId); this.keys.add(key); };
      button.onpointerup = button.onpointercancel = () => this.keys.delete(key);
    });
    this.ui.modal.addEventListener('close', () => this.keys.clear());
  }

  private openJournal(): void { if (!this.state || this.busy || this.ended || this.ui.speaking) return; this.keys.clear(); this.ui.journal(this.state); }

  private async loadBeat(work: Promise<StoryBeat>): Promise<void> {
    this.world.marker.visible = false; this.target = undefined; this.ui.quest('The tale is turning…', 'Explore while the storyteller finds the next page.');
    this.beat = await work;
    if (this.ended) return;
    if (this.beat.isEnding) {
      this.busy = true; this.keys.clear(); await this.ui.say(this.beat.narration, this.beat.speaker);
      await this.finish(this.state!.hearts > 0 && this.bossWon); return;
    }
    this.target = objectiveFor(this.beat); this.world.setObjective(this.target);
    this.ui.quest(this.target.name, 'Find the golden beacon · press E nearby');
  }

  private async interact(): Promise<void> {
    if (!this.state || this.busy || this.ui.blocked || this.ended || this.trial || this.encounterKind) return;
    const p = this.heroes[0].root.position;
    if (this.target && distance(p, this.target) < 3.2) { await this.runBeat(); return; }
    const object = this.nearest;
    if (!object) return;
    this.keys.clear();
    if (object.kind === 'chest') {
      if (object.used) { this.ui.toast('This treasure is already part of your tale.'); return; }
      object.used = true; this.state.stars[0] += 2; this.state.stars[1] += 2;
      this.burst(object.root.position.clone().add(new T.Vector3(0, 0.8, 0)), 0xf4da8e, 24);
      if (this.sound) this.sfx.chime(); this.ui.toast(`${object.name} discovered · +2 starlight for each hero`);
    } else if (object.kind === 'shrine') {
      if (object.used) this.ui.toast('The spring is resting. Its gift is already yours.');
      else if (this.state.hearts === 3) this.ui.toast('You are already well. Save this spring for a harder day.');
      else { object.used = true; this.state.gainHeart(); this.burst(object.root.position.clone().add(new T.Vector3(0, 1, 0)), 0xabf4cc, 24); if (this.sound) this.sfx.success(); this.ui.toast('The old magic restores a shared heart.'); }
    } else {
      this.busy = true; await this.ui.say([object.detail ?? 'Follow the golden beacon. Every path holds a story.'], object.name); this.busy = false;
    }
  }

  private async runBeat(): Promise<void> {
    const beat = this.beat!;
    this.busy = true; this.keys.clear(); this.ui.context(); this.world.marker.visible = false;
    await this.ui.say(beat.narration, beat.speaker);
    if (this.ended) return;
    if (beat.reward) {
      this.state!.rewards.push(beat.reward);
      if (beat.reward.kind === 'heart') this.state!.gainHeart();
      if (beat.reward.kind === 'fairy-ally') { this.world.freeFairy(beat.environment); this.fairy.visible = true; }
      this.burst(this.heroes[0].root.position.clone().add(new T.Vector3(0, 1, 0)), 0xf5d48b, 35);
      if (this.sound) this.sfx.success(); this.ui.toast(`${beat.reward.name} · ${beat.reward.description}`);
    }
    if (beat.challenge?.type === 'vote') {
      const choice = await this.ui.choose(beat.challenge.prompt, beat.challenge.options);
      this.busy = false; await this.complete('vote', true, 0, `They chose ${beat.challenge.options.find((o) => o.id === choice)?.label ?? choice}.`, choice); return;
    }
    this.busy = false;
    if (beat.challenge?.type === 'freeze') {
      this.trial = { type: 'freeze', elapsed: 0, duration: beat.challenge.durationSec, moved: 0, held: 0, poseIndex: 0, poses: [], secondsPerPose: 0, before: this.state!.hearts };
      if (this.sound) this.sfx.freeze();
    } else if (beat.challenge?.type === 'pose') {
      this.trial = { type: 'pose', elapsed: 0, duration: beat.challenge.secondsPerPose * beat.challenge.poses.length, moved: 0, held: 0, poseIndex: 0, poses: beat.challenge.poses, secondsPerPose: beat.challenge.secondsPerPose, before: this.state!.hearts };
    } else if (beat.encounter) {
      this.encounterBefore = this.state!.hearts; this.encounterKind = 'encounter';
      for (let i = 0; i < beat.encounter.count; i++) {
        const angle = i / beat.encounter.count * Math.PI * 2;
        this.spawnEnemy(this.heroes[0].root.position.x + Math.sin(angle) * 6, this.heroes[0].root.position.z + Math.cos(angle) * 6, undefined, true);
      }
      this.ui.quest('Drive back the gathering shadows', 'J strike · F cast · Q dodge the red warning');
    } else if (beat.boss) {
      this.encounterBefore = this.state!.hearts; this.encounterKind = 'boss';
      const p = this.heroes[0].root.position; this.spawnEnemy(p.x, p.z - 7, beat.boss, true); if (this.sound) this.sfx.roar();
      this.ui.quest('Win back the last warm spring', 'Dodge the warning · strike while the ward is down');
    } else await this.complete('story', true, 0, beat.reward ? `They received ${beat.reward.name}.` : 'The heroes followed the old magic.');
  }

  private async complete(kind: OutcomeKind, success: boolean, before: number, summary: string, choiceId?: string): Promise<void> {
    if (!this.state || !this.beat || this.ended) return;
    this.ui.challenge(); this.ui.boss(); this.trial = undefined; this.encounterKind = undefined;
    this.heroes.forEach((hero) => { hero.pose = ''; });
    if (success && kind !== 'story' && kind !== 'vote') { this.state.stars[0]++; this.state.stars[1]++; if (this.sound) this.sfx.success(); }
    if (kind === 'boss') this.bossWon = success;
    const earned = success && kind !== 'story' && kind !== 'vote' ? 1 : 0;
    const outcome: BeatOutcome = { beatId: this.beat.id, kind, success, choiceId, summary, heartsLost: Math.max(0, before - this.state.hearts), perPlayer: [{ success, stars: earned }, { success, stars: earned }] };
    this.state.outcomes.push(outcome);
    if (this.state.defeated) { await this.finish(false); return; }
    await this.loadBeat(this.story.next(this.state.history(), outcome));
  }

  private spawnEnemy(x: number, z: number, boss?: BossSpec, encounter = false): void {
    const at = encounterSpawn({ x, z }, this.heroes[0].root.position, this.world.solids); x = at.x; z = at.z;
    const root = new T.Group(); root.position.set(x, heightAt(x, z), z); this.scene.add(root);
    const color = boss?.kind === 'frost-witch' ? 0x91cbd0 : boss ? 0x59627b : 0x736484;
    const core = mesh(new T.IcosahedronGeometry(boss ? 0.85 : 0.46, 1), material(color, 0x24263b), root, 0, boss ? 1.9 : 0.9);
    if (boss) {
      mesh(new T.ConeGeometry(1.3, 2.4, 9), material(color), root, 0, 1.2);
      mesh(new T.ConeGeometry(0.6, 1.5, 7), material(0x576d79), root, 0, 3.4);
      for (const side of [-1, 1]) { const wing = mesh(new T.ConeGeometry(1.4, 3.5, 3), material(0x526879), root, side * 1.5, 2.4, -0.5); wing.rotation.z = side * 0.8; }
    } else {
      for (const side of [-1, 1]) mesh(new T.ConeGeometry(0.17, 0.5, 4), material(0x4b435e), root, side * 0.33, 1.3).rotation.z = side * -0.5;
      const tail = mesh(new T.ConeGeometry(0.35, 0.8, 7), material(color), root, 0, 0.4); tail.rotation.z = Math.PI;
    }
    const eye = material(0xffc78f, 0xffa766);
    for (const side of [-1, 1]) mesh(new T.SphereGeometry(boss ? 0.1 : 0.07, 7, 6), eye, root, side * (boss ? 0.28 : 0.16), boss ? 2 : 1, boss ? 0.76 : 0.41);
    const ring = mesh(new T.RingGeometry(0.1, boss ? 3.5 : 1.6, 48), new T.MeshBasicMaterial({ color: 0xf7a38d, transparent: true, opacity: 0.45, side: T.DoubleSide, depthWrite: false }), root, 0, 0.035);
    ring.rotation.x = -Math.PI / 2; ring.visible = false; ring.castShadow = false;
    const hp = boss ? Math.max(1, Math.round(boss.maxHp * (this.state!.has('boss-weaken') ? 0.75 : 1))) : 3;
    const pawn = this.physics?.addCharacter(root.position, boss ? 0.85 : 0.35, boss ? 0.9 : 0.4);
    let visual: T.Object3D | undefined, actor: Actor | undefined;
    const asset = boss ? boss.kind === 'frost-witch' ? this.queen : this.dragon : this.monster;
    if (asset) {
      root.children.forEach((part) => { if (part !== ring) part.visible = false; });
      if (boss?.kind === 'frost-witch') {
        actor = new Actor(); actor.useModel(clone(asset.scene), asset.animations, false); actor.root.scale.setScalar(1.4); root.add(actor.root);
        for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; mesh(new T.ConeGeometry(0.045, i % 2 ? 0.3 : 0.45, 7), material(0xbcdfe9, 0x477d8c), actor.root, Math.sin(a) * 0.14, 1.93, Math.cos(a) * 0.14); }
      } else {
        visual = clone(asset.scene); const bounds = new T.Box3().setFromObject(visual), size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
        const scale = (boss ? 3.3 : 1.6) / size.y; visual.scale.setScalar(scale); visual.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale); root.add(visual);
        visual.traverse((part) => { if (part instanceof T.Mesh) part.castShadow = true; });
      }
    }
    this.enemies.push({ root, core, ring, hp, maxHp: hp, home: { x, z }, windup: 0, cooldown: 1.2, boss, encounter, attack: '', pawn, visual, actor });
  }

  private strike(player: PlayerIndex): void {
    if (!this.canAct() || this.attackCooldown[player] > 0 || this.trial) return;
    const hero = this.heroes[player]; this.attackCooldown[player] = 0.5; hero.attack = 0.4;
    const target = this.closestEnemy(hero.root.position, 3.3);
    if (target) { hero.heading = Math.atan2(target.root.position.x - hero.root.position.x, target.root.position.z - hero.root.position.z); this.hit(target, 2, player); }
    const arc = mesh(new T.TorusGeometry(1.45, 0.05, 4, 18, Math.PI * 1.2), new T.MeshBasicMaterial({ color: 0xffefba, transparent: true, opacity: 0.8, depthWrite: false, side: T.DoubleSide }), this.scene, hero.root.position.x, hero.root.position.y + 1, hero.root.position.z);
    arc.rotation.set(Math.PI / 2, 0, -hero.heading + 0.3);
    this.sparks.push({ mesh: arc, velocity: new T.Vector3(0, 0.2, 0), life: 0.23, max: 0.23 }); if (this.sound) this.sfx.zap();
  }

  private cast(player: PlayerIndex): void {
    if (!this.canAct() || this.spellCooldown[player] > 0 || this.trial) return;
    this.spellCooldown[player] = this.state!.has('quick-cast') ? 0.35 : 0.8;
    const hero = this.heroes[player], p = hero.root.position;
    const target = this.closestEnemy(p, 19), direction = new T.Vector3(Math.sin(hero.heading), 0, Math.cos(hero.heading));
    const start = p.clone().add(new T.Vector3(0, 1.25, 0));
    if (target) { direction.copy(target.root.position).add(new T.Vector3(0, target.boss ? 1.8 : 0.9, 0)).sub(start).normalize(); hero.heading = Math.atan2(direction.x, direction.z); }
    const bolt = mesh(new T.IcosahedronGeometry(0.16, 1), new T.MeshBasicMaterial({ color: player ? 0xf4d391 : 0xb2f6d5 }), this.scene);
    bolt.position.copy(start); this.bolts.push({ mesh: bolt, velocity: direction.multiplyScalar(23), life: 1.1, player }); hero.attack = 0.35;
    if (this.sound && player === 0) this.sfx.zap();
  }

  private roll(player: PlayerIndex): void {
    if (!this.canAct() || this.stamina < 0.18 || this.dodge[player] > 0 || this.trial) return;
    this.dodge[player] = 0.27; this.stamina -= 0.18;
    this.dodgeDirection[player].set(Math.sin(this.heroes[player].heading), 0, Math.cos(this.heroes[player].heading));
    this.burst(this.heroes[player].root.position.clone(), 0xe3d7a3, 8);
  }
  private leap(player: PlayerIndex): void { if (this.canAct() && (this.physics?.isGrounded(player) ?? this.jump[player] === 0) && !this.trial) this.velocityY[player] = 7; }
  private canAct(): boolean { return !!this.state && !this.busy && !this.ui.blocked && !this.ended; }
  private closestEnemy(p: T.Vector3, radius: number): Enemy | undefined { return this.enemies.filter((e) => e.hp > 0 && distance(e.root.position, p) < radius && this.physics?.wallDistance(p.clone().add(new T.Vector3(0, 1.2, 0)), e.root.position.clone().add(new T.Vector3(0, e.boss ? 1.8 : 0.9, 0))) === undefined).sort((a, b) => distance(a.root.position, p) - distance(b.root.position, p))[0]; }

  private hit(enemy: Enemy, damage: number, player: PlayerIndex): void {
    if (enemy.hp <= 0 || this.ended) return;
    if (enemy.boss && (enemy.windup > 0 || enemy.cooldown <= 0)) return;
    enemy.hp -= damage;
    this.burst(enemy.root.position.clone().add(new T.Vector3(0, enemy.boss ? 2 : 1, 0)), enemy.boss ? 0xd3e7e2 : 0xf4c696, 12);
    if (this.sound) this.sfx.impact();
    if (enemy.hp <= 0) {
      enemy.root.visible = false; this.state!.stars[player] += enemy.boss ? 5 : 2;
      if (enemy.pawn !== undefined) { this.physics?.removeCharacter(enemy.pawn); enemy.pawn = undefined; }
      this.ui.toast(enemy.boss ? 'The frost breaks. Spring remembers your name.' : 'Shadow dispelled · +2 starlight');
      if (enemy.encounter && this.encounterKind && !this.enemies.some((e) => e.encounter && e.hp > 0)) {
        const kind = this.encounterKind; this.encounterKind = undefined;
        void this.complete(kind, true, this.encounterBefore, kind === 'boss' ? 'The heroes defeated the guardian and restored the spring.' : 'The heroes drove back the gathering shadows.');
      }
    }
  }

  private hurt(deferEnding = false): void {
    if (!this.state || this.invulnerable > 0 || this.ended || !this.state.loseHeart()) return;
    this.invulnerable = 2.5; this.heroes.forEach((hero) => { hero.hurt = 1.2; }); this.ui.damage(); if (this.sound) this.sfx.hurt();
    if (this.state.defeated && !deferEnding) { void this.finish(false); }
  }

  private async finish(victory: boolean): Promise<void> {
    if (this.ended || !this.state) return;
    this.ended = true; this.busy = true; this.keys.clear(); this.ui.challenge(); this.ui.boss(); this.ui.context();
    if (this.encounterKind && this.beat) {
      this.state.outcomes.push({ beatId: this.beat.id, kind: this.encounterKind, success: false, heartsLost: Math.max(0, this.encounterBefore - this.state.hearts), summary: 'The shadows overcame the heroes, but their story can begin again.', perPlayer: [{ success: false, stars: 0 }, { success: false, stars: 0 }] });
    }
    this.world.marker.visible = false; this.ui.quest(victory ? 'A kingdom warmed by kindness' : 'A tale unfinished', 'The storyteller is binding your adventure.');
    const book = await this.story.storybook(this.state.history(), victory); await this.ui.ending(book);
  }

  private burst(at: T.Vector3, color: number, count: number): void {
    const mat = new T.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < count; i++) {
      const particle = new T.Mesh(this.sparkGeometry, mat.clone()); particle.position.copy(at); this.scene.add(particle);
      const life = 0.4 + Math.random() * 0.5;
      this.sparks.push({ mesh: particle, velocity: new T.Vector3((Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5), life, max: life });
    }
    mat.dispose();
  }

  private frame(timestamp: number): void {
    const dt = this.previous ? Math.min(0.045, (timestamp - this.previous) / 1000) : 0;
    this.previous = timestamp;
    if (document.hidden) return;
    const paused = this.ui.blocked || this.busy || this.ended;
    if (!paused) this.time += dt;
    this.world.update(paused ? 0 : dt, this.time);
    this.heroes.forEach((hero) => hero.update(paused ? 0 : dt, this.time));
    if (this.state) {
      if (!paused) this.update(dt);
      this.updateCamera(dt);
      this.ui.update(this.state, this.stamina);
      this.mapTimer += dt;
      if (this.mapTimer > 0.12) { this.mapTimer = 0; this.ui.drawMap(this.heroes[0].root.position, this.heroes[1].root.position, this.target, this.world.objects, this.yaw); }
    } else {
      this.time += dt;
      this.camera.position.x = 12 + Math.sin(this.time * 0.06) * (this.reducedMotion ? 0 : 2); this.camera.lookAt(0, 2.4, 17);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private update(dt: number): void {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.stamina = Math.min(1, this.stamina + dt * 0.16);
    if (this.keys.has('KeyC')) this.yaw += dt * 1.4;
    if (this.keys.has('KeyV')) this.yaw -= dt * 1.4;
    for (let i = 0; i < 2; i++) {
      const hero = this.heroes[i], p = hero.root.position, keys = MOVE[i];
      const beforeX = p.x, beforeZ = p.z;
      this.attackCooldown[i] = Math.max(0, this.attackCooldown[i] - dt); this.spellCooldown[i] = Math.max(0, this.spellCooldown[i] - dt);
      let dx = Number(this.keys.has(keys[1])) - Number(this.keys.has(keys[0]));
      let dz = Number(this.keys.has(keys[3])) - Number(this.keys.has(keys[2]));
      const moving = dx !== 0 || dz !== 0;
      const poseKeys = i === 0 ? ['Digit1', 'Digit2', 'Digit3'] : ['KeyI', 'KeyO', 'KeyP'];
      hero.pose = ['arms-up', 't-pose', 'crouch'][poseKeys.findIndex((key) => this.keys.has(key))] ?? '';
      if (i === 1 && this.trial?.type === 'pose' && this.time > this.companionUntil) hero.pose = this.heroes[0].pose;
      if (i === 1 && this.time > this.companionUntil && this.enemies.some((enemy) => enemy.boss && enemy.windup > 0 && enemy.attack === 'shadow-wave')) hero.pose = 'crouch';
      if (this.physics?.setCrouching(i, hero.pose === 'crouch')) hero.pose = 'crouch';
      let direction = new T.Vector3(dx * Math.cos(this.yaw) + dz * Math.sin(this.yaw), 0, -dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw));
      if (i === 1 && !moving && this.time > this.companionUntil && !this.trial) {
        const leader = this.heroes[0].root.position; const d = distance(p, leader);
        if (d > 2.5) direction.copy(leader).sub(p).setY(0);
        else direction.set(0, 0, 0);
        if (this.enemies.some((enemy) => enemy.boss && enemy.windup > 0 && enemy.attack === 'frost-gaze')) direction.set(0, 0, 0);
      }
      let speed = direction.lengthSq() ? 4.7 : 0;
      if (i === 0 && speed && this.keys.has('ShiftLeft') && this.stamina > 0.03 && !this.trial) { speed = 8.5; this.stamina = Math.max(0, this.stamina - dt * 0.32); }
      if (i === 1 && direction.lengthSq() > 0 && !this.trial && distance(p, this.heroes[0].root.position) > 5 && this.time > this.companionUntil) speed = 7.5;
      if (this.trial?.type === 'pose') speed = 0;
      if (hero.pose === 'crouch') speed *= 0.5;
      if (heightAt(p.x, p.z) < -0.4) speed *= 0.56;
      if (this.dodge[i] > 0) { this.dodge[i] -= dt; direction.copy(this.dodgeDirection[i]); speed = 19; }
      direction.normalize();
      const velocity = this.movementVelocity[i];
      velocity.lerp(direction.clone().multiplyScalar(speed), this.dodge[i] > 0 ? 1 : 1 - Math.exp(-dt * (speed ? 12 : 20)));
      if (this.trial?.type === 'pose') velocity.set(0, 0, 0);
      this.velocityY[i] -= dt * 19;
      if (this.physics) {
        const delta = velocity.clone().multiplyScalar(dt); delta.y = this.velocityY[i] * dt;
        let next = this.physics.move(i, p, delta);
        if (i === 1 && !moving && speed && distance(next, p) < dt * 0.3) {
          next = this.physics.move(i, p, new T.Vector3(-direction.z * speed * dt, delta.y, direction.x * speed * dt));
        }
        p.copy(next);
        if (this.physics.isGrounded(i) && this.velocityY[i] < 0) this.velocityY[i] = 0;
        this.jump[i] = this.physics.isGrounded(i) ? 0 : Math.max(0.01, p.y - heightAt(p.x, p.z));
      } else {
        const next = moveOnGround(p, velocity.x * dt, velocity.z * dt, this.world.solids); p.x = next.x; p.z = next.z;
        this.jump[i] = Math.max(0, this.jump[i] + this.velocityY[i] * dt);
        if (!this.jump[i]) this.velocityY[i] = Math.max(0, this.velocityY[i]);
        p.y = Math.max(heightAt(p.x, p.z), -0.55) + this.jump[i];
      }
      if (direction.lengthSq()) hero.heading = Math.atan2(direction.x, direction.z);
      // Rapier settling on slopes leaves ~0.3 u/s of jitter; below this dead zone a hero counts as standing still
      // (otherwise idle heroes animate as walking and the stillness challenge can never be passed).
      const measured = dt > 0 ? Math.hypot(p.x - beforeX, p.z - beforeZ) / dt : 0; hero.moving = measured > 0.7 ? measured : 0; hero.body.rotation.z = this.dodge[i] > 0 ? Math.sin(this.dodge[i] / 0.27 * Math.PI) * 0.55 : 0;
    }
    const p = this.heroes[0].root.position;
    if (this.fairy.visible) this.fairy.position.set(p.x + Math.sin(this.time * 2) * 0.65, p.y + 2.25 + Math.sin(this.time * 3) * 0.14, p.z + Math.cos(this.time * 2) * 0.65);
    const region = regionAt(p.x, p.z);
    if (region !== this.region) {
      this.region = region; this.state!.visit(region); this.ui.discover(REGIONS[region].name);
    }
    if (!this.encounterKind && !this.trial) {
      this.nearest = this.world.objects.filter((o) => distance(p, o) < 2.4).sort((a, b) => distance(p, a) - distance(p, b))[0];
      this.ui.context(this.target && distance(p, this.target) < 3.2 ? this.target.name : this.nearest?.name);
    } else this.ui.context();
    if (this.target && !this.trial && !this.encounterKind) this.ui.quest(this.target.name, `${Math.round(distance(p, this.target))} steps away · follow the golden beacon`);
    for (const shard of this.world.shards) {
      if (!shard.taken && distance(p, shard.mesh.position) < 1) {
        shard.taken = true; shard.mesh.visible = false; this.state!.stars[0]++; this.burst(shard.mesh.position, 0xffe7a6, 7); if (this.sound) this.sfx.tick();
      }
    }
    this.updateTrial(dt); if (this.ended) { this.physics?.step(dt); return; }
    this.updateEnemies(dt); this.updateBolts(dt); this.updateSparks(dt);
    this.companionCast -= dt;
    if (this.companionCast <= 0 && this.time > this.companionUntil && !this.trial && this.closestEnemy(this.heroes[1].root.position, 13)) { this.cast(1); this.companionCast = this.state!.has('fairy-ally') ? 0.85 : 2.1; }
    this.physics?.step(dt);
  }

  private updateTrial(dt: number): void {
    const trial = this.trial; if (!trial) return;
    trial.elapsed += dt;
    if (trial.type === 'freeze') {
      if (this.heroes.some((hero) => hero.moving > 0.1)) trial.moved += dt;
      this.ui.challenge('Let the frost pass', `Stay still · ${Math.max(0, trial.duration - trial.elapsed).toFixed(1)} seconds`, trial.elapsed / trial.duration);
      if (trial.elapsed >= trial.duration) {
        const success = trial.moved < 0.25; this.trial = undefined;
        if (!success) this.hurt(true);
        if (!this.ended) { this.ui.toast(success ? 'The old magic recognizes your patience.' : 'The frost found you. Shadows gather nearby.'); void this.complete('freeze', success, trial.before, success ? 'Both heroes held perfectly still through the frost.' : 'The heroes moved and the frost found them.'); }
      }
    } else {
      const pose = trial.poses[trial.poseIndex];
      const name = { 'arms-up': 'Raise your arms', 't-pose': 'Spread your arms', crouch: 'Crouch low' }[pose];
      const key = { 'arms-up': '1', 't-pose': '2', crouch: '3' }[pose];
      const matching = this.heroes.every((hero) => hero.pose === pose);
      if (matching) trial.held += dt;
      else trial.held = Math.max(0, trial.held - dt * 0.5);
      this.ui.challenge(name, `Hold ${key} · seal ${trial.poseIndex + 1} of ${trial.poses.length} · ${Math.max(0, trial.secondsPerPose - trial.elapsed).toFixed(1)}s`, trial.held / 1.2);
      if (trial.held >= 1.2) {
        trial.poseIndex++; trial.held = 0; trial.elapsed = 0; this.burst(this.heroes[0].root.position.clone().add(new T.Vector3(0, 1.5, 0)), 0x9fe7d0, 14); if (this.sound) this.sfx.chime();
        if (trial.poseIndex >= trial.poses.length) { this.trial = undefined; this.ui.toast('The ancient seal opens for you.'); void this.complete('pose', true, trial.before, 'The heroes mirrored every ancient shape and opened the gate.'); }
      } else if (trial.elapsed >= trial.secondsPerPose) {
        this.trial = undefined; this.hurt(true); if (!this.ended) void this.complete('pose', false, trial.before, 'The ancient seal rejected the heroes and summoned its guardians.');
      }
    }
  }

  private updateEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) { if (enemy.pawn !== undefined) { this.physics?.removeCharacter(enemy.pawn); enemy.pawn = undefined; } continue; }
      if (this.ended || this.trial) continue;
      const target = this.heroes.reduce((a, b) => distance(a.root.position, enemy.root.position) < distance(b.root.position, enemy.root.position) ? a : b);
      const p = enemy.root.position, d = distance(p, target.root.position);
      const motion = new T.Vector3(0, -dt * 4, 0);
      enemy.cooldown -= dt; enemy.core.position.y = (enemy.boss ? 1.9 : 0.9) + Math.sin(this.time * 3 + enemy.home.x) * 0.13;
      if (enemy.windup > 0) {
        enemy.windup -= dt; enemy.ring.visible = true; enemy.ring.scale.setScalar(1 + Math.sin(this.time * 11) * 0.04);
        if (enemy.boss) this.ui.boss(enemy.boss.name, enemy.hp / enemy.maxHp, enemy.attack === 'frost-gaze' ? 'Frost gaze · stand perfectly still' : 'Shadow wave · hold 3 to crouch, or dodge away');
        if (enemy.windup <= 0) {
          enemy.ring.visible = false; enemy.cooldown = enemy.boss ? enemy.boss.vulnerableSec : 2;
          this.burst(p.clone().add(new T.Vector3(0, 0.2, 0)), enemy.boss ? 0xa4d8df : 0xf7b69a, 17);
          const victim = this.heroes.findIndex((hero, i) => distance(p, hero.root.position) < (enemy.boss ? 8 : 2.6) && this.dodge[i] <= 0 && this.jump[i] < 0.7 && this.physics?.wallDistance(p.clone().add(new T.Vector3(0, 1, 0)), hero.root.position.clone().add(new T.Vector3(0, 1, 0))) === undefined && (enemy.attack === 'frost-gaze' ? hero.moving > 0.1 : enemy.attack === 'shadow-wave' ? hero.pose !== 'crouch' : true));
          if (victim >= 0) this.hurt();
        }
      } else if (d < (enemy.boss ? 11 : 2.6) && enemy.cooldown <= 0) {
        enemy.windup = enemy.boss ? enemy.boss.telegraphSec : 0.9;
        enemy.attack = enemy.boss ? enemy.boss.attacks[Math.floor(this.time) % enemy.boss.attacks.length] : 'strike';
      } else if (d < (enemy.encounter ? 35 : 12) && d > (enemy.boss ? 5 : 1.7)) {
        const dx = target.root.position.x - p.x, dz = target.root.position.z - p.z;
        const speed = enemy.boss ? 1.4 : 2.3;
        motion.x = dx / d * speed * dt; motion.z = dz / d * speed * dt;
      }
      if (this.physics && enemy.pawn !== undefined) p.copy(this.physics.move(enemy.pawn, p, motion));
      else { const next = moveOnGround(p, motion.x, motion.z, this.world.solids); p.x = next.x; p.z = next.z; p.y = Math.max(heightAt(p.x, p.z), -0.3); }
      enemy.root.rotation.y = Math.atan2(target.root.position.x - p.x, target.root.position.z - p.z);
      if (enemy.visual) enemy.visual.rotation.z = Math.sin(this.time * 2 + enemy.home.x) * 0.025;
      if (enemy.actor) { enemy.actor.heading = 0; enemy.actor.moving = motion.length() / Math.max(dt, 0.001); enemy.actor.pose = enemy.windup > 0 ? 'arms-up' : ''; enemy.actor.update(dt, this.time); }
      if (enemy.boss && enemy.windup <= 0) this.ui.boss(enemy.boss.name, enemy.hp / enemy.maxHp, 'The ward is down · strike now');
    }
  }

  private updateBolts(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]; bolt.life -= dt; const from = bolt.mesh.position.clone(); bolt.mesh.position.addScaledVector(bolt.velocity, dt);
      const wall = this.physics?.wallDistance(from, bolt.mesh.position);
      if (wall !== undefined) { bolt.mesh.position.copy(from).addScaledVector(bolt.velocity.clone().normalize(), wall); }
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const center = enemy.root.position.clone().add(new T.Vector3(0, enemy.boss ? 1.8 : 0.9, 0));
        const line = new T.Line3(from, bolt.mesh.position); const nearest = line.closestPointToPoint(center, true, new T.Vector3());
        if (nearest.distanceTo(center) < (enemy.boss ? 1.5 : 0.7)) { this.hit(enemy, 1, bolt.player); bolt.life = 0; break; }
      }
      if (wall !== undefined) { this.burst(bolt.mesh.position, 0xe4dcb7, 4); bolt.life = 0; }
      if (bolt.life <= 0) { this.scene.remove(bolt.mesh); bolt.mesh.geometry.dispose(); (bolt.mesh.material as T.Material).dispose(); this.bolts.splice(i, 1); }
    }
  }

  private updateSparks(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i]; spark.life -= dt; spark.mesh.position.addScaledVector(spark.velocity, dt); spark.velocity.y -= dt * 4;
      (spark.mesh.material as T.MeshBasicMaterial).opacity = Math.max(0, spark.life / spark.max);
      if (spark.life <= 0) { this.scene.remove(spark.mesh); (spark.mesh.material as T.Material).dispose(); if (spark.mesh.geometry !== this.sparkGeometry) spark.mesh.geometry.dispose(); this.sparks.splice(i, 1); }
    }
  }

  private updateCamera(dt: number): void {
    const p = this.heroes[0].root.position;
    this.focus.lerp(p.clone().add(new T.Vector3(0, 1.4, 0)), 1 - Math.exp(-dt * 6));
    const offset = new T.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.zoom);
    const wall = this.physics?.wallDistance(this.focus, this.focus.clone().add(offset));
    if (wall !== undefined) offset.multiplyScalar(Math.min(1, Math.max(wall * 0.5, wall - 0.2) / offset.length()));
    else if (!this.physics) offset.multiplyScalar(cameraReach(this.focus, this.focus.clone().add(offset), this.world.solids));
    const target = this.focus.clone().add(offset); target.y = Math.max(target.y, heightAt(target.x, target.z) + 1.2);
    const finalWall = this.physics?.wallDistance(this.focus, target);
    if (finalWall !== undefined) { const direction = target.clone().sub(this.focus).normalize(); target.copy(this.focus).addScaledVector(direction, Math.max(finalWall * 0.5, finalWall - 0.2)); }
    if (wall !== undefined || finalWall !== undefined) this.camera.position.copy(target); else this.camera.position.lerp(target, 1 - Math.exp(-dt * 9)); this.camera.lookAt(this.focus);
    this.heroes[0].root.visible = this.camera.position.distanceTo(this.focus) > 0.8;
    this.sun.position.set(p.x - 28, 48, p.z + 20); this.sun.target.position.set(p.x, 0, p.z);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.narrator.stop();
    this.events.abort(); this.renderer.setAnimationLoop(null);
    this.physics?.dispose();
    this.scene.traverse((object) => { if (object instanceof T.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((mat) => mat.dispose()); } });
    this.sparkGeometry.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); this.ui.root.remove(); this.ui.modal.remove(); document.querySelector('.adventure-start')?.remove();
  }
}
