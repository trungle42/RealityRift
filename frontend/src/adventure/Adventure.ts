import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { BeatOutcome, BossSpec, OutcomeKind, PlayerIndex, PoseId, StoryBeat, StoryProvider } from '../contracts';
import { Narrator } from '../audio/Narrator';
import { Audio } from './Audio';
import { Fx } from './Fx';
import { CameraRig } from './CameraRig';
import { Post, fadeOccluders, occlusion } from './Post';
import { REGIONS } from '../campaign/locations';
import { GameState } from '../game/GameState';
import { ScriptedStory } from '../story/ScriptedStory';
import { GeminiStory } from '../story/GeminiStory';
import { Actor, material, mesh } from './Actor';
import { Interface } from './Interface';
import { World, type WorldObject } from './World';
import { Scanner } from './Scanner';
import { colourOf, heroFor, KeyboardShapes, SHAPE_ABILITY, SHAPE_COOLDOWN, ShapeCooldowns, shapeFromWand, type ShapeSource, type WandColour, type WandShape } from './forge';
import { WandModel } from './WandModel';
import { WeaponsHud } from './WeaponsHud';
import { BOSS_ELEMENTS, ELEMENT_COLOR, elementMultiplier, scaledDamage, wandSpell, type Element, type SpellSpec, type Weapon } from './weapon';
import { Physics } from './Physics';
import { PhoneInput } from './PhoneInput';
import { CvInput } from './CvInput';
import { POSE_SHAPE } from './cvMath';
import { WandHud } from './WandHud';
import { Cinematics } from './Cinematics';
import { encounterSpawn, heightAt, moveOnGround, objectiveFor, pathDistance, regionAt, type Position } from './terrain';
import './adventure.css';

interface Enemy {
  root: T.Group; ring: T.Mesh; core: T.Mesh; hp: number; maxHp: number; home: Position;
  windup: number; cooldown: number; boss?: BossSpec; encounter: boolean; attack: string; pawn?: number; visual?: T.Object3D; actor?: Actor;
  knock: T.Vector3; flash: number; dying: number; flashMats: T.MeshStandardMaterial[];
  /** Camp AI: idle (wander near home) -> alert ("!") -> chase -> return (leash, heals) -> idle. */
  ai: 'idle' | 'alert' | 'chase' | 'return'; aiT: number; wander?: Position; camp?: Camp; bar?: T.Sprite; shown: number; elite: boolean;
}
interface Camp { name: string; x: number; z: number; size: number; members: Enemy[]; clearedAt: number; fire: T.Group; flames: T.Mesh[] }
interface Pickup { root: T.Group; kind: 'heart' | 'star'; age: number }
/** Enemy camps placed off the story objectives: two ambush the castle and cave routes, one teaches combat near the start. */
const CAMPS: { name: string; x: number; z: number; size: number }[] = [
  { name: 'Bramble Hollow', x: -14, z: 46, size: 2 }, { name: 'Mossback Glade', x: 22, z: 4, size: 3 },
  { name: 'Western Thicket', x: -24, z: 22, size: 2 }, { name: 'Rosewater Ambush', x: -25, z: -21, size: 3 },
  { name: 'Crystal Road Ambush', x: 24, z: -25, size: 2 }, { name: 'Elder Woods', x: -48, z: 8, size: 2 },
  { name: 'Eastern Ridge', x: 50, z: 4, size: 2 },
];
interface PendingHit { at: number; player: PlayerIndex; damage: number; reach: number; arc: number; heavy: boolean; step: number }
/**
 * Three-step sword combo, each with its own clip, timing and weight (horizontal, overhead, thrust). `hit` is when the
 * blade connects; the Actor times each clip's contact frame to it, so a little more wind-up gives the swing weight.
 */
const COMBO = [
  { clip: 'strike', length: 0.42, hit: 0.16, damage: 2, reach: 2.9, arc: 2.2, tilt: 0.15, color: 0xfff0c4 },
  { clip: 'sword_slash_overhead', length: 0.46, hit: 0.2, damage: 2, reach: 3.0, arc: 1.6, tilt: 1.25, color: 0xfff6d6 },
  { clip: 'sword_thrust', length: 0.55, hit: 0.22, damage: 3, reach: 3.5, arc: 0.9, tilt: 0.05, color: 0xffe39a },
];
/** Roll: ~4.5 m tumble, 1 s of invincibility from the start, 4 s cooldown. */
const ROLL = { length: 0.55, speed: 8.2, iframes: 1, cooldown: 4 };
const FLASH_COOLDOWN = 6;
/**
 * The demo run's single wave: three shadows close in first and three more arrive a few seconds later, so the fight
 * lasts long enough to show off (about 15-20 s) without dragging.
 */
const WAVE = [{ radius: 8, angle: -0.5 }, { radius: 8.8, angle: 0 }, { radius: 9.6, angle: 0.5 }, { radius: 15, angle: -0.8 }, { radius: 16.5, angle: 0.15 }, { radius: 18, angle: 0.9 }];
const WAVE_HP = 5;
/** `?story=full` (or window.RIFT_FULL_STORY, for the in-browser checks) plays the whole storyteller-driven tale instead of the short demo run. */
const fullStory = () => (window as unknown as { RIFT_FULL_STORY?: boolean }).RIFT_FULL_STORY === true || new URLSearchParams(location.search).get('story') === 'full';
interface Bolt { mesh: T.Mesh; velocity: T.Vector3; life: number; player: PlayerIndex; color: number; element?: Element; damage: number; pierce: number; chain: number; chainRadius: number; hit: Set<Enemy> }
/** A delayed area strike (meteor): telegraphed on the ground, lands after `delay`. */
interface Strike { at: number; delay: number; pos: T.Vector3; radius: number; damage: number; color: number; element?: Element; player: PlayerIndex }
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
  private readonly sfx = new Audio();
  private readonly fx: Fx;
  private readonly rig: CameraRig;
  private readonly post: Post;
  private readonly narrator = new Narrator();
  private lock?: Enemy;
  private combo = { step: 0, until: 0 };
  private readonly pending: PendingHit[] = [];
  private hitstop = 0;
  private flurry = 0;
  private flurryTarget?: Enemy;
  private readonly stepDistance = [0, 0];
  private readonly airborne = [false, false];
  private readonly fallSpeed = [0, 0];
  private companionSide = 1;
  /** Single player by default; `?players=2` (or window.RIFT_PLAYERS = 2) restores the second hero. */
  private readonly solo = !((window as unknown as { RIFT_PLAYERS?: number }).RIFT_PLAYERS === 2 || new URLSearchParams(location.search).get('players') === '2');
  /** Heroes actually in play: just the ranger in solo. */
  private get active(): Actor[] { return this.solo ? [this.heroes[0]] : this.heroes; }
  private readonly camps: Camp[] = [];
  private readonly pickups: Pickup[] = [];
  private readonly wheel = document.createElement('div');
  /** Reality Rift: each hero's relic (a scanned object), infusing their wand and sword with its element. */
  private readonly weapons: (Weapon | undefined)[] = [];
  /** Each hero's two weapons: the sword in the right hand, this wand in the left. Drawn shapes cast with per-shape cooldowns. */
  private readonly wands: (WandModel | undefined)[] = [];
  private readonly wandCooldowns = new ShapeCooldowns();
  private readonly hud = new WeaponsHud();
  /** Wand shapes from the keyboard stand-in (4-7 yellow, 8/9/0/- blue); the CV tracker's completed shapes arrive through `cv`. */
  private readonly shapes: ShapeSource = new KeyboardShapes();
  private readonly strikes: Strike[] = [];
  private readonly scanner = new Scanner((weapon, hero) => this.equip(weapon, hero));
  /** Phone joystick (optional): analog movement for hero 0, with keyboard always winning. */
  private phone?: PhoneInput;
  private cv?: CvInput;
  private wandHud?: WandHud;
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
  private get yaw(): number { return this.rig.yaw; }
  private set yaw(value: number) { this.rig.yaw = value; }
  private get pitch(): number { return this.rig.pitch; }
  private set pitch(value: number) { this.rig.pitch = value; }
  private get zoom(): number { return this.rig.zoom; }
  private set zoom(value: number) { this.rig.zoom = value; }
  private jump = [0, 0];
  private velocityY = [0, 0];
  private dodge = [0, 0];
  private readonly dodgeDirection = [new T.Vector3(), new T.Vector3()];
  /** Roll (Q): a tumbling dodge with invincibility frames. Flash step (R) is the old blink-dash, now a cooldown ability. */
  private rollTime = [0, 0];
  private rollIframes = [0, 0];
  private rollCooldown = [0, 0];
  private flashCooldown = [0, 0];
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
  private readonly cinema = new Cinematics();
  /** The short demo run: brief with Willow, hold the glade against one wave, then face the boss. */
  private demo?: { stage: 'briefing' | 'wave' | 'boss' | 'done'; started: number; foes: number; willow: Position };
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
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.02;
    this.renderer.domElement.className = 'adventure-canvas'; this.renderer.domElement.setAttribute('aria-label', 'Storybound interactive 3D world'); this.renderer.domElement.tabIndex = 0;
    document.getElementById('app')!.append(this.renderer.domElement);
    // Golden-hour light after Rishaan's painted forest: warm sun, emerald shade, soft haze.
    this.scene.background = new T.Color(0xcbd9c2); this.scene.fog = new T.FogExp2(0xd2d6b4, 0.0088);
    this.scene.add(new T.HemisphereLight(0xd9ecdf, 0x4f5f33, 1.35));
    const sky = new T.Mesh(new T.SphereGeometry(270, 32, 18), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { zenith: { value: new T.Color(0x6fa9c2) }, horizon: { value: new T.Color(0xf2e2b3) }, sunDir: { value: new T.Vector3(-0.55, 0.42, 0.36).normalize() } },
      vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 direction;
        void main(){ vec3 d = normalize(direction); float h = pow(max(0.0, d.y), 0.5);
          vec3 c = mix(horizon, zenith, h); float s = max(0.0, dot(d, sunDir));
          c += vec3(1.0, 0.85, 0.55) * (pow(s, 64.0) * 1.6 + pow(s, 6.0) * 0.25);
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    this.scene.add(sky);
    this.sun.color.set(0xffdfa8); this.sun.intensity = 3.1;
    this.sun.position.set(-34, 40, 22); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.radius = 3;
    Object.assign(this.sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 110 });
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.04; this.scene.add(this.sun, this.sun.target);
    this.world = new World(this.scene);
    this.rig = new CameraRig(this.camera, 0, 0.3, 8);
    this.fx = new Fx(this.scene);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.wheel.className = 'stamina-wheel'; this.wheel.innerHTML = '<svg viewBox="0 0 40 40"><circle class="track" cx="20" cy="20" r="16"/><circle class="fill" cx="20" cy="20" r="16"/></svg>';
    document.body.append(this.wheel);
    mesh(new T.SphereGeometry(0.1, 8, 6), material(0xf6d6e4, 0xf6d6e4), this.fairy);
    for (const side of [-1, 1]) { const wing = mesh(new T.SphereGeometry(0.16, 8, 5), material(0xdcf2df, 0x6b9474), this.fairy, side * 0.12, 0.07); wing.scale.set(0.5, 1, 0.15); }
    this.fairy.visible = false; this.scene.add(this.fairy);
    this.heroes.forEach((hero, i) => { hero.root.position.set(i ? 1.6 : 0, heightAt(i ? 1.6 : 0, 34), i ? 35 : 34); this.scene.add(hero.root); });
    this.camera.position.set(13, 10, 45); this.camera.lookAt(0, 2, 17);
    const scripted = new ScriptedStory();
    this.story = import.meta.env.VITE_STORY === 'scripted' || new URLSearchParams(location.search).get('story') === 'scripted' ? scripted : new GeminiStory(scripted);
    this.bindInput(); this.renderer.setAnimationLoop((time) => this.frame(time));
    this.ui.root.classList.add('before-start');
    // Dev-only handle for automated playtests (stripped from production builds).
    if (import.meta.env.DEV) (window as unknown as { __rift: unknown }).__rift = { game: this, T };
  }

  async start(): Promise<void> {
    await this.loadModels();
    if (this.disposed) return;
    const physics = await Physics.create(this.world.collisionSurfaces(), this.world.treeSolids);
    if (this.disposed) { physics.dispose(); return; }
    this.physics = physics;
    // The run opens a few strides in front of Willow on the forest path, facing her.
    const willow = this.world.objects.find((o) => o.id === 'forest:lore') ?? { x: 0.5, z: -2 };
    const spot = { x: willow.x, z: willow.z + 5.5 };
    this.heroes.forEach((hero, i) => { const x = spot.x + (i ? 1.6 : 0), z = spot.z + (i ? 1 : 0); hero.root.position.set(x, heightAt(x, z) + 0.2, z); hero.heading = Math.PI; hero.root.rotation.y = Math.PI; });
    if (!fullStory()) this.demo = { stage: 'briefing', started: 0, foes: 0, willow: { x: willow.x, z: willow.z } };
    if (this.solo) { this.heroes[1].root.position.set(500, 0, 500); this.heroes[1].root.visible = false; }
    this.heroes.forEach((hero) => physics.addCharacter(hero.root.position));
    // Scenery between the camera and the hero dissolves instead of blocking the view.
    fadeOccluders(this.world.root, (o) => o.name === 'ground' || o.name === 'lake' || o.userData.noFade === true);
    document.getElementById('loading')?.remove();
    const party = await this.ui.start(this.solo);
    this.state = new GameState(party); this.scanner.setHeroes(this.solo ? [] : party.map((p) => p.name)); this.hud.setHeroes(this.solo ? [party[0].name] : party.map((p) => p.name)); this.shapes.subscribe((colour, shape) => this.onShape(colour, shape)); this.sfx.unlock(); this.sfx.setMuted(!this.sound); this.ui.discover('Whispering Wood');
    this.rig.snap(this.heroes[0].root.position);
    this.ui.toast('Click the world to look with the mouse · WASD move · click / J strike · F spell · Q roll · R flash step · Z lock on · Esc frees the mouse');
    this.phone = new PhoneInput((connected) => this.ui.toast(connected ? 'Phone joystick connected: drag your thumb to move' : 'Phone joystick disconnected'));
    // Body tracker (cv_2): a phone slash strikes, a real jump leaps; ignored while the scanner is open, like the keyboard.
    this.cv = new CvInput({ status: (connected) => this.ui.toast(connected ? 'Body tracker connected: slash with the phone to strike, jump to leap' : 'Body tracker disconnected'), slash: () => { if (!this.scanner.open) this.strike(0); }, jump: () => { if (!this.scanner.open) this.leap(0); }, complete: (name, wand) => { const colour = colourOf(name), shape = colour && shapeFromWand(colour, wand); if (colour && shape) this.onShape(colour, shape); } });
    this.wandHud = new WandHud(this.cv, this.ui.root);
    this.scanner.setFrameSource(this.cv);   // while the tracker runs, scans use its camera pictures: one program owns the webcam
    // The default is the short run (about a minute): talk to Willow, hold the glade against one wave, then the boss
    // comes for you. `?story=full` plays the whole storyteller-driven tale with camps, trials and Gemini beats.
    if (!this.demo) { this.buildCamps(); await this.loadBeat(this.story.begin(party)); return; }
    // Wall-clock time: the game clock pauses during dialogue, but the run's time should include the briefing.
    this.demo.started = performance.now();
    this.yaw = 0; this.rig.snap(this.heroes[0].root.position);
    // No golden beacon here: it would stand right on top of Willow. The quest line and the E prompt lead the way.
    this.target = { ...this.demo.willow, name: 'Speak with Willow' }; this.world.marker.visible = false;
    this.ui.quest('Speak with Willow', 'She waits just ahead on the path · walk up and press E');
    this.ui.discover('The Whispering Wood');
  }

  /** Willow explains the quest: what was stolen, who took it, and why the heroes must fight. */
  private async briefing(): Promise<void> {
    if (!this.demo || this.demo.stage !== 'briefing' || !this.state) return;
    this.busy = true; this.keys.clear(); this.ui.context(); this.world.marker.visible = false; this.target = undefined;
    if (document.pointerLockElement) document.exitPointerLock();
    const hero = this.state.party[0].name;
    await this.cinema.briefing({ name: 'Willow', title: 'Waykeeper of the Whispering Wood', portrait: '/art/prop-lore.webp' }, [
      `${hero}! Thank the old roots you came. Listen closely — we have very little time.`,
      'Morwen the Frost Witch has stolen the last warm spring of Evermere. Without it, the rivers freeze, the fields die, and winter never ends.',
      'Her shadow horde is marching on this glade to break the waystone. Hold them back, and Morwen will have to face you herself.',
      'When she comes, roll away from her frost and strike while her ward is down. Break her spell, and the spring flows home.',
    ], {
      title: 'The Last Warm Spring',
      summary: 'Defend the Whispering Wood and win back the stolen spring.',
      objectives: ['Defeat the shadow horde', 'Face Morwen the Frost Witch', 'Restore the last warm spring'],
    });
    this.busy = false;
    if (!this.ended) this.startWave();
  }

  /** One wave: the horde pours out of the treeline in front of the hero. */
  private startWave(): void {
    const demo = this.demo!, p = this.heroes[0].root.position;
    demo.stage = 'wave'; demo.foes = 0;
    this.encounterBefore = this.state!.hearts; this.encounterKind = 'encounter';
    this.ui.quest('Defeat the shadow horde', `Shadows defeated 0 / ${WAVE.length} · J strike · F spell · Q roll`);
    this.ui.toast('They are coming! J to strike · F to cast · Q to roll · Z to lock on');
    this.sfx.warn(); this.rig.addTrauma(0.25);
    // Fan the horde across the view (the camera looks down -Z here). All spawn now, so the wave can't be "cleared"
    // early; the far group simply takes a few seconds longer to arrive.
    for (const { radius, angle } of WAVE) {
      this.spawnEnemy(p.x + Math.sin(Math.PI + angle) * radius, p.z + Math.cos(Math.PI + angle) * radius, undefined, true);
      const foe = this.enemies[this.enemies.length - 1]; if (foe) foe.hp = foe.maxHp = WAVE_HP;
    }
  }

  /** The wave is broken: Morwen arrives and strides in along the path. */
  private async startBoss(): Promise<void> {
    const demo = this.demo!; demo.stage = 'boss';
    // Willow's blessing: the horde is broken, so the heroes face the witch at full strength.
    const healed = this.state!.hearts < 3;
    while (this.state!.hearts < 3 && this.state!.gainHeart()) { /* refill */ }
    const at = this.heroes[0].root.position.clone().add(new T.Vector3(0, 1, 0));
    this.fx.motes(at, 0xc9ffe0, 40, 0.8, 2.6, 0.3, 1.6); this.fx.shockwave(this.heroes[0].root.position, 0x9ff0d0, 4, 0.8);
    this.ui.quest('Face Morwen the Frost Witch', 'Roll from her frost · strike while her ward is down');
    this.ui.toast(healed ? 'Willow’s blessing restores your hearts · the air turns to ice…' : 'The air turns to ice…'); this.sfx.freeze();
    await new Promise((resolve) => window.setTimeout(resolve, 1400));
    if (this.ended || this.disposed) return;
    const p = this.heroes[0].root.position;
    // Tuned so the fight takes three or four dodge-then-strike cycles (about 25 s), not one lucky window.
    const boss: BossSpec = { kind: 'frost-witch', name: 'Morwen the Frost Witch', maxHp: 28, attacks: ['frost-gaze', 'shadow-wave'], telegraphSec: 1.8, vulnerableSec: 3.2 };
    this.encounterBefore = this.state!.hearts; this.encounterKind = 'boss';
    // She appears on open ground with nothing between her and the hero, preferring the direction the camera already
    // faces, so she visibly strides into view instead of getting stuck behind a signpost or tree.
    const facing = Math.atan2(-Math.sin(this.rig.viewYaw), -Math.cos(this.rig.viewYaw)), eye = new T.Vector3(p.x, p.y + 1.2, p.z);
    let spot = { x: p.x, z: p.z - 13 }, best = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x = p.x + Math.sin(a) * 13, z = p.z + Math.cos(a) * 13;
      const open = encounterSpawn({ x, z }, p, this.world.solids);
      if (Math.hypot(open.x - x, open.z - z) > 0.5 || heightAt(x, z) < -0.3) continue;
      if (this.physics?.wallDistance(eye, new T.Vector3(x, heightAt(x, z) + 1.2, z)) !== undefined) continue;
      const score = Math.cos(a - facing); if (score > best) { best = score; spot = { x, z }; }
    }
    this.spawnEnemy(spot.x, spot.z, boss, true); this.sfx.roar(); this.rig.addTrauma(0.6);
    const spawned = this.enemies[this.enemies.length - 1];
    if (spawned) {
      this.fx.shockwave(spawned.root.position, 0x9fc6ff, 10, 1.2, 0.1); this.fx.sparks(spawned.root.position.clone().add(new T.Vector3(0, 1.5, 0)), 0x9fc6ff, 60, 9, 0.3, 1.2, 2);
      spawned.cooldown = 3; this.lock = spawned; this.sfx.lockOn();
    }
    this.cinema.bossIntro('Morwen', 'The Frost Witch');
  }

  /** Quest complete (or the hero fell): celebrate, then show the run's result. */
  private async endDemo(victory: boolean): Promise<void> {
    const demo = this.demo!; if (demo.stage === 'done') return;
    demo.stage = 'done'; this.ended = true; this.busy = true; this.keys.clear(); this.ui.boss(); this.ui.context();
    const seconds = (performance.now() - demo.started) / 1000;
    if (victory) {
      this.ui.quest('The spring flows again', 'Evermere is warm once more');
      const p = this.heroes[0].root.position.clone().add(new T.Vector3(0, 1, 0));
      this.fx.motes(p, 0xffe7a6, 90, 2, 4, 0.35, 2.4); this.fx.shockwave(this.heroes[0].root.position, 0xffe2a0, 12, 1.4); this.fx.flash(p, 0xffd88a, 30, 1.2);
      this.sfx.success();
    }
    await new Promise((resolve) => window.setTimeout(resolve, victory ? 2600 : 1400));
    if (document.pointerLockElement) document.exitPointerLock();
    await this.cinema.result({
      victory, seconds, foes: demo.foes + (victory ? 1 : 0), hearts: this.state!.hearts, stars: this.state!.stars[0] + this.state!.stars[1], hero: this.state!.party[0].name,
      closing: victory ? '“You did more than win a battle. You gave Evermere its spring back.” — Willow' : '“Rise, hero. The frost has not won — not yet.” — Willow',
    });
  }

  private async loadModels(): Promise<void> {
    const loader = new GLTFLoader(), textures = new T.TextureLoader();
    const ranger = Promise.all([loader.loadAsync('/models/assetyard/ashfen-ranger.glb'), loader.loadAsync('/models/assetyard/hollow-warden.glb')]).then(([asset, combat]) => { if (!this.disposed) this.heroes[0].useModel(clone(asset.scene), asset.animations, false, combat.animations.filter((clip) => ['sword_idle', 'sword_slash_horizontal', 'sword_slash_overhead', 'sword_thrust', 'stagger_back'].includes(clip.name))); });
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
      Promise.all([ranger, companion, loader.loadAsync('/models/assetyard/arming-sword.glb')]).then(([, , asset]) => { if (!this.disposed) this.heroes.forEach((hero, i) => { hero.holdWeapon(asset.scene); hero.holdWand((this.wands[i] ??= new WandModel()).root); }); }),
      loader.loadAsync('/models/assetyard/gloom-stalker.glb').then((asset) => { this.monster = asset; }),
      loader.loadAsync('/models/assetyard/ashfen-dragon.glb').then((asset) => { this.dragon = asset; }),
      Promise.all(['forest_floor/Diffuse', 'mossy_cobblestone/Diffuse', 'mossy_cobblestone/nor_gl', 'forest_floor/nor_gl'].map((name) => textures.loadAsync(`/models/polyhaven/${name}.jpg`))).then(([grass, stone, normal, grassNormal]) => { if (!this.disposed) this.world.useGroundTextures(grass, stone, normal, grassNormal); }),
    ];
    let completed = 0;
    const outcomes = await Promise.allSettled(jobs.map((job) => job.finally(() => { completed++; const progress = document.querySelector<HTMLProgressElement>('#loading-progress'); if (progress) progress.value = completed / jobs.length; })));
    // Optional art packs (Asset Yard models, Poly Haven) are not in the repo: missing ones fall back to the built-in
    // stand-in characters and materials, so a fresh clone still plays.
    const missing = outcomes.filter((outcome) => outcome.status === 'rejected').length;
    if (missing) console.warn(`${missing} optional art file(s) not found; using built-in stand-ins.`);
  }

  private bindInput(): void {
    const options = { signal: this.events.signal };
    window.addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.post.resize(); this.fx.resize(); }, options);
    window.addEventListener('blur', () => { this.keys.clear(); this.drag = undefined; this.previous = 0; }, options);
    document.addEventListener('visibilitychange', () => { this.keys.clear(); this.previous = 0; }, options);
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || !this.state || this.scanner.open) return;
      if (['Space', 'Tab', ...MOVE.flat()].includes(event.code)) event.preventDefault();
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
      if (event.code === 'Slash') this.cast(this.solo ? 0 : 1);
      if (event.code === 'KeyQ') this.roll(0);
      if (event.code === 'KeyR') this.flashStep(0);
      if (event.code === 'KeyX') void this.openScan();
      if (event.code === 'KeyH' && this.phone) void this.phone.phoneUrl().then((url) => this.ui.toast(`Phone joystick: open ${url} on a phone on the same Wi-Fi`));
      if (event.code === 'ShiftRight') this.roll(this.solo ? 0 : 1);
      if (event.code === 'Space') this.leap(0);
      if (event.code === 'KeyZ' || event.code === 'Tab') this.toggleLock();
      if (event.code === 'KeyC' || event.code === 'KeyV') this.rig.manual(this.time);
    }, options);
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), options);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    // Mouse-look like a PC action game: click the world to capture the mouse, move to look, click to strike, Esc to release.
    const looking = () => document.pointerLockElement === canvas;
    document.addEventListener('mousemove', (event) => {
      if (!looking() || !this.state) return;
      this.yaw -= event.movementX * 0.0024; this.pitch = clamp(this.pitch + event.movementY * 0.0018, 0.06, 1.0);
    }, options);
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 2) { this.toggleLock(); return; }
      if (event.pointerType === 'mouse' && this.state && !looking() && !this.ui.blocked) { void canvas.requestPointerLock?.()?.catch?.(() => undefined); if (event.button === 0) { this.drag = undefined; return; } }
      if (looking()) { if (event.button === 0) this.strike(0); return; }
      this.drag = { x: event.clientX, y: event.clientY, moved: 0, pointer: event.pointerId }; canvas.setPointerCapture(event.pointerId);
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag || this.drag.pointer !== event.pointerId) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy); this.yaw -= dx * 0.0042; this.pitch = clamp(this.pitch + dy * 0.0028, 0.08, 1.05);
      if (this.drag.moved > 4) this.rig.manual(this.time);
      this.drag.x = event.clientX; this.drag.y = event.clientY;
    }, options);
    canvas.addEventListener('pointerup', (event) => {
      if (this.drag && this.drag.moved < 5 && event.button === 0) this.strike(0);
      this.drag = undefined;
    }, options);
    canvas.addEventListener('pointercancel', () => { this.drag = undefined; }, options);
    canvas.addEventListener('wheel', (event) => { event.preventDefault(); this.zoom = clamp(this.zoom + event.deltaY * 0.008, 4.5, 19); }, { ...options, passive: false });
    this.ui.onInteract = () => { void this.interact(); }; this.ui.onAttack = () => this.strike(0); this.ui.onSpell = () => this.cast(0); this.ui.onDodge = () => this.roll(0); this.ui.onScan = () => void this.openScan(); this.ui.onFlash = () => this.flashStep(0); this.ui.onMap = () => this.openJournal();
    this.ui.onSound = () => { this.sound = !this.sound; this.sfx.setMuted(!this.sound); this.narrator.enabled = this.sound; if (!this.sound) this.narrator.stop(); this.ui.sound(this.sound); };
    this.ui.onNarrate = (text) => this.narrator.speak(text); this.ui.onSilence = () => this.narrator.stop();
    this.cinema.onNarrate = (text) => this.narrator.speak(text); this.cinema.onSilence = () => this.narrator.stop();
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
    if (this.demo?.stage === 'briefing') { if (distance(p, this.demo.willow) < 3.6) await this.briefing(); return; }
    if (this.target && distance(p, this.target) < 3.2) { await this.runBeat(); return; }
    const object = this.nearest;
    if (!object) return;
    this.keys.clear();
    if (object.kind === 'chest') {
      if (object.used) { this.ui.toast('This treasure is already part of your tale.'); return; }
      object.used = true; this.state.stars[0] += 2; this.state.stars[1] += 2;
      const at = object.root.position.clone().add(new T.Vector3(0, 0.8, 0));
      this.fx.sparks(at, 0xffdf8a, 40, 5, 0.22, 0.9, 3); this.fx.motes(at, 0xfff1b8, 30, 0.6, 2.4, 0.3, 1.6); this.fx.flash(at, 0xffd27a, 18, 0.6);
      this.sfx.chest(); this.ui.toast(`${object.name} discovered · +2 starlight for each hero`);
    } else if (object.kind === 'shrine') {
      if (object.used) this.ui.toast('The spring is resting. Its gift is already yours.');
      else if (this.state.hearts === 3) this.ui.toast('You are already well. Save this spring for a harder day.');
      else {
        object.used = true; this.state.gainHeart();
        const at = object.root.position.clone().add(new T.Vector3(0, 1, 0));
        this.fx.motes(at, 0xabf4cc, 50, 1.2, 2.6, 0.32, 1.8); this.fx.shockwave(object.root.position, 0x9ff0d0, 3.5, 0.8); this.fx.flash(at, 0x9ff0d0, 16, 0.8);
        this.active.forEach((hero) => this.fx.motes(hero.root.position, 0xc9ffe0, 18, 0.5, 2, 0.24, 1.2));
        this.sfx.success(); this.ui.toast('The old magic restores a shared heart.');
      }
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
      const at = this.heroes[0].root.position.clone().add(new T.Vector3(0, 1, 0));
      this.fx.motes(at, 0xf5d48b, 60, 1, 3, 0.3, 1.8); this.fx.shockwave(this.heroes[0].root.position, 0xffe2a0, 4, 0.9); this.fx.flash(at, 0xffd88a, 18, 0.9);
      this.sfx.chest(); this.ui.toast(`${beat.reward.name} · ${beat.reward.description}`);
    }
    if (beat.challenge?.type === 'vote') {
      const choice = await this.ui.choose(beat.challenge.prompt, beat.challenge.options);
      this.busy = false; await this.complete('vote', true, 0, `They chose ${beat.challenge.options.find((o) => o.id === choice)?.label ?? choice}.`, choice); return;
    }
    if (beat.challenge?.type === 'show') {
      const { object, prompt } = beat.challenge; this.keys.clear(); if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
      const ok = await this.scanner.ask(object, prompt); this.busy = false;
      if (ok) this.ui.toast('The door swings open for you.');
      await this.complete('show', ok, this.state!.hearts, ok ? `They showed the door ${object} from their own world.` : `They could not show the door ${object}.`); return;
    }
    this.busy = false;
    if (beat.challenge?.type === 'freeze') {
      this.trial = { type: 'freeze', elapsed: 0, duration: beat.challenge.durationSec, moved: 0, held: 0, poseIndex: 0, poses: [], secondsPerPose: 0, before: this.state!.hearts };
      this.sfx.freeze(); this.fx.shockwave(this.heroes[0].root.position, 0xbfeaff, 9, 1.4, 0.08);
    } else if (beat.challenge?.type === 'pose') {
      this.trial = { type: 'pose', elapsed: 0, duration: beat.challenge.secondsPerPose * beat.challenge.poses.length, moved: 0, held: 0, poseIndex: 0, poses: beat.challenge.poses, secondsPerPose: beat.challenge.secondsPerPose, before: this.state!.hearts };
    } else if (beat.encounter) {
      this.encounterBefore = this.state!.hearts; this.encounterKind = 'encounter';
      for (let i = 0; i < beat.encounter.count; i++) {
        const angle = i / beat.encounter.count * Math.PI * 2;
        this.spawnEnemy(this.heroes[0].root.position.x + Math.sin(angle) * 6, this.heroes[0].root.position.z + Math.cos(angle) * 6, undefined, true);
      }
      this.ui.quest('Drive back the gathering shadows', 'J strike · F cast · Q roll through the red warning');
    } else if (beat.boss) {
      this.encounterBefore = this.state!.hearts; this.encounterKind = 'boss';
      // The guardian rises in the middle of its arena, a few strides beyond the hero.
      const p = this.heroes[0].root.position, arena = objectiveFor(beat), away = new T.Vector3(arena.x - p.x, 0, arena.z - p.z);
      if (away.lengthSq() < 0.5) away.set(0, 0, -1);
      away.normalize(); this.spawnEnemy(arena.x + away.x * 3, arena.z + away.z * 3, beat.boss, true); this.sfx.roar(); this.rig.addTrauma(0.6);
      const boss = this.enemies[this.enemies.length - 1]; if (boss) { this.fx.shockwave(boss.root.position, 0x9fc6ff, 10, 1.2, 0.1); this.fx.sparks(boss.root.position.clone().add(new T.Vector3(0, 1.5, 0)), 0x9fc6ff, 60, 9, 0.3, 1.2, 2); }
      this.ui.quest('Win back the last warm spring', 'Dodge the warning · strike while the ward is down');
    } else await this.complete('story', true, 0, beat.reward ? `They received ${beat.reward.name}.` : 'The heroes followed the old magic.');
  }

  private async complete(kind: OutcomeKind, success: boolean, before: number, summary: string, choiceId?: string): Promise<void> {
    if (this.demo && this.state && !this.ended) {
      this.encounterKind = undefined;
      if (kind === 'encounter') await this.startBoss(); else if (kind === 'boss') { this.bossWon = success; await this.endDemo(success); }
      return;
    }
    if (!this.state || !this.beat || this.ended) return;
    this.ui.challenge(); this.ui.boss(); this.trial = undefined; this.encounterKind = undefined;
    this.cv?.gate(true);   // the wand is free again: any shape
    this.heroes.forEach((hero) => { hero.pose = ''; });
    if (success && kind !== 'story' && kind !== 'vote') { this.state.stars[0]++; this.state.stars[1]++; if (this.sound) this.sfx.success(); }
    if (kind === 'boss') this.bossWon = success;
    const earned = success && kind !== 'story' && kind !== 'vote' ? 1 : 0;
    const outcome: BeatOutcome = { beatId: this.beat.id, kind, success, choiceId, summary, heartsLost: Math.max(0, before - this.state.hearts), perPlayer: [{ success, stars: earned }, { success, stars: earned }] };
    this.state.outcomes.push(outcome);
    if (this.state.defeated) { await this.finish(false); return; }
    await this.loadBeat(this.story.next(this.state.history(), outcome));
  }

  private buildCamps(): void {
    for (const spec of CAMPS) {
      const fire = new T.Group(); fire.position.set(spec.x, heightAt(spec.x, spec.z), spec.z); fire.userData.physics = false; this.scene.add(fire);
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const s = mesh(new T.DodecahedronGeometry(0.22, 0), material(0x6f6a5c), fire, Math.sin(a) * 0.7, 0.1, Math.cos(a) * 0.7); s.scale.y = 0.6; }
      for (let i = 0; i < 3; i++) { const log = mesh(new T.CylinderGeometry(0.08, 0.1, 1.1, 6), material(0x4a3524), fire, 0, 0.15, 0); log.rotation.set(Math.PI / 2, i * 1.05, 0.25); }
      const flames: T.Mesh[] = [];
      for (const [r, h, c] of [[0.42, 1.0, 0xff8a2a], [0.28, 0.8, 0xffc04d], [0.15, 0.55, 0xfff1a8]] as const) {
        const f = new T.Mesh(new T.ConeGeometry(r, h, 8, 1, true), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false })); f.position.y = 0.15 + h / 2; fire.add(f); flames.push(f);
      }
      const camp: Camp = { ...spec, members: [], clearedAt: -1, fire, flames };
      this.camps.push(camp); this.populate(camp);
    }
  }

  private populate(camp: Camp): void {
    camp.members = [];
    for (let i = 0; i < camp.size; i++) {
      const a = i / camp.size * Math.PI * 2 + 0.4, x = camp.x + Math.sin(a) * 2.6, z = camp.z + Math.cos(a) * 2.6;
      this.spawnEnemy(x, z, undefined, false, camp, camp.size >= 3 && i === 0);
    }
    camp.clearedAt = -1;
  }

  /** The whole camp notices together, like a patrol raising the alarm. */
  private alertCamp(enemy: Enemy): void {
    const group = enemy.camp ? enemy.camp.members : [enemy];
    let any = false;
    group.forEach((member, i) => {
      if (member.hp <= 0 || member.ai !== 'idle') return;
      member.ai = 'alert'; member.aiT = 0.55 + i * 0.12; any = true;
      this.fx.number(member.root.position.clone().add(new T.Vector3(0, 2.4, 0)), '!', '#ffac3c', true);
    });
    if (any) { this.sfx.alert(); this.fx.warn(enemy.root.position.clone().add(new T.Vector3(0, 2.2, 0))); }
  }

  private drawBar(enemy: Enemy): void {
    if (enemy.boss) return;
    if (!enemy.bar) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 18;
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
      enemy.bar = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); enemy.bar.renderOrder = 42;
      enemy.bar.scale.set(1.3, 0.18, 1); enemy.bar.position.y = enemy.elite ? 2.55 : 2.05; enemy.root.add(enemy.bar);
    }
    const tex = (enemy.bar.material as T.SpriteMaterial).map as T.CanvasTexture, g = (tex.image as HTMLCanvasElement).getContext('2d')!;
    g.clearRect(0, 0, 128, 18); g.fillStyle = 'rgba(14,10,20,0.75)'; g.fillRect(0, 0, 128, 18);
    const f = Math.max(0, enemy.hp / enemy.maxHp); g.fillStyle = enemy.elite ? '#c98cff' : '#ff7d5c'; g.fillRect(3, 3, 122 * f, 12);
    g.strokeStyle = 'rgba(255,230,180,0.8)'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 16); tex.needsUpdate = true;
  }

  private drop(at: T.Vector3): void {
    const heart = this.state!.hearts < 3 && Math.random() < 0.5;
    const root = new T.Group(); root.position.copy(at); root.position.y = heightAt(at.x, at.z) + 0.6; this.scene.add(root);
    if (heart) {
      const red = new T.MeshStandardMaterial({ color: 0xff5f6d, emissive: 0xff2a44, emissiveIntensity: 0.9, roughness: 0.4 });
      for (const side of [-1, 1]) mesh(new T.SphereGeometry(0.13, 12, 10), red, root, side * 0.1, 0.06, 0);
      const tip = mesh(new T.ConeGeometry(0.19, 0.28, 12), red, root, 0, -0.1, 0); tip.rotation.z = Math.PI;
    } else mesh(new T.OctahedronGeometry(0.2), material(0xffe2a3, 0xf9c86c), root);
    this.pickups.push({ root, kind: heart ? 'heart' : 'star', age: 0 });
  }

  private updatePickups(dt: number): void {
    const hero = this.heroes[0].root.position;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const item = this.pickups[i]; item.age += dt;
      const p = item.root.position, d = distance(p, hero);
      item.root.rotation.y += dt * 2.4; p.y = heightAt(p.x, p.z) + 0.6 + Math.sin(item.age * 3) * 0.12;
      if (item.age > 0.5 && d < 3.5) { const pull = new T.Vector3(hero.x - p.x, 0, hero.z - p.z).normalize().multiplyScalar(Math.min(d, dt * 9)); p.add(pull); }
      if (Math.random() < 0.3) this.fx.trail(p.clone().add(new T.Vector3(0, 0.1, 0)), item.kind === 'heart' ? 0xff8a96 : 0xffe7a6, 0.22);
      if (item.age > 0.5 && d < 0.9) {
        if (item.kind === 'heart') { this.state!.gainHeart(); this.fx.number(p.clone().add(new T.Vector3(0, 0.6, 0)), '+♥', '#ff9aa8', true); this.fx.motes(hero, 0xff9aa8, 20, 0.5, 2, 0.26, 1.1); this.sfx.success(); }
        else { this.state!.stars[0]++; this.fx.number(p.clone().add(new T.Vector3(0, 0.6, 0)), '+1 ✦', '#ffe7a6'); this.fx.motes(p, 0xffe7a6, 12, 0.3, 2, 0.24, 0.9); this.sfx.pickup(); }
        this.scene.remove(item.root); item.root.traverse((o) => { if (o instanceof T.Mesh) { o.geometry.dispose(); (o.material as T.Material).dispose(); } });
        this.pickups.splice(i, 1);
      } else if (item.age > 45) { this.scene.remove(item.root); this.pickups.splice(i, 1); }
    }
  }

  private updateCamps(dt: number): void {
    const hero = this.heroes[0].root.position;
    for (const camp of this.camps) {
      const d = distance(camp, hero), lit = camp.members.some((m) => m.hp > 0);
      camp.fire.visible = d < 90;
      camp.flames.forEach((f, i) => { f.visible = lit || i === 2; f.scale.set(1, (lit ? 1 : 0.35) * (0.85 + Math.sin(this.time * (11 + i * 3)) * 0.15 + Math.sin(this.time * 23 + i) * 0.05), 1); });
      if (lit && d < 40 && Math.random() < dt * 14) this.fx.motes(camp.fire.position.clone().add(new T.Vector3(0, 0.5, 0)), Math.random() < 0.5 ? 0xffa040 : 0xffd27a, 1, 0.25, 2.2, 0.16, 1.1);
      if (!lit && camp.clearedAt < 0) { camp.clearedAt = this.time; if (d < 30) { this.ui.toast(`${camp.name} cleared`); this.sfx.success(); } }
      // Camps refill once the hero has wandered far away for a while.
      if (camp.clearedAt >= 0 && this.time - camp.clearedAt > 55 && d > 42 && !this.encounterKind) {
        for (const old of camp.members) { const k = this.enemies.indexOf(old); if (k >= 0) this.enemies.splice(k, 1); this.scene.remove(old.root); }
        this.populate(camp);
      }
    }
  }

  private spawnEnemy(x: number, z: number, boss?: BossSpec, encounter = false, camp?: Camp, elite = false): void {
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
      } else if (!boss && asset.animations.length) {
        // Rigged foes walk, punch, flinch and fall instead of gliding as a statue.
        actor = new Actor(); actor.useModel(clone(asset.scene), asset.animations, false); actor.root.scale.setScalar(1.6 / 1.9); root.add(actor.root);
      } else {
        visual = clone(asset.scene); const bounds = new T.Box3().setFromObject(visual), size = bounds.getSize(new T.Vector3()), center = bounds.getCenter(new T.Vector3());
        const scale = (boss ? 3.3 : 1.6) / size.y; visual.scale.setScalar(scale); visual.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale); root.add(visual);
        visual.traverse((part) => { if (part instanceof T.Mesh) part.castShadow = true; });
      }
    }
    // Private materials so a hit can flash this enemy white without flashing every clone.
    const flashMats: T.MeshStandardMaterial[] = [];
    root.traverse((part) => {
      if (!(part instanceof T.Mesh) || part === ring) return;
      const mats = (Array.isArray(part.material) ? part.material : [part.material]).map((m) => {
        if (!(m instanceof T.MeshStandardMaterial)) return m;
        const copy = m.clone(); copy.userData.baseEmissive = copy.emissive.clone(); copy.userData.baseIntensity = copy.emissiveIntensity; flashMats.push(copy); return copy;
      });
      part.material = Array.isArray(part.material) ? mats : mats[0];
    });
    const enemy: Enemy = { root, core, ring, hp, maxHp: hp, home: { x, z }, windup: 0, cooldown: 1.2, boss, encounter, attack: '', pawn, visual, actor, knock: new T.Vector3(), flash: 0, dying: 0, flashMats, ai: encounter || boss ? 'chase' : 'idle', aiT: Math.random() * 3, camp, shown: 0, elite };
    if (elite) { enemy.hp = enemy.maxHp = 6; root.scale.setScalar(1.3); flashMats.forEach((m) => { m.color.multiply(new T.Color(0xd8b8ff)); m.userData.baseEmissive = new T.Color(0x2a1240); m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseIntensity = 0.6; }); }
    this.enemies.push(enemy); camp?.members.push(enemy);
    if (encounter && this.fx) { this.fx.puff(root.position, 0x3a2f4a, 14, 2.2, 0.9, 1.1); this.fx.sparks(root.position.clone().add(new T.Vector3(0, 1, 0)), 0x9b7bd6, 18, 4, 0.2, 0.7, 1); }
  }

  private strike(player: PlayerIndex): void {
    if (!this.canAct() || this.attackCooldown[player] > 0 || this.trial) return;
    const hero = this.heroes[player];
    // Chain into the next combo step while the window is open; the finisher resets it.
    const step = player === 0 && this.time < this.combo.until ? this.combo.step : 0, move = COMBO[step];
    const rapid = player === 0 && this.flurry > 0;
    hero.attack = rapid ? 0.18 : move.length; hero.attackClip = rapid ? COMBO[this.time * 7 % 3 | 0].clip : move.clip; hero.attackLength = hero.attack; hero.attackContact = rapid ? 0.04 : move.hit; hero.attackSerial++;
    this.attackCooldown[player] = rapid ? 0.11 : move.length * 0.72;
    if (player === 0) this.combo = { step: (step + 1) % COMBO.length, until: this.time + move.length + 0.42 };
    const flurryFoe = rapid && this.flurryTarget && this.flurryTarget.hp > 0 ? this.flurryTarget : undefined;
    const target = flurryFoe ?? (player === 0 ? this.lock : undefined) ?? this.closestEnemy(hero.root.position, move.reach + 0.6);
    if (target) hero.heading = Math.atan2(target.root.position.x - hero.root.position.x, target.root.position.z - hero.root.position.z);
    // Flurry rush dashes the hero onto the foe they slipped past.
    if (flurryFoe && distance(flurryFoe.root.position, hero.root.position) > 1.9) this.movementVelocity[0].set(Math.sin(hero.heading), 0, Math.cos(hero.heading)).multiplyScalar(16);
    // A short step into the swing sells weight.
    if (player === 0 && !rapid) this.movementVelocity[0].add(new T.Vector3(Math.sin(hero.heading), 0, Math.cos(hero.heading)).multiplyScalar(step === 2 ? 5 : 2.5));
    this.pending.push({ at: this.time + (rapid ? 0.04 : move.hit), player, damage: rapid ? 1 : move.damage, reach: move.reach, arc: move.arc, heavy: step === 2, step });
    const origin = hero.root.position.clone(); origin.y += step === 1 ? 1.35 : 1.05;
    const relic = this.weapons[player];
    this.fx.slash(origin, hero.heading, rapid ? 0xbfe8ff : relic ? ELEMENT_COLOR[relic.element] : move.color, rapid ? Math.random() * 2 : move.tilt, step === 2 ? 2.1 : 1.75, rapid ? 0.12 : move.length * 0.55, step === 1);
    this.sfx.swing(step);
  }

  /** Resolve a swing at its contact frame: everything in reach and in front takes the hit. */
  private resolveHits(): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const hit = this.pending[i]; if (this.time < hit.at) continue;
      this.pending.splice(i, 1);
      const hero = this.heroes[hit.player], p = hero.root.position, forward = new T.Vector3(Math.sin(hero.heading), 0, Math.cos(hero.heading));
      let landed = false;
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const to = enemy.root.position.clone().sub(p); to.y = 0; const d = to.length(), reach = hit.reach + (enemy.boss ? 1.2 : 0);
        if (d > reach) continue;
        if (d > 0.6 && Math.acos(clamp(to.normalize().dot(forward), -1, 1)) > hit.arc / 2 + 0.25) continue;
        this.hit(enemy, hit.damage, hit.player, hit.heavy, this.weapons[hit.player]?.element); landed = true;
      }
      if (!landed && hit.player === 0) { const tip = p.clone().addScaledVector(forward, 1.6); tip.y += 0.2; this.fx.puff(tip, 0xb9a986, 3, 0.6, 0.25, 0.4); }
    }
  }

  private toggleLock(): void {
    if (this.lock) { this.lock = undefined; this.sfx.lockOff(); return; }
    const p = this.heroes[0].root.position, view = new T.Vector3(-Math.sin(this.rig.viewYaw), 0, -Math.cos(this.rig.viewYaw));
    // Prefer what the player is looking at, then what is closest.
    const pick = this.enemies.filter((e) => e.hp > 0 && distance(e.root.position, p) < 22)
      .map((e) => { const to = e.root.position.clone().sub(p).setY(0); const d = to.length(); return { e, score: d - to.normalize().dot(view) * 6 }; })
      .sort((a, b) => a.score - b.score)[0]?.e;
    if (pick) { this.lock = pick; this.sfx.lockOn(); } else this.ui.toast('No foe nearby to focus on');
  }

  /** F's plain bolt, infused by the hero's relic if they hold one. */
  private spellOf(player: PlayerIndex): SpellSpec { return wandSpell('bolt', this.weapons[player], player ? 0xf4d391 : 0xb2f6d5); }

  /** Cast F's bolt, or a `drawn` wand spell (which runs on its shape's own cooldown instead). True if it went off. */
  private cast(player: PlayerIndex, drawn?: SpellSpec): boolean {
    if (!this.canAct() || (!drawn && this.spellCooldown[player] > 0) || this.trial) return false;
    const spell = drawn ?? this.spellOf(player);
    if (!drawn) this.spellCooldown[player] = spell.cooldown * (this.state!.has('quick-cast') ? 0.4375 : 1);
    const hero = this.heroes[player], p = hero.root.position;
    const locked = player === 0 && this.lock && this.lock.hp > 0 ? this.lock : undefined;
    const target = locked ?? this.closestEnemy(p, 19), direction = new T.Vector3(Math.sin(hero.heading), 0, Math.cos(hero.heading));
    const start = p.clone().add(new T.Vector3(0, 1.25, 0));
    if (target) { direction.copy(target.root.position).add(new T.Vector3(0, target.boss ? 1.8 : 0.9, 0)).sub(start).normalize(); hero.heading = Math.atan2(direction.x, direction.z); }
    const color = spell.color;
    if (spell.ability === 'nova') this.novaBurst(player, spell);
    else if (spell.ability === 'meteor') {
      const aim = target ? target.root.position : p.clone().addScaledVector(new T.Vector3(Math.sin(hero.heading), 0, Math.cos(hero.heading)), 8);
      const pos = new T.Vector3(aim.x, heightAt(aim.x, aim.z), aim.z);
      this.strikes.push({ at: this.time + spell.delay, delay: spell.delay, pos, radius: spell.radius, damage: spell.damage, color, element: spell.element, player });
      this.fx.shockwave(pos, color, spell.radius, spell.delay, 0.12);
    } else {
      for (let k = 0; k < spell.count; k++) {
        const dir = direction.clone().applyAxisAngle(new T.Vector3(0, 1, 0), (k - (spell.count - 1) / 2) * spell.spread);
        this.launchBolt(start, dir, player, spell);
      }
    }
    hero.attack = 0.35; hero.attackClip = 'strike'; hero.attackLength = 0.35; hero.attackContact = 0.12; hero.attackSerial++;
    this.fx.motes(start, color, 14, 0.35, 1.2, 0.26, 0.5); this.fx.flash(start, color, 9, 0.2); this.wands[player]?.flash();
    if (player === 0) this.sfx.cast();
    return true;
  }

  private launchBolt(start: T.Vector3, direction: T.Vector3, player: PlayerIndex, spell: SpellSpec): void {
    const bolt = mesh(new T.IcosahedronGeometry(0.17, 1), new T.MeshBasicMaterial({ color: 0xffffff }), this.scene); bolt.castShadow = false;
    const halo = new T.Mesh(new T.SphereGeometry(0.42, 12, 10), new T.MeshBasicMaterial({ color: spell.color, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false })); bolt.add(halo);
    bolt.position.copy(start);
    this.bolts.push({ mesh: bolt, velocity: direction.clone().normalize().multiplyScalar(spell.speed), life: spell.life, player, color: spell.color, element: spell.element, damage: spell.damage, pierce: spell.pierce, chain: spell.chain, chainRadius: spell.radius, hit: new Set() });
  }

  /** Nova: everything around the hero is struck at once. */
  private novaBurst(player: PlayerIndex, spell: SpellSpec): void {
    const p = this.heroes[player].root.position, at = p.clone().add(new T.Vector3(0, 0.9, 0));
    this.fx.shockwave(p, spell.color, spell.radius * 1.15, 0.55, 0.3); this.fx.shockwave(p, 0xffffff, spell.radius * 0.7, 0.3, 0.12);
    this.fx.motes(at, spell.color, 46, spell.radius * 0.55, 1.4, 0.3, 0.8); this.fx.flash(at, spell.color, 20, 0.35); this.rig.addTrauma(0.3); this.sfx.burst();
    for (const enemy of this.enemies) if (enemy.hp > 0 && distance(enemy.root.position, p) < spell.radius + (enemy.boss ? 1.5 : 0)) this.hit(enemy, spell.damage, player, false, spell.element);
  }

  /** Lightning leaps from `from` to up to `jumps` more nearby foes. */
  private chainFrom(from: Enemy, bolt: Bolt): void {
    const visited = new Set<Enemy>([from, ...bolt.hit]); let current = from;
    for (let j = 0; j < bolt.chain; j++) {
      let best: Enemy | undefined, bestD = bolt.chainRadius;
      for (const enemy of this.enemies) { if (enemy.hp <= 0 || visited.has(enemy)) continue; const d = distance(enemy.root.position, current.root.position); if (d < bestD) { best = enemy; bestD = d; } }
      if (!best) break;
      const a = current.root.position.clone().add(new T.Vector3(0, 0.9, 0)), b = best.root.position.clone().add(new T.Vector3(0, 0.9, 0));
      for (let k = 0; k <= 8; k++) this.fx.trail(a.clone().lerp(b, k / 8).add(new T.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4)), bolt.color, 0.34);
      this.fx.flash(b, bolt.color, 12, 0.18); this.hit(best, bolt.damage, bolt.player, false, bolt.element); visited.add(best); current = best;
    }
  }

  /** HUD hint: which element the boss fears, so a scan can be chosen on purpose. */
  private fearsLine(kind: string): string { const entry = BOSS_ELEMENTS[kind]; return entry ? ` · weak to ${entry.weak}` : ''; }

  private updateStrikes(): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const strike = this.strikes[i], remaining = strike.at - this.time;
      if (remaining > 0) {
        // A glowing meteor falls out of the sky onto the marked ground.
        const fall = remaining / strike.delay;
        this.fx.trail(strike.pos.clone().add(new T.Vector3(0, 1.5 + fall * 11, 0)), strike.color, 0.8); this.fx.trail(strike.pos.clone().add(new T.Vector3(0, 0.2, 0)), strike.color, 0.35);
        continue;
      }
      this.strikes.splice(i, 1);
      this.fx.shockwave(strike.pos, strike.color, strike.radius * 1.4, 0.55, 0.3); this.fx.sparks(strike.pos.clone().add(new T.Vector3(0, 0.5, 0)), strike.color, 40, 9, 0.26, 0.6, 7);
      this.fx.puff(strike.pos, 0xb6ad8f, 10, strike.radius * 0.6, 0.6, 0.7); this.fx.flash(strike.pos.clone().add(new T.Vector3(0, 1, 0)), strike.color, 24, 0.35); this.rig.addTrauma(0.4); this.sfx.land(true);
      for (const enemy of this.enemies) if (enemy.hp > 0 && distance(enemy.root.position, strike.pos) < strike.radius + (enemy.boss ? 1.5 : 0)) this.hit(enemy, strike.damage, strike.player, false, strike.element);
    }
  }

  // ---- Reality Rift: scan an object, get a weapon ----
  private async openScan(): Promise<void> {
    if (!this.state || this.busy || this.ended || this.ui.blocked || this.scanner.open) return;
    this.keys.clear(); if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    await this.scanner.show();
  }

  private equip(weapon: Weapon, player: PlayerIndex = 0): void {
    const color = ELEMENT_COLOR[weapon.element];
    this.weapons[player] = weapon; this.heroes[player].glowWeapon(color); this.wands[player]?.setColor(color); this.hud.setRelic(player, weapon);
    this.state?.forge({ hero: player, object: weapon.object, name: weapon.artifactName, element: weapon.element, ability: weapon.ability });
    const hero = this.heroes[player].root.position, at = hero.clone().add(new T.Vector3(0, 1, 0));
    this.fx.shockwave(hero, color, 6, 1.0, 0.3); this.fx.shockwave(hero, 0xffffff, 3, 0.6, 0.15); this.fx.motes(at, color, 90, 1.2, 3.2, 0.3, 1.8); this.fx.sparks(at, color, 40, 7, 0.22, 0.8, 2);
    this.fx.flash(at, color, 26, 0.9); this.rig.addTrauma(0.3); this.sfx.chest();
    this.ui.toast(`Relic: ${weapon.artifactName} infuses your wand and sword with ${weapon.element}. ${weapon.description}`);
  }

  /**
   * A wand completed a shape (CV tracker or keys 4-7 / 8-0,-): cast that shape's spell now, infused by the hero's relic if
   * any. During a trial the shape belongs to the pose seal, so it never also casts.
   */
  private onShape(colour: WandColour, shape: WandShape): void {
    const player = heroFor(colour, this.solo); if (player === undefined || !this.state || this.ended || this.scanner.open || this.trial) return;
    if (!this.wandCooldowns.ready(player, shape, this.time) || !this.cast(player, wandSpell(SHAPE_ABILITY[shape], this.weapons[player]))) return;
    this.wandCooldowns.use(player, shape, this.time); this.hud.cast(player, shape, SHAPE_COOLDOWN[shape]);
  }

  /** Toward the held direction, else away from a locked foe, else forward. */
  private evadeDirection(player: PlayerIndex): T.Vector3 {
    const hero = this.heroes[player], p = hero.root.position, held = this.movementVelocity[player].clone().setY(0);
    if (held.lengthSq() > 1) return held.normalize();
    if (player === 0 && this.lock) return p.clone().sub(this.lock.root.position).setY(0).normalize();
    return new T.Vector3(Math.sin(hero.heading), 0, Math.cos(hero.heading));
  }

  private roll(player: PlayerIndex): void {
    if (!this.canAct() || this.rollTime[player] > 0 || this.dodge[player] > 0 || this.rollCooldown[player] > 0 || this.trial) return;
    this.rollTime[player] = ROLL.length; this.rollIframes[player] = ROLL.iframes; this.rollCooldown[player] = ROLL.cooldown;
    this.invulnerable = Math.max(this.invulnerable, ROLL.iframes);
    this.dodgeDirection[player].copy(this.evadeDirection(player));
    const p = this.heroes[player].root.position;
    this.fx.puff(p, pathDistance(p.x, p.z) < 2.3 ? 0xcdbf9b : 0x8a8a5a, 7, 1.6, 0.5, 0.55); this.sfx.dodge();
  }

  private flashStep(player: PlayerIndex): void {
    if (!this.canAct() || this.stamina < 0.18 || this.dodge[player] > 0 || this.rollTime[player] > 0 || this.flashCooldown[player] > 0 || this.trial) return;
    this.dodge[player] = 0.27; this.stamina -= 0.18; this.flashCooldown[player] = FLASH_COOLDOWN;
    const hero = this.heroes[player], p = hero.root.position;
    this.dodgeDirection[player].copy(this.evadeDirection(player));
    this.fx.puff(p, 0xbfe8ff, 9, 2.2, 0.55, 0.6); this.fx.motes(p.clone().add(new T.Vector3(0, 1, 0)), 0xd8f2ff, 18, 0.6, 1.2, 0.25, 0.5); this.sfx.dodge();
    // Perfect dodge: slipping a strike at the last moment slows time for a flurry rush.
    if (player === 0 && this.flurry <= 0) {
      const threat = this.enemies.find((e) => e.hp > 0 && e.windup > 0 && e.windup < 0.42 && distance(e.root.position, p) < (e.boss ? 8.5 : 3.4));
      if (threat) {
        this.flurry = 1.9; this.flurryTarget = threat; this.lock = this.lock ?? threat; this.sfx.perfect(); this.rig.addTrauma(0.2);
        this.fx.shockwave(p, 0xbfe8ff, 5, 0.6, 0.12); this.fx.motes(p.clone().add(new T.Vector3(0, 1, 0)), 0xd8f2ff, 30, 0.8, 1.5, 0.3, 0.9);
        this.ui.toast('Perfect dodge! Flurry rush: strike now');
      }
    }
  }
  private leap(player: PlayerIndex): void {
    if (this.canAct() && (this.physics?.isGrounded(player) ?? this.jump[player] === 0) && !this.trial) {
      this.velocityY[player] = 7; this.sfx.jump(); this.fx.puff(this.heroes[player].root.position, 0xb8ad86, 6, 1.4, 0.4, 0.5);
    }
  }
  private canAct(): boolean { return !!this.state && !this.busy && !this.ui.blocked && !this.ended; }
  private closestEnemy(p: T.Vector3, radius: number): Enemy | undefined { return this.enemies.filter((e) => e.hp > 0 && distance(e.root.position, p) < radius && this.physics?.wallDistance(p.clone().add(new T.Vector3(0, 1.2, 0)), e.root.position.clone().add(new T.Vector3(0, e.boss ? 1.8 : 0.9, 0))) === undefined).sort((a, b) => distance(a.root.position, p) - distance(b.root.position, p))[0]; }

  private hit(enemy: Enemy, damage: number, player: PlayerIndex, heavy = false, element?: Element): void {
    if (enemy.hp <= 0 || this.ended) return;
    const at = enemy.root.position.clone().add(new T.Vector3(0, enemy.boss ? 2 : 1, 0));
    if (enemy.boss && (enemy.windup > 0 || enemy.cooldown <= 0)) {
      // Warded: sparks bounce off and the blade rings, so the player reads "not now".
      this.fx.sparks(at, 0xbfe0ff, 10, 5, 0.16, 0.35, 8); this.fx.number(at.clone().add(new T.Vector3(0, 0.6, 0)), 'Warded', '#bfe0ff'); this.sfx.lockOff(); return;
    }
    // Reality Rift: a boss takes double from the element it fears and half from the one it resists.
    const multiplier = enemy.boss ? elementMultiplier(enemy.boss.kind, element) : 1;
    if (multiplier !== 1) damage = scaledDamage(damage, multiplier);
    enemy.hp -= damage;
    enemy.shown = 4; this.drawBar(enemy);
    if (!enemy.encounter && !enemy.boss) { if (enemy.ai === 'idle') this.alertCamp(enemy); enemy.ai = 'chase'; }
    // A heavy finisher staggers a regular foe out of its windup.
    if (heavy && !enemy.boss && enemy.windup > 0) { enemy.windup = 0; enemy.ring.visible = false; enemy.cooldown = Math.max(enemy.cooldown, 1); this.fx.number(enemy.root.position.clone().add(new T.Vector3(0, 2.6, 0)), 'Staggered', '#ffd28a'); }
    const from = this.heroes[player].root.position, push = enemy.root.position.clone().sub(from).setY(0);
    if (push.lengthSq() < 0.0001) push.set(0, 0, 1);
    push.normalize().multiplyScalar((heavy ? 9 : 5.5) * (enemy.boss ? 0.15 : 1)); enemy.knock.add(push); enemy.flash = 0.14;
    const crit = heavy || this.flurry > 0;
    this.fx.sparks(at, crit ? 0xfff0b0 : 0xffc98a, crit ? 26 : 16, crit ? 8 : 6, 0.2, 0.45, 9);
    this.fx.sparks(at, 0xffffff, 6, 10, 0.12, 0.2, 0);
    this.fx.flash(at, 0xffd59a, crit ? 16 : 10, 0.14);
    this.fx.number(at.clone().add(new T.Vector3(0, 0.7, 0)), String(damage), crit ? '#ffe27a' : '#fff4df', crit);
    if (multiplier > 1) {
      const color = this.weapons[player]?.spell.color ?? 0xffd36b;
      this.fx.number(at.clone().add(new T.Vector3(0, 1.5, 0)), 'Weak point!', '#ffd36b', true); this.fx.shockwave(enemy.root.position, color, 5, 0.6, 0.25);
      this.fx.sparks(at, color, 34, 9, 0.24, 0.7, 3); this.fx.flash(at, color, 22, 0.3); this.hitstop = Math.max(this.hitstop, 0.11); this.rig.addTrauma(0.35);
    } else if (multiplier < 1) this.fx.number(at.clone().add(new T.Vector3(0, 1.5, 0)), 'Resisted', '#9fb0b8');
    this.hitstop = Math.max(this.hitstop, heavy ? 0.085 : 0.05); this.rig.addTrauma(heavy ? 0.32 : 0.18);
    this.sfx.hit(heavy, crit); this.sfx.enemyHurt();
    if (enemy.actor) { enemy.actor.stagger = 0.4; if (enemy.windup <= 0) enemy.actor.attack = 0; }
    if (enemy.hp <= 0) {
      // Animated foes fall first, then dissolve; the rest dissolve at once.
      enemy.dying = enemy.actor && !enemy.boss ? 1.3 : 0.45; if (enemy.actor) enemy.actor.dead = true;
      this.state!.stars[player] += enemy.boss ? 5 : 2;
      this.fx.sparks(at, 0xb69bff, enemy.boss ? 90 : 36, enemy.boss ? 10 : 6, 0.26, 0.9, 2);
      this.fx.puff(enemy.root.position, 0x2e2640, enemy.boss ? 30 : 14, enemy.boss ? 4 : 2, enemy.boss ? 1.6 : 0.9, 1.2);
      this.fx.motes(at, 0xffe7a6, enemy.boss ? 40 : 12, 0.6, 2.5, 0.3, 1.4); this.fx.shockwave(enemy.root.position, 0xd8c6ff, enemy.boss ? 9 : 3.5, 0.6);
      this.fx.flash(at, 0xcab6ff, enemy.boss ? 30 : 14, 0.4); this.sfx.enemyDie(!!enemy.boss); this.rig.addTrauma(enemy.boss ? 0.7 : 0.3);
      this.hitstop = Math.max(this.hitstop, enemy.boss ? 0.25 : 0.1);
      if (this.lock === enemy) this.lock = undefined;
      if (enemy.bar) enemy.bar.visible = false;
      if (!enemy.encounter && !enemy.boss) { this.drop(enemy.root.position); if (enemy.elite) this.drop(enemy.root.position.clone().add(new T.Vector3(0.6, 0, 0.4))); }
      if (enemy.pawn !== undefined) { this.physics?.removeCharacter(enemy.pawn); enemy.pawn = undefined; }
      this.ui.toast(enemy.boss ? 'The frost breaks. Spring remembers your name.' : 'Shadow dispelled · +2 starlight');
      if (this.demo?.stage === 'wave' && !enemy.boss) {
        this.demo.foes++;
        this.ui.quest('Defeat the shadow horde', `Shadows defeated ${this.demo.foes} / ${WAVE.length}${this.demo.foes < WAVE.length ? '' : ' · the horde is broken!'}`);
      }
      if (enemy.encounter && this.encounterKind && !this.enemies.some((e) => e.encounter && e.hp > 0)) {
        const kind = this.encounterKind; this.encounterKind = undefined;
        void this.complete(kind, true, this.encounterBefore, kind === 'boss' ? 'The heroes defeated the guardian and restored the spring.' : 'The heroes drove back the gathering shadows.');
      }
    }
  }

  private hurt(deferEnding = false): void {
    if (!this.state || this.invulnerable > 0 || this.ended || !this.state.loseHeart()) return;
    this.invulnerable = 2.5; this.heroes.forEach((hero) => { hero.hurt = 1.2; hero.stagger = 0.45; }); this.ui.damage(); this.sfx.hurt();
    this.post.hurt = 1; this.rig.addTrauma(0.55); this.hitstop = Math.max(this.hitstop, 0.09);
    const p = this.heroes[0].root.position.clone().add(new T.Vector3(0, 1.1, 0)); this.fx.sparks(p, 0xff8b78, 20, 6, 0.2, 0.5, 8); this.fx.flash(p, 0xff7a64, 12, 0.25);
    if (this.state.defeated && !deferEnding) { void this.finish(false); }
  }

  private async finish(victory: boolean): Promise<void> {
    if (this.ended || !this.state) return;
    if (this.demo) { await this.endDemo(victory); return; }
    this.ended = true; this.busy = true; this.keys.clear(); this.ui.challenge(); this.ui.boss(); this.ui.context();
    if (this.encounterKind && this.beat) {
      this.state.outcomes.push({ beatId: this.beat.id, kind: this.encounterKind, success: false, heartsLost: Math.max(0, this.encounterBefore - this.state.hearts), summary: 'The shadows overcame the heroes, but their story can begin again.', perPlayer: [{ success: false, stars: 0 }, { success: false, stars: 0 }] });
    }
    this.world.marker.visible = false; this.ui.quest(victory ? 'A kingdom warmed by kindness' : 'A tale unfinished', 'The storyteller is binding your adventure.');
    const book = await this.story.storybook(this.state.history(), victory); await this.ui.ending(book);
  }

  private burst(at: T.Vector3, color: number, count: number): void {
    this.fx.sparks(at, color, count, 4.5, 0.2, 0.7, 4); this.fx.motes(at, color, Math.ceil(count / 2), 0.4, 1.4, 0.22, 0.9);
  }

  private frame(timestamp: number): void {
    const real = this.previous ? Math.min(0.045, (timestamp - this.previous) / 1000) : 0;
    this.previous = timestamp;
    if (document.hidden) return;
    const paused = this.ui.blocked || this.busy || this.ended || this.scanner.open;
    // Dialogue, choices and the journal need the cursor back.
    if ((this.ui.blocked || this.ended || this.scanner.open) && document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    // Hit-stop freezes the world for a few frames on contact; the camera and effects keep breathing.
    let dt = real;
    if (this.hitstop > 0) { this.hitstop -= real; dt = real * 0.04; }
    if (this.flurry > 0 && !paused) { this.flurry -= real; if (this.flurry <= 0) { this.flurryTarget = undefined; this.rig.addTrauma(0.25); } }
    this.post.flurry += ((this.flurry > 0 ? 1 : 0) - this.post.flurry) * Math.min(1, real * 6);
    if (!paused) this.time += dt;
    this.world.update(paused ? 0 : dt, this.time, this.heroes[0].root.position);
    this.heroes.forEach((hero) => hero.update(paused ? 0 : dt, this.time));
    if (this.state) {
      if (!paused) this.update(dt);
      this.updateCamera(real);
      this.ui.update(this.state, this.stamina);
      this.updateWheel(); this.ui.cooldowns(this.rollCooldown[0] / ROLL.cooldown, this.flashCooldown[0] / FLASH_COOLDOWN);
      this.mapTimer += real;
      if (this.mapTimer > 0.12) { this.mapTimer = 0; this.ui.drawMap(this.heroes[0].root.position, this.active[this.active.length - 1].root.position, this.target, this.world.objects, this.yaw); }
      this.fx.ambience(paused ? 0 : real, this.heroes[0].root.position, this.region === 'forest');
      const near = this.enemies.some((e) => e.hp > 0 && distance(e.root.position, this.heroes[0].root.position) < 15);
      this.sfx.setCombat(!!this.encounterKind || near);
    } else {
      this.time += dt;
      this.camera.position.x = 12 + Math.sin(this.time * 0.06) * (this.reducedMotion ? 0 : 2); this.camera.lookAt(0, 2.4, 17);
    }
    this.fx.lockOn(this.lock && this.lock.hp > 0 ? this.lock.root.position.clone().add(new T.Vector3(0, this.lock.boss ? 4.2 : 2.3, 0)) : undefined, this.time);
    this.fx.update(paused ? real * 0.25 : dt, this.time); this.wands.forEach((wand) => wand?.update(real));
    this.sfx.update(real);
    occlusion.uCamPos.value.copy(this.camera.position); occlusion.uFocus.value.copy(this.heroes[0].root.position).add(new T.Vector3(0, 1.1, 0));
    this.post.render(real, this.time);
  }

  /** BotW-style stamina wheel beside the hero, visible only while stamina is in use. */
  private updateWheel(): void {
    const show = this.stamina < 0.995 && !this.ended;
    this.wheel.classList.toggle('visible', show);
    if (!show) return;
    const p = this.heroes[0].root.position.clone().add(new T.Vector3(0, 1.4, 0));
    const right = new T.Vector3(Math.cos(this.rig.viewYaw), 0, -Math.sin(this.rig.viewYaw)); p.addScaledVector(right, 0.9);
    p.project(this.camera);
    this.wheel.style.transform = `translate(${(p.x * 0.5 + 0.5) * innerWidth - 20}px, ${(-p.y * 0.5 + 0.5) * innerHeight - 20}px)`;
    const fill = this.wheel.querySelector<SVGCircleElement>('.fill')!; fill.style.strokeDashoffset = String(100.5 * (1 - this.stamina));
    this.wheel.classList.toggle('low', this.stamina < 0.25);
  }

  private update(dt: number): void {
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.stamina = Math.min(1, this.stamina + dt * 0.16);
    if (this.keys.has('KeyC')) this.yaw += dt * 1.4;
    if (this.keys.has('KeyV')) this.yaw -= dt * 1.4;
    for (let i = 0; i < this.active.length; i++) {
      const hero = this.heroes[i], p = hero.root.position, keys = MOVE[i];
      const beforeX = p.x, beforeZ = p.z;
      this.attackCooldown[i] = Math.max(0, this.attackCooldown[i] - dt); this.spellCooldown[i] = Math.max(0, this.spellCooldown[i] - dt);
      const held = (k: number) => this.keys.has(keys[k]) || (this.solo && this.keys.has(MOVE[1][k]));
      let dx = Number(held(1)) - Number(held(0));
      let dz = Number(held(3)) - Number(held(2));
      // Phone joystick: analog direction and speed for hero 0 whenever no movement key is held.
      const stick = i === 0 && this.phone && dx === 0 && dz === 0 ? this.phone.read() : undefined;
      const analog = stick && stick.mag > 0 ? stick.mag : 1;
      if (stick && stick.mag > 0) { dx = stick.x; dz = stick.z; }
      // Keyboard diagonals: weight forward/back over sideways (about 34 deg instead of 45) so a diagonal reads as
      // "forward and drifting", not a wide sideways run.
      else if (dx !== 0 && dz !== 0) dx *= 0.68;
      const moving = dx !== 0 || dz !== 0;
      const poseKeys = i === 0 ? ['Digit1', 'Digit2', 'Digit3'] : ['KeyI', 'KeyO', 'KeyP'];
      hero.pose = ['arms-up', 't-pose', 'crouch'][poseKeys.findIndex((key) => this.keys.has(key))] ?? '';
      if (i === 1 && this.trial?.type === 'pose' && this.time > this.companionUntil) hero.pose = this.heroes[0].pose;
      if (i === 1 && this.time > this.companionUntil && this.enemies.some((enemy) => enemy.boss && enemy.windup > 0 && enemy.attack === 'shadow-wave')) hero.pose = 'crouch';
      if (this.physics?.setCrouching(i, hero.pose === 'crouch')) hero.pose = 'crouch';
      // Input is relative to what the camera actually shows (its smoothed yaw), so controls never fight the view.
      const view = this.rig.viewYaw;
      let direction = new T.Vector3(dx * Math.cos(view) + dz * Math.sin(view), 0, -dx * Math.sin(view) + dz * Math.cos(view));
      let companionSpeed = 0;
      if (i === 1 && !moving && this.time > this.companionUntil && !this.trial) {
        // Walk beside the leader (screen-left or right), never between the camera and the hero.
        const leader = this.heroes[0].root.position, right = new T.Vector3(Math.cos(view), 0, -Math.sin(view)), back = new T.Vector3(Math.sin(view), 0, Math.cos(view));
        const side = p.clone().sub(leader).dot(right); if (Math.abs(side) > 1.2) this.companionSide = Math.sign(side);
        const slot = leader.clone().addScaledVector(right, this.companionSide * 1.8).addScaledVector(back, 0.35);
        const d = distance(p, slot);
        if (d > 0.55) { direction.copy(slot).sub(p).setY(0); companionSpeed = Math.min(distance(p, leader) > 6 ? 7.6 : 5.2, d * 2.6); } else direction.set(0, 0, 0);
        if (this.enemies.some((enemy) => enemy.boss && enemy.windup > 0 && enemy.attack === 'frost-gaze')) direction.set(0, 0, 0);
      }
      let speed = direction.lengthSq() ? (companionSpeed || 4.7) * analog : 0;
      const sprinting = this.keys.has('ShiftLeft') || !!stick?.sprint;
      if (i === 0 && speed && this.lock && this.lock.hp > 0 && !sprinting) speed = Math.min(speed, 3.9); // strafing while focused
      if (i === 0 && speed && sprinting && this.stamina > 0.03 && !this.trial) { speed = 8.5; this.stamina = Math.max(0, this.stamina - dt * 0.32); }
      if (i === 0 && this.attackCooldown[0] > 0 && !this.dodge[0]) speed *= 0.35; // planted while swinging
      if (this.trial?.type === 'pose') speed = 0;
      if (hero.pose === 'crouch') speed *= 0.5;
      if (heightAt(p.x, p.z) < -0.4) speed *= 0.56;
      this.rollIframes[i] = Math.max(0, this.rollIframes[i] - dt); this.rollCooldown[i] = Math.max(0, this.rollCooldown[i] - dt); this.flashCooldown[i] = Math.max(0, this.flashCooldown[i] - dt);
      const rolling = this.rollTime[i] > 0;
      if (rolling) { this.rollTime[i] -= dt; direction.copy(this.dodgeDirection[i]); speed = ROLL.speed; }
      hero.roll = rolling ? 1 - Math.max(0, this.rollTime[i]) / ROLL.length : -1;
      if (this.dodge[i] > 0) { this.dodge[i] -= dt; direction.copy(this.dodgeDirection[i]); speed = 19; }
      direction.normalize();
      const velocity = this.movementVelocity[i];
      // Direction follows the input immediately (no turning arc); only the speed ramps briefly.
      const current = Math.hypot(velocity.x, velocity.z);
      if (this.dodge[i] > 0 || rolling) velocity.copy(direction).multiplyScalar(speed);
      else if (speed > 0) velocity.copy(direction).multiplyScalar(current + (speed - current) * (1 - Math.exp(-dt * 20)));
      else velocity.multiplyScalar(Math.exp(-dt * 20));
      if (this.trial?.type === 'pose') velocity.set(0, 0, 0);
      // Safety net: anything that slips under the terrain is set back on top of it.
      if (p.y < heightAt(p.x, p.z) - 2.5) { p.y = Math.max(heightAt(p.x, p.z), -0.5) + 0.3; this.velocityY[i] = 0; this.fallSpeed[i] = 0; }
      const wasAir = this.airborne[i]; this.fallSpeed[i] = Math.min(this.fallSpeed[i], this.velocityY[i]);
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
      const focused = i === 0 && this.lock && this.lock.hp > 0 && this.dodge[0] <= 0 && !rolling ? this.lock : undefined;
      if (focused) hero.heading = Math.atan2(focused.root.position.x - p.x, focused.root.position.z - p.z);
      else if (direction.lengthSq() && this.attackCooldown[i] <= 0) hero.heading = Math.atan2(direction.x, direction.z);
      // Rapier settling on slopes leaves ~0.3 u/s of jitter; below this dead zone a hero counts as standing still
      // (otherwise idle heroes animate as walking and the stillness challenge can never be passed).
      const travelled = Math.hypot(p.x - beforeX, p.z - beforeZ), measured = dt > 0 ? travelled / dt : 0; hero.moving = measured > 0.7 ? measured : 0; hero.body.rotation.z = this.dodge[i] > 0 ? Math.sin(this.dodge[i] / 0.27 * Math.PI) * 0.55 : 0;
      // Raise the sword into a ready stance when a foe is close or focused; lower it again when the wood is quiet.
      hero.guard = (i === 0 && !!this.lock) || this.enemies.some((enemy) => enemy.hp > 0 && distance(enemy.root.position, p) < 11);
      // Footsteps and dust, landing impacts.
      const grounded = this.physics ? this.physics.isGrounded(i) : this.jump[i] === 0;
      this.airborne[i] = !grounded;
      if (wasAir && grounded) {
        const impact = -this.fallSpeed[i]; this.fallSpeed[i] = 0;
        if (impact > 4) { this.sfx.land(impact > 9); this.fx.puff(p, 0xb9ad85, impact > 9 ? 14 : 8, impact > 9 ? 2.6 : 1.6, 0.6, 0.7); if (impact > 9 && i === 0) this.rig.addTrauma(0.2); }
      }
      if (grounded && hero.moving > 0.7) {
        this.stepDistance[i] += travelled;
        const stride = hero.moving > 6 ? 1.75 : 1.25;
        if (this.stepDistance[i] > stride) {
          this.stepDistance[i] = 0;
          const surface = heightAt(p.x, p.z) < -0.35 ? 'water' : pathDistance(p.x, p.z) < 2.3 ? 'stone' : 'grass';
          this.sfx.footstep(surface, hero.moving > 6, i ? 0.4 : 1);
          if (surface === 'water') this.fx.puff(p, 0xd6efe9, 6, 1.4, 0.4, 0.5);
          else if (hero.moving > 6 || surface === 'stone') this.fx.puff(p, surface === 'stone' ? 0xcdbf9b : 0x8f8a5c, hero.moving > 6 ? 4 : 2, 0.9, 0.38, 0.55);
        }
      }
    }
    const p = this.heroes[0].root.position;
    if (this.fairy.visible) this.fairy.position.set(p.x + Math.sin(this.time * 2) * 0.65, p.y + 2.25 + Math.sin(this.time * 3) * 0.14, p.z + Math.cos(this.time * 2) * 0.65);
    const region = regionAt(p.x, p.z);
    if (region !== this.region) {
      this.region = region; this.state!.visit(region); this.ui.discover(REGIONS[region].name); this.sfx.setRegion(region);
    }
    if (!this.encounterKind && !this.trial) {
      this.nearest = this.world.objects.filter((o) => distance(p, o) < 2.4).sort((a, b) => distance(p, a) - distance(p, b))[0];
      this.ui.context(this.target && distance(p, this.target) < 3.2 ? this.target.name : this.nearest?.name);
    } else this.ui.context();
    if (this.target && !this.trial && !this.encounterKind) this.ui.quest(this.target.name, `${Math.round(distance(p, this.target))} steps away · follow the golden beacon`);
    for (const shard of this.world.shards) {
      if (!shard.taken && distance(p, shard.mesh.position) < 1) {
        shard.taken = true; shard.mesh.visible = false; this.state!.stars[0]++;
        this.fx.motes(shard.mesh.position, 0xffe7a6, 16, 0.3, 2.2, 0.26, 1); this.fx.sparks(shard.mesh.position, 0xfff3c2, 10, 3, 0.15, 0.4, 2); this.fx.flash(shard.mesh.position, 0xffe2a0, 6, 0.25);
        this.fx.number(shard.mesh.position.clone().add(new T.Vector3(0, 0.5, 0)), '+1 ✦', '#ffe7a6'); this.sfx.pickup();
      }
    }
    this.updateTrial(dt); if (this.ended) { this.physics?.step(dt); return; }
    this.resolveHits(); this.updateEnemies(dt); this.updateBolts(dt); this.updateStrikes(); this.updateSparks(dt); this.updatePickups(dt); this.updateCamps(dt);
    if (this.lock && (this.lock.hp <= 0 || distance(this.lock.root.position, p) > 26)) { this.lock = undefined; this.sfx.lockOff(); }
    this.companionCast -= dt;
    if (!this.solo && this.companionCast <= 0 && this.time > this.companionUntil && !this.trial && this.closestEnemy(this.heroes[1].root.position, 13)) { this.cast(1); this.companionCast = this.state!.has('fairy-ally') ? 0.85 : 2.1; }
    this.physics?.step(dt);
  }

  private updateTrial(dt: number): void {
    const trial = this.trial; if (!trial) return;
    trial.elapsed += dt;
    if (trial.type === 'freeze') {
      if (this.active.some((hero) => hero.moving > 0.1) || this.cv?.moving()) trial.moved += dt;
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
      // The seal also opens to its rune drawn with a wand (cv_2 tracker): the tracker is asked for that shape.
      const rune = POSE_SHAPE[pose], wand = this.cv?.trackerConnected ? ` or draw a ${rune}` : '';
      this.cv?.gate(true, rune);
      const matching = this.active.every((hero) => hero.pose === pose);
      if (this.cv?.takeShape(rune)) trial.held = 1.2;
      else if (matching) trial.held += dt;
      else trial.held = Math.max(0, trial.held - dt * 0.5);
      this.ui.challenge(name, `Hold ${key}${wand} · seal ${trial.poseIndex + 1} of ${trial.poses.length} · ${Math.max(0, trial.secondsPerPose - trial.elapsed).toFixed(1)}s`, trial.held / 1.2);
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
      if (enemy.hp <= 0) {
        if (enemy.pawn !== undefined) { this.physics?.removeCharacter(enemy.pawn); enemy.pawn = undefined; }
        // Dissolve: shrink and sink into a puff of shadow instead of popping out of existence.
        if (enemy.dying > 0) {
          enemy.dying -= dt; enemy.actor?.update(dt, this.time);
          const s = clamp(enemy.dying / 0.45, 0.01, 1);
          if (s < 1) { enemy.root.scale.set(1 + (1 - s) * 0.3, s, 1 + (1 - s) * 0.3); enemy.root.position.y -= dt * 0.8; if (Math.random() < 0.6) this.fx.trail(enemy.root.position.clone().add(new T.Vector3((Math.random() - 0.5), 0.8 * s, (Math.random() - 0.5))), 0x8f73d9, 0.35); }
        }
        if (enemy.dying <= 0) enemy.root.visible = false;
        continue;
      }
      // Flash white on hit.
      if (enemy.flash > 0 || enemy.flashMats[0]?.userData.flashing) {
        enemy.flash = Math.max(0, enemy.flash - dt); const k = enemy.flash / 0.14;
        for (const m of enemy.flashMats) { if (k > 0) { m.emissive.setRGB(1, 0.95, 0.85); m.emissiveIntensity = 1.4 * k; m.userData.flashing = true; } else { m.emissive.copy(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseIntensity; m.userData.flashing = false; } }
      }
      if (this.ended || this.trial) continue;
      // Enemies crawl during a flurry rush; the hero does not.
      const real = dt; dt = this.flurry > 0 ? dt * 0.15 : dt;
      const target = this.active.reduce((a, b) => distance(a.root.position, enemy.root.position) < distance(b.root.position, enemy.root.position) ? a : b);
      const p = enemy.root.position, d = distance(p, target.root.position);
      const motion = new T.Vector3(enemy.knock.x * real, -dt * 4, enemy.knock.z * real); enemy.knock.multiplyScalar(Math.exp(-real * 8));
      enemy.cooldown -= dt; enemy.core.position.y = (enemy.boss ? 1.9 : 0.9) + Math.sin(this.time * 3 + enemy.home.x) * 0.13;
      if (enemy.windup > 0) {
        enemy.windup -= dt; enemy.ring.visible = true; enemy.ring.scale.setScalar(1 + Math.sin(this.time * 11) * 0.04);
        if (enemy.boss) this.ui.boss(enemy.boss.name, enemy.hp / enemy.maxHp, enemy.attack === 'frost-gaze' ? 'Frost gaze · stand perfectly still' : 'Shadow wave · hold 3 to crouch, or dodge away' + this.fearsLine(enemy.boss.kind));
        if (enemy.windup <= 0) {
          // In the demo run the horde swings a little less often, so a six-strong wave is fierce but survivable.
          enemy.ring.visible = false; enemy.cooldown = enemy.boss ? enemy.boss.vulnerableSec : enemy.elite ? 1.5 : this.demo ? 2.6 : 2;
          // Regular foes lunge into the strike.
          if (!enemy.boss) { const lunge = target.root.position.clone().sub(p).setY(0); if (lunge.lengthSq() > 0.01) enemy.knock.add(lunge.normalize().multiplyScalar(7)); }
          this.burst(p.clone().add(new T.Vector3(0, 0.2, 0)), enemy.boss ? 0xa4d8df : 0xf7b69a, 17);
          this.fx.shockwave(p, enemy.boss ? 0xa4d8df : 0xff9a7a, enemy.boss ? 8 : 2.6, 0.4); this.sfx.land(!!enemy.boss); if (enemy.boss) this.rig.addTrauma(0.35);
          const victim = this.active.findIndex((hero, i) => distance(p, hero.root.position) < (enemy.boss ? 8 : 2.6) && this.dodge[i] <= 0 && this.rollIframes[i] <= 0 && this.jump[i] < 0.7 && this.physics?.wallDistance(p.clone().add(new T.Vector3(0, 1, 0)), hero.root.position.clone().add(new T.Vector3(0, 1, 0))) === undefined && (enemy.attack === 'frost-gaze' ? hero.moving > 0.1 : enemy.attack === 'shadow-wave' ? hero.pose !== 'crouch' : true));
          if (victim >= 0) this.hurt();
        }
      } else {
        // Camp enemies: wander, notice, chase, give up past the leash and heal at home.
        let face = Math.atan2(target.root.position.x - p.x, target.root.position.z - p.z);
        if (!enemy.encounter && !enemy.boss) {
          const dHome = distance(p, enemy.home);
          if (enemy.ai === 'idle') {
            enemy.aiT -= dt;
            if (enemy.aiT <= 0 || !enemy.wander) { enemy.aiT = 2.5 + Math.random() * 3.5; const a = Math.random() * Math.PI * 2, r = Math.random() * 3.5; enemy.wander = { x: enemy.home.x + Math.cos(a) * r, z: enemy.home.z + Math.sin(a) * r }; }
            const ahead = Math.abs(Math.atan2(Math.sin(face - enemy.root.rotation.y), Math.cos(face - enemy.root.rotation.y)));
            if (d < 5.5 || (d < 13 && ahead < 1.1)) this.alertCamp(enemy);
          } else if (enemy.ai === 'alert') { enemy.aiT -= dt; if (enemy.aiT <= 0) enemy.ai = 'chase'; }
          else if (enemy.ai === 'chase') { if (dHome > 26 || d > 22) enemy.ai = 'return'; }
          else if (dHome < 1.5) { enemy.ai = 'idle'; enemy.hp = enemy.maxHp; enemy.shown = 0; }
        }
        const engaged = enemy.encounter || !!enemy.boss || enemy.ai === 'chase';
        const walk = (to: Position, speed: number) => { const dx = to.x - p.x, dz = to.z - p.z, len = Math.hypot(dx, dz); if (len > 0.4) { motion.x += dx / len * speed * dt; motion.z += dz / len * speed * dt; face = Math.atan2(dx, dz); } };
        // In the demo run at most two of the horde wind up at once, with a longer, readable telegraph.
        const crowded = !!this.demo && !enemy.boss && this.enemies.filter((e) => !e.boss && e.hp > 0 && e.windup > 0).length >= 2;
        if (engaged && d < (enemy.boss ? 11 : 2.6) && enemy.cooldown <= 0 && !crowded) {
          enemy.windup = enemy.boss ? enemy.boss.telegraphSec : this.demo ? 1.15 : 0.9;
          enemy.attack = enemy.boss ? enemy.boss.attacks[Math.floor(this.time) % enemy.boss.attacks.length] : 'strike';
          // The punch winds up through the telegraph and lands as the strike resolves.
          if (enemy.actor && !enemy.boss) { const a = enemy.actor; a.attackClip = 'punch_right'; a.attack = a.attackLength = enemy.windup + 0.35; a.attackContact = enemy.windup; a.attackSerial++; }
          this.fx.warn(p.clone().add(new T.Vector3(0, enemy.boss ? 3.6 : enemy.elite ? 2.3 : 1.7, 0))); this.sfx.warn();
        } else if (engaged && d < (enemy.encounter ? 35 : enemy.boss ? 12 : 30) && d > (enemy.boss ? 5 : 1.7)) {
          // A boss strides in from afar, then closes the last few steps slowly and deliberately.
          walk(target.root.position, enemy.boss ? (d > 9 ? 3.2 : 1.4) : enemy.encounter ? 2.3 : enemy.elite ? 2.6 : 3.0);
          face = Math.atan2(target.root.position.x - p.x, target.root.position.z - p.z);
        } else if (enemy.ai === 'return') walk(enemy.home, 3.2);
        else if (enemy.ai === 'idle' && enemy.wander) walk(enemy.wander, 1.1);
        // Turn smoothly rather than snapping toward the hero.
        const turn = Math.atan2(Math.sin(face - enemy.root.rotation.y), Math.cos(face - enemy.root.rotation.y));
        enemy.root.rotation.y += turn * Math.min(1, dt * (engaged ? 8 : 4));
      }
      if (enemy.windup > 0) enemy.root.rotation.y = Math.atan2(target.root.position.x - p.x, target.root.position.z - p.z);
      if (this.physics && enemy.pawn !== undefined) p.copy(this.physics.move(enemy.pawn, p, motion));
      else { const next = moveOnGround(p, motion.x, motion.z, this.world.solids); p.x = next.x; p.z = next.z; p.y = Math.max(heightAt(p.x, p.z), -0.3); }
      if (enemy.bar) { enemy.shown -= dt; enemy.bar.visible = enemy.shown > 0 || this.lock === enemy; }
      if (enemy.visual) enemy.visual.rotation.z = Math.sin(this.time * 2 + enemy.home.x) * 0.025;
      if (enemy.actor) {
        // Ground speed only: the constant downward step that keeps foes on the terrain made idle ones run in place.
        enemy.actor.heading = 0; enemy.actor.moving = Math.hypot(motion.x, motion.z) / Math.max(dt, 0.001);
        enemy.actor.pose = enemy.boss && enemy.windup > 0 ? 'arms-up' : '';
        enemy.actor.guard = !!enemy.boss || enemy.encounter || enemy.ai === 'chase' || enemy.ai === 'alert';
        enemy.actor.update(dt, this.time);
      }
      if (enemy.boss && enemy.windup <= 0) this.ui.boss(enemy.boss.name, enemy.hp / enemy.maxHp, 'The ward is down · strike now' + this.fearsLine(enemy.boss.kind));
      dt = real;
    }
  }

  private updateBolts(dt: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i]; bolt.life -= dt; const from = bolt.mesh.position.clone(); bolt.mesh.position.addScaledVector(bolt.velocity, dt);
      const color = bolt.color;
      for (let k = 0; k < 3; k++) this.fx.trail(from.clone().lerp(bolt.mesh.position, k / 3), color, 0.34);
      bolt.mesh.rotation.x += dt * 9; bolt.mesh.rotation.y += dt * 7;
      const wall = this.physics?.wallDistance(from, bolt.mesh.position);
      if (wall !== undefined) { bolt.mesh.position.copy(from).addScaledVector(bolt.velocity.clone().normalize(), wall); }
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const center = enemy.root.position.clone().add(new T.Vector3(0, enemy.boss ? 1.8 : 0.9, 0));
        const line = new T.Line3(from, bolt.mesh.position); const nearest = line.closestPointToPoint(center, true, new T.Vector3());
        if (bolt.hit.has(enemy)) continue;
        if (nearest.distanceTo(center) < (enemy.boss ? 1.5 : 0.7)) {
          this.hit(enemy, bolt.damage, bolt.player, false, bolt.element); bolt.hit.add(enemy);
          this.fx.sparks(nearest, color, 22, 7, 0.24, 0.5, 3); this.fx.shockwave(enemy.root.position, color, 2.2, 0.35); this.fx.flash(nearest, color, 14, 0.2); this.sfx.burst();
          if (bolt.chain > 0) this.chainFrom(enemy, bolt);
          if (bolt.pierce > 0) { bolt.pierce--; continue; }
          bolt.life = 0; break;
        }
      }
      if (wall !== undefined) { this.fx.sparks(bolt.mesh.position, color, 14, 5, 0.2, 0.4, 4); this.fx.puff(bolt.mesh.position, 0xb6ad8f, 4, 0.8, 0.35, 0.5); this.sfx.burst(); bolt.life = 0; }
      if (bolt.life <= 0) { this.scene.remove(bolt.mesh); bolt.mesh.traverse((o) => { if (o instanceof T.Mesh) { o.geometry.dispose(); (o.material as T.Material).dispose(); } }); this.bolts.splice(i, 1); }
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
    const lock = this.lock && this.lock.hp > 0 ? this.lock.root.position.clone().add(new T.Vector3(0, this.lock.boss ? 1.8 : 0.9, 0)) : undefined;
    this.rig.update(dt, this.time, {
      hero: p, velocity: this.movementVelocity[0], sprint: this.keys.has('ShiftLeft'), airborne: this.airborne[0],
      lock, physics: this.physics, flurry: this.post.flurry, reduced: this.reducedMotion,
    });
    this.focus.copy(this.rig.focus);
    this.heroes[0].root.visible = this.camera.position.distanceTo(this.focus) > 0.8;
    this.sun.position.set(p.x - 34, 40, p.z + 22); this.sun.target.position.set(p.x, 0, p.z);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.narrator.stop();
    this.events.abort(); this.scanner.dispose(); this.shapes.dispose(); this.hud.dispose(); this.wands.forEach((wand) => wand?.dispose()); this.phone?.dispose(); this.cv?.dispose(); this.wandHud?.dispose(); this.renderer.setAnimationLoop(null);
    this.physics?.dispose();
    this.scene.traverse((object) => { if (object instanceof T.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((mat) => mat.dispose()); } });
    this.sparkGeometry.dispose(); this.wheel.remove(); this.post.composer.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); this.ui.root.remove(); this.ui.modal.remove(); document.querySelector('.adventure-start')?.remove();
  }
}
