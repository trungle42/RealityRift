import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { Actor } from './Actor';
import { avatarFor, dressAvatar, tintStandIn, type Avatar, type AvatarModels } from './avatars';
import type { Fx } from './Fx';
import { WandModel } from './WandModel';
import { ELEMENT_COLOR, type Element } from './weapon';
import { animOf, parsePresence, peerColor, presenceConfig, SEND_RATE, SnapshotBuffer, wrapAngle, type Anim, type FxEvent, type HeroState, type LocalHero, type Peer } from './presenceMath';

const ROLL_LENGTH = 0.55;

interface HeroModels extends AvatarModels { sword: GLTF }

/**
 * Another player's hero, drawn from their laptop's state: purely visual (no physics body, cannot be hit, never blocks
 * anyone). Position and heading are blended from a short snapshot buffer; their swings, casts, rolls and falls replay on
 * the same Actor rig the local heroes use, with their wand colour on the wand, sword glow, ground ring and name tag.
 */
export class RemoteHero {
  readonly actor: Actor;
  readonly buffer = new SnapshotBuffer();
  readonly color: number;
  private readonly tag: T.Sprite;
  private readonly ring: T.Mesh;
  private readonly wand = new WandModel();
  private anim: Anim = 'idle';
  private rollFrom = -1;
  private placed = false;

  /** Their look, from their wand colour: red ranger, blue shieldmaiden, yellow gold ranger (avatars.ts). */
  readonly avatar: Avatar;

  constructor(readonly peer: Peer, scene: T.Scene) {
    this.color = peerColor(peer.colour);
    this.avatar = avatarFor(peer.colour);
    this.actor = new Actor(this.avatar === 'maiden'); tintStandIn(this.actor, this.color);
    this.wand.setColor(this.color);
    this.tag = nameTag(peer.name, this.color); this.tag.position.y = 2.45; this.actor.root.add(this.tag);
    this.ring = new T.Mesh(new T.RingGeometry(0.48, 0.6, 32), new T.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.04; this.actor.root.add(this.ring);
    this.actor.root.visible = false; scene.add(this.actor.root);
  }

  /** Swap the stand-in body for the real hero model once it has loaded. */
  dress(models: HeroModels): void {
    dressAvatar(this.actor, this.avatar, models);
    this.actor.holdWeapon(models.sword.scene); this.actor.holdWand(this.wand.root); this.actor.glowWeapon(this.color);
  }

  push(state: HeroState, now: number): void { this.buffer.push(state, now); }

  /** A remote swing or cast: replay its one-shot on the rig (their state's anim alone would merge a combo into one swing). */
  oneShot(kind: 'cast' | 'slash'): void {
    const a = this.actor; a.attackClip = 'strike'; a.attack = a.attackLength = kind === 'cast' ? 0.35 : 0.42; a.attackContact = kind === 'cast' ? 0.12 : 0.16; a.attackSerial++;
    if (kind === 'cast') this.wand.flash();
  }

  update(dt: number, now: number, time: number): void {
    const s = this.buffer.sample(now); if (!s) return;
    const a = this.actor;
    a.root.position.set(s.x, s.y, s.z); a.heading = s.heading; a.moving = s.speed > 0.7 ? s.speed : 0;
    if (!this.placed) { a.root.rotation.y = s.heading; this.placed = true; a.root.visible = true; }
    if (s.anim !== this.anim) {
      if (s.anim === 'roll') this.rollFrom = time;
      if (s.anim === 'hurt') { a.stagger = 0.45; a.hurt = 0.6; }
      this.anim = s.anim;
    }
    a.roll = this.rollFrom >= 0 && time - this.rollFrom < ROLL_LENGTH ? (time - this.rollFrom) / ROLL_LENGTH : -1;
    if (a.roll < 0) this.rollFrom = -1;
    a.dead = s.anim === 'dead'; a.pose = s.anim === 'pose' ? 'arms-up' : '';
    a.update(dt, time); this.wand.update(dt);
  }

  dispose(): void {
    this.actor.root.removeFromParent();
    this.actor.root.traverse((o) => { if (o instanceof T.Sprite) { o.material.map?.dispose(); o.material.dispose(); } });
    (this.ring.material as T.Material).dispose(); this.ring.geometry.dispose(); this.wand.dispose();
  }
}

/** A cosmetic projectile for a remote cast: it flies and trails sparkles but never hits anything. */
interface Ghost { pos: T.Vector3; vel: T.Vector3; life: number; color: number }

export interface PresenceOptions {
  scene: T.Scene; fx: Fx; renderer: T.WebGLRenderer; hud: HTMLElement;
  /** For tests: a socket factory instead of `new WebSocket(url)`. */
  socket?: (url: string) => WebSocket;
}

/**
 * Online presence: this laptop sends hero 0's state ~12 times a second plus an `fx` event for each cast and swing, and
 * draws every other player in the room as a RemoteHero with their effects (cosmetic only: each laptop fights its own foes
 * in step 1). Off unless `?presence=ws://host:port` (or `window.RIFT_PRESENCE`) is set. Never throws; reconnects quietly.
 */
export class Presence {
  readonly peers = new Map<string, RemoteHero>();
  id?: string;
  private socket?: WebSocket;
  private retry = 0;
  private timer = 0;
  private closed = false;
  /** The relay said the room already has three players: stop retrying. */
  private full = false;
  /** Wall-clock times (see `clock`): when state last went out, and until when hero 0 counts as casting. */
  private sentAt = -Infinity;
  private castingUntil = -Infinity;
  /**
   * Snapshots are stamped on arrival and sampled on the wall clock, not by summing frame deltas: frame() caps each delta,
   * so in a throttled or background tab a summed clock falls behind and remote heroes would freeze in the past.
   */
  private readonly clock = (): number => performance.now() / 1000;
  private models?: HeroModels;
  private readonly ghosts: Ghost[] = [];
  /** Remote effects played so far, per kind, and the latest one (for the multi-laptop test harness). */
  readonly fxCount = { cast: 0, slash: 0 };
  lastFx?: FxEvent & { id: string };
  private readonly list = document.createElement('div');

  /** A Presence if this page asks for one, else undefined (normal single-laptop play). */
  static fromPage(options: PresenceOptions): Presence | undefined {
    const config = presenceConfig(location.search, (window as unknown as { RIFT_PRESENCE?: string }).RIFT_PRESENCE);
    return config ? new Presence(config, options) : undefined;
  }

  constructor(readonly config: { url: string; room: string; name: string; colour: string }, private readonly options: PresenceOptions) {
    this.list.className = 'presence-list';
    Object.assign(this.list.style, { position: 'absolute', top: '232px', right: '18px', padding: '6px 10px', borderRadius: '6px', background: 'var(--game-panel, #19372fd9)', color: 'var(--game-text, #faf5e1)', font: '13px Georgia, serif', pointerEvents: 'none', zIndex: '3' });
    options.hud.append(this.list); this.renderList();
    // Dev builds only: the 3-laptop harness asserts on window.__storybound.presence (avatars, fxCount, lastFx).
    if (import.meta.env.DEV) { const w = window as unknown as { __storybound?: Record<string, unknown> }; w.__storybound = { ...w.__storybound, presence: this }; }
    void this.loadModels();
    this.connect();
  }

  /** Every remote player's hero by relay id: their name, wand colour and the root drawn in the world. */
  get avatars(): Map<string, { name: string; colour: string; root: T.Object3D }> {
    return new Map([...this.peers].map(([id, remote]) => [id, { name: remote.peer.name, colour: remote.peer.colour, root: remote.actor.root }]));
  }

  /** Is this laptop the room's host? (The first to join; step 2 will let only the host spawn and simulate enemies.) */
  get host(): boolean { return this.id !== undefined && [...this.peers.keys()].every((id) => Number(this.id) < Number(id)); }

  /** Hero 0 cast a spell or swung its sword: show it on the other laptops. */
  fx(kind: 'cast' | 'slash', at: T.Vector3, direction: T.Vector3, spell?: { ability?: string; element?: Element }): void {
    if (kind === 'cast') this.castingUntil = this.clock() + 0.35;
    const flat = new T.Vector2(direction.x, direction.z); if (flat.lengthSq() > 0) flat.normalize();
    this.send({ type: 'fx', kind, ability: spell?.ability, element: spell?.element, x: round(at.x), y: round(at.y), z: round(at.z), dx: round(flat.x), dz: round(flat.y) });
  }

  /** Every frame (paused or not: other players keep moving). `real` is wall-clock seconds, `time` the game clock. */
  update(real: number, time: number, hero: Actor, airborne: boolean): void {
    const now = this.clock();
    if (now - this.sentAt >= 1 / SEND_RATE) {
      this.sentAt = now;
      const p = hero.root.position, local: LocalHero = { dead: hero.dead, stagger: hero.stagger, roll: hero.roll, airborne, casting: now < this.castingUntil, attack: hero.attack, pose: hero.pose, speed: hero.moving };
      this.send({ type: 'state', x: round(p.x), y: round(p.y), z: round(p.z), heading: round(wrapAngle(hero.heading)), speed: round(Math.min(50, hero.moving)), anim: animOf(local), hp: hero.dead ? 0 : 3 });
    }
    for (const remote of this.peers.values()) remote.update(real, now, time);
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]; g.life -= real; g.pos.addScaledVector(g.vel, real); this.options.fx.trail(g.pos, g.color, 0.3);
      if (g.life <= 0) { this.options.fx.flash(g.pos, g.color, 8, 0.18); this.ghosts.splice(i, 1); }
    }
  }

  dispose(): void {
    this.closed = true; clearTimeout(this.timer); this.socket?.close();
    this.peers.forEach((remote) => remote.dispose()); this.peers.clear(); this.list.remove();
    const w = window as unknown as { __storybound?: { presence?: unknown } }; if (w.__storybound?.presence === this) delete w.__storybound.presence;
  }

  /** One relay message (public so a test can feed it without a socket). */
  handle(raw: unknown): void {
    const message = parsePresence(raw); if (!message) return;
    if (message.type === 'full') { this.full = true; this.renderList(); return; }
    if (message.type === 'welcome') { this.id = message.id; [...this.peers.keys()].forEach((id) => this.drop(id)); message.peers.forEach((peer) => this.add(peer)); }
    else if (message.type === 'peer') { if (message.peer.id === this.id) return; if (message.state === 'joined') this.add(message.peer); else this.drop(message.peer.id); }
    else if (message.type === 'state') this.peers.get(message.id)?.push(message.state, this.clock());
    else if (message.type === 'fx') { const remote = this.peers.get(message.id); if (remote) this.play(remote, message.fx); }
    this.renderList();
  }

  private add(peer: Peer): void {
    if (this.peers.has(peer.id)) return;
    const remote = new RemoteHero(peer, this.options.scene);
    if (this.models) remote.dress(this.models);
    this.peers.set(peer.id, remote);
  }

  private drop(id: string): void { this.peers.get(id)?.dispose(); this.peers.delete(id); }

  /** Their effect from where they stand, in their wand colour (or their relic's element): no damage in step 1. */
  private play(remote: RemoteHero, fx: FxEvent): void {
    const { fx: effects } = this.options, at = new T.Vector3(fx.x, fx.y, fx.z), dir = new T.Vector3(fx.dx, 0, fx.dz);
    const color = fx.element && fx.element in ELEMENT_COLOR ? ELEMENT_COLOR[fx.element as Element] : remote.color, heading = Math.atan2(fx.dx, fx.dz);
    remote.oneShot(fx.kind); this.fxCount[fx.kind]++; this.lastFx = { ...fx, id: remote.peer.id };
    if (fx.kind === 'slash') { effects.slash(at.clone().add(new T.Vector3(0, 1.1, 0)), heading, color); return; }
    const hand = at.clone().add(new T.Vector3(0, 1.25, 0));
    effects.motes(hand, color, 12, 0.35, 1.2, 0.26, 0.5); effects.flash(hand, color, 9, 0.2);
    if (fx.ability === 'nova') { effects.shockwave(at, color, 6, 0.55, 0.3); effects.motes(hand, color, 40, 3, 1.4, 0.3, 0.8); }
    else if (fx.ability === 'meteor') { const land = at.clone().addScaledVector(dir, 8); effects.shockwave(land, color, 3.4, 0.75, 0.12); effects.sparks(land.clone().add(new T.Vector3(0, 0.5, 0)), color, 30, 9, 0.26, 0.6, 7); }
    else {
      const count = fx.ability === 'wave' ? 3 : 1;
      for (let k = 0; k < count; k++) this.ghosts.push({ pos: hand.clone(), vel: dir.clone().applyAxisAngle(new T.Vector3(0, 1, 0), (k - (count - 1) / 2) * 0.3).multiplyScalar(22), life: 0.6, color });
    }
  }

  /** "Online · ● Trung ● Rishaan ● haicil", this player first. Built from text nodes: names come from other laptops. */
  private renderList(): void {
    const everyone = [{ name: this.config.name, colour: this.config.colour }, ...[...this.peers.values()].map((r) => r.peer)];
    const label = document.createElement('strong'); label.style.color = 'var(--game-gold, #f0d48e)';
    label.textContent = this.full ? 'Room full (3 players)' : this.socket?.readyState === 1 ? 'Online' : 'Connecting';
    const parts: Node[] = [label, document.createTextNode(' ·')];
    for (const p of everyone) {
      const dot = document.createElement('span');
      Object.assign(dot.style, { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', margin: '0 4px 1px 8px', background: `#${peerColor(p.colour).toString(16).padStart(6, '0')}` });
      const name = document.createElement('span'); name.className = 'presence-name'; name.textContent = p.name;
      parts.push(dot, name);
    }
    this.list.replaceChildren(...parts);
  }

  private send(message: object): void { if (this.socket?.readyState === 1) { try { this.socket.send(JSON.stringify(message)); } catch { /* the close handler reconnects */ } } }

  private connect(): void {
    if (this.closed) return;
    try {
      const socket = this.options.socket ? this.options.socket(this.config.url) : new WebSocket(this.config.url);
      this.socket = socket;
      socket.onopen = () => { this.retry = 0; this.renderList(); };
      socket.onmessage = (event) => { let raw: unknown; try { raw = JSON.parse(String(event.data)); } catch { return; } this.handle(raw); };
      socket.onclose = () => {
        this.peers.forEach((remote) => remote.dispose()); this.peers.clear(); this.renderList();
        if (!this.closed && !this.full) this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 600 + this.retry++ * 600));
      };
      socket.onerror = () => socket.close();
    } catch { if (!this.closed) this.timer = window.setTimeout(() => this.connect(), 3000); }
  }

  private async loadModels(): Promise<void> {
    try {
      const loader = new GLTFLoader().setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(this.options.renderer));
      const [ranger, combat, maiden, sword] = await Promise.all(['assetyard/ashfen-ranger', 'assetyard/hollow-warden', 'assetyard/vale-shieldmaiden', 'evermere-sword'].map((name) => loader.loadAsync(`/models/${name}.glb`)));
      if (this.closed) return;
      this.models = { ranger, combat, maiden, sword }; this.peers.forEach((remote) => remote.dress(this.models!));
    } catch { /* no art pack: remote heroes keep the built-in stand-in body */ }
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** A floating name in the player's colour, always facing the camera. */
function nameTag(name: string, color: number): T.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.font = 'bold 34px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(16,30,24,0.85)'; g.strokeText(name, 128, 32);
    g.fillStyle = `#${color.toString(16).padStart(6, '0')}`; g.fillText(name, 128, 32);
  }
  const sprite = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), depthWrite: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1); sprite.renderOrder = 10;
  return sprite;
}
