import * as T from 'three';
import { SHAPE_ABILITY, ShapeCooldowns, type WandShape } from './forge';
import { FAIRY_SLOT, startDash, stepFairy, type FairyMotion } from './fairyMath';
import { NO_STICK, type StickMove } from './phoneMath';
import { defaultSpell, wandSpell, type SpellSpec } from './weapon';

/** Pip's sparkle: a pixie pink no hero, relic or arcane spell uses. */
export const FAIRY_COLOR = 0xff8fe0;

/**
 * The phone relay with per-player slots. Pip only polls slot 2's stick here; its buttons and joins arrive through the game's
 * `listenPlayers` (players.ts) as `button()` and `seat()`. A relay without `connected` never moves Pip: it follows hero 0.
 */
export interface FairyPhone {
  read(player?: number): StickMove;
  connected?(player: number): boolean;
}

/** What Pip needs from the game: hero 0 to follow, a foe to aim at, and the game's own bolts and strikes (credited to hero 0). */
export interface FairyHost {
  now(): number;
  hero(): T.Vector3;
  /** False while the game is paused, in dialogue, in a trial or scanning: Pip holds its spells then, like the heroes. */
  canAct(): boolean;
  target(from: T.Vector3): { root: T.Object3D; boss?: unknown } | undefined;
  bolt(start: T.Vector3, direction: T.Vector3, spell: SpellSpec): void;
  strike(at: T.Vector3, spell: SpellSpec): void;
  sparkle(at: T.Vector3, color: number, size: number): void;
  toast(text: string): void;
}

/**
 * Pip, the lantern fairy: the third player, a small flying spellcaster beside the two heroes. It cannot be hurt and never
 * costs a heart. Phone slot 2 flies it (tap: a pixie-dust bolt, slash: a dash); wand slot 2's shapes cast that shape's spell
 * from where Pip is. Hidden until a third player shows up (?fairy=1, three ?wand= colours, its phone joins, or its wand draws a shape).
 * The game owns the routing: `Adventure.pip` gets `cast`, `button` and `seat` for slot 2.
 */
export class Fairy {
  readonly root = new T.Group();
  active = false;
  motion: FairyMotion = { x: 0, y: 2, z: 0, heading: Math.PI, dash: 0, dashCooldown: 0 };
  private readonly cooldowns = new ShapeCooldowns();
  private readonly wings: T.Mesh[] = [];
  private readonly glow: T.Mesh;
  private readonly light = new T.PointLight(FAIRY_COLOR, 5, 7, 2);
  private pixieReady = 0;
  private sparkleAt = 0;

  constructor(scene: T.Scene, private readonly host: FairyHost, private readonly phone?: FairyPhone) {
    const core = new T.Mesh(new T.SphereGeometry(0.11, 14, 10), new T.MeshBasicMaterial({ color: 0xfff6fb }));
    this.glow = new T.Mesh(new T.SphereGeometry(0.32, 16, 12), new T.MeshBasicMaterial({ color: FAIRY_COLOR, transparent: true, opacity: 0.42, blending: T.AdditiveBlending, depthWrite: false }));
    const wing = new T.CircleGeometry(0.26, 18); wing.scale(0.55, 1, 1); wing.translate(0, 0.24, 0);
    const wingMaterial = new T.MeshBasicMaterial({ color: 0xffd8f4, transparent: true, opacity: 0.55, side: T.DoubleSide, blending: T.AdditiveBlending, depthWrite: false });
    for (const [side, tilt] of [[1, 0.5], [-1, 0.5], [1, 1.9], [-1, 1.9]] as const) {
      const pivot = new T.Group(); pivot.rotation.z = -side * tilt;
      const blade = new T.Mesh(wing, wingMaterial); blade.userData.side = side; pivot.add(blade); this.wings.push(blade); this.root.add(pivot);
    }
    this.light.castShadow = false;
    this.root.add(core, this.glow, this.light); this.root.visible = false; scene.add(this.root);
    if (new URLSearchParams(location.search).get('fairy') === '1' || (new URLSearchParams(location.search).get('wand') ?? '').split(',').filter(Boolean).length >= 3) this.show();
  }

  /** Slot 2's phone joined (Pip comes in and takes its stick) or left (Pip flies beside hero 0 again). */
  seat(joined: boolean): void {
    if (joined) { this.show(); this.host.toast('Pip the lantern fairy joins: drag your phone to fly · tap for pixie dust · slash to dash'); }
    else this.host.toast('Pip\'s phone left: Pip flies beside you');
  }

  /** Slot 2's phone buttons: a tap is pixie dust, a slash is a dash; Scan and Roll mean nothing to a fairy. */
  button(kind: 'action' | 'scan' | 'roll' | 'slash'): void {
    if (kind === 'action') this.pixie();
    else if (kind === 'slash') this.dash();
  }

  /** Bring Pip in beside hero 0. */
  show(): void {
    if (this.active) return;
    const hero = this.host.hero(); this.motion = { ...this.motion, x: hero.x - 1.2, y: hero.y + 2, z: hero.z + 1 };
    this.active = true; this.root.visible = true; this.root.position.set(this.motion.x, this.motion.y, this.motion.z);
    this.host.sparkle(this.root.position, FAIRY_COLOR, 0.5);
  }

  /** The fairy's stick: only its own phone slot ever moves it. */
  stick(): StickMove { return this.phone?.connected?.(FAIRY_SLOT) ? this.phone.read(FAIRY_SLOT) : NO_STICK; }

  /** A wand shape for slot 2: that shape's spell from Pip's position at the nearest foe. True if it went off. */
  cast(shape: WandShape): boolean {
    this.show();
    const now = this.host.now();
    if (!this.host.canAct() || !this.cooldowns.ready(0, shape, now)) return false;
    this.fire(wandSpell(SHAPE_ABILITY[shape], undefined, FAIRY_COLOR));
    this.cooldowns.use(0, shape, now);
    return true;
  }

  /** Phone tap: a small pixie-dust bolt. */
  pixie(): boolean {
    this.show();
    const now = this.host.now();
    if (!this.host.canAct() || now < this.pixieReady) return false;
    const spell = defaultSpell(FAIRY_COLOR); this.pixieReady = now + spell.cooldown;
    this.fire(spell);
    return true;
  }

  /** Phone slash: a short burst forward. */
  dash(): void {
    this.show();
    if (!this.host.canAct()) return;
    const before = this.motion.dash; this.motion = startDash(this.motion);
    if (this.motion.dash > before) this.host.sparkle(this.root.position, FAIRY_COLOR, 0.6);
  }

  update(dt: number, time: number, groundAt: (x: number, z: number) => number): void {
    if (!this.active) return;
    const hero = this.host.hero();
    this.motion = stepFairy(this.motion, this.stick(), hero, dt, time, groundAt);
    this.root.position.set(this.motion.x, this.motion.y, this.motion.z); this.root.rotation.y = this.motion.heading;
    // Wings beat fast; the halo and lantern light flicker softly.
    const beat = Math.sin(time * 38) * 0.75;
    for (const blade of this.wings) blade.rotation.y = blade.userData.side * (0.35 + beat * 0.5);
    const flicker = 0.85 + Math.sin(time * 7.3) * 0.08 + Math.sin(time * 13.1) * 0.05;
    this.glow.scale.setScalar(flicker); this.light.intensity = 5 * flicker;
    if (time >= this.sparkleAt) { this.sparkleAt = time + (this.motion.dash > 0 ? 0.015 : 0.06); this.host.sparkle(this.root.position, FAIRY_COLOR, this.motion.dash > 0 ? 0.32 : 0.18); }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((object) => { if (object instanceof T.Mesh) { object.geometry.dispose(); (object.material as T.Material).dispose(); } });
  }

  /** Bolts fly at the nearest foe (or straight ahead); a meteor lands on it; a nova bursts on the ground below Pip. */
  private fire(spell: SpellSpec): void {
    const start = this.root.position.clone(), ground = new T.Vector3(start.x, start.y - 2, start.z);
    const target = this.host.target(ground);
    const aim = target ? target.root.position.clone().add(new T.Vector3(0, target.boss ? 1.8 : 0.9, 0)) : start.clone().add(new T.Vector3(Math.sin(this.motion.heading) * 8, -1, Math.cos(this.motion.heading) * 8));
    const direction = aim.clone().sub(start).normalize();
    this.motion = { ...this.motion, heading: Math.atan2(direction.x, direction.z) };
    if (spell.ability === 'nova') this.host.strike(new T.Vector3(start.x, start.y - 2, start.z), spell);
    else if (spell.ability === 'meteor') this.host.strike(target ? target.root.position.clone() : aim, spell);
    else for (let k = 0; k < spell.count; k++) this.host.bolt(start, direction.clone().applyAxisAngle(new T.Vector3(0, 1, 0), (k - (spell.count - 1) / 2) * spell.spread), spell);
    this.host.sparkle(start, spell.color, 0.45);
  }
}
