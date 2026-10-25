import { Container, Graphics, Sprite } from 'pixi.js';
import type { BossKind } from '../contracts';
import { onFrame, now, tween, wait, ease } from '../core/clock';
import { approach, rand } from '../core/math';
import type { Effects } from '../fx/Effects';
import { textures } from '../fx/textures';
import { art } from './art';

/** Rendered bosses with a rotating magical ward and readable charge / stagger states. */
export class Boss extends Container {
  readonly magicColor: number;
  private readonly rig = new Container();
  private readonly creature: Sprite;
  private readonly aura = new Sprite(textures.glow);
  private readonly focus = new Sprite(textures.glow);
  private readonly ward = new Graphics();
  private charge = 0;
  private chargeTarget = 0;
  private staggered = false;
  private alive = true;
  private readonly stopUpdates: () => void;

  constructor(readonly kind: BossKind) {
    super();
    const witch = kind === 'frost-witch';
    this.magicColor = witch ? 0x9fe6ff : 0xb68ce8;
    this.aura.anchor.set(0.5);
    this.aura.position.set(0, -170);
    this.aura.scale.set(4.2);
    this.aura.tint = this.magicColor;
    this.aura.blendMode = 'add';
    this.aura.alpha = 0.25;
    const shadow = new Sprite(textures.glow);
    shadow.anchor.set(0.5);
    shadow.tint = 0x000000;
    shadow.scale.set(witch ? 2 : 3.2, 0.24);
    shadow.alpha = 0.8;

    this.ward.circle(0, 0, 170).circle(0, 0, 158).stroke({ width: 1, color: this.magicColor, alpha: 0.45 });
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const x = Math.cos(a) * 164, y = Math.sin(a) * 164;
      this.ward.poly([x, y - 5, x + 3, y, x, y + 5, x - 3, y]).fill({ color: this.magicColor, alpha: 0.8 });
    }
    this.ward.position.set(0, -180);
    this.ward.blendMode = 'add';
    this.creature = new Sprite(art(witch ? 'witch' : 'dragon'));
    this.creature.anchor.set(0.5, 1);
    this.creature.scale.set((witch ? 350 : 335) / this.creature.texture.height);
    if (witch) this.creature.scale.x *= -1;
    this.focus.anchor.set(0.5);
    this.focus.tint = this.magicColor;
    this.focus.blendMode = 'add';
    this.focus.position.set(witch ? 85 : -205, witch ? -314 : -220);
    this.rig.addChild(this.creature, this.focus);
    this.addChild(shadow, this.aura, this.ward, this.rig);
    this.stopUpdates = onFrame((dt) => this.update(dt));
  }
  override destroy(): void { this.stopUpdates(); super.destroy({ children: true }); }
  attackOrigin(): { x: number; y: number } {
    return this.parent ? this.parent.toLocal(this.focus.getGlobalPosition()) : { x: this.x, y: this.y - 200 };
  }
  hitPoint(): { x: number; y: number } { return { x: this.x - 10 + rand(-30, 30), y: this.y - 170 + rand(-40, 40) }; }
  async enter(): Promise<void> {
    const homeX = this.x;
    this.x += 200;
    this.alpha = 0;
    void tween(this, { alpha: 1 }, 1);
    await tween(this, { x: homeX }, 1.6, ease.outCubic);
  }
  setCharging(on: boolean): void { this.chargeTarget = on ? 1 : 0; }
  setStaggered(on: boolean): void { this.staggered = on; }
  hit(fx: Effects): void {
    if (this.destroyed) return;
    this.creature.tint = 0xffb5a5;
    void wait(0.1).then(() => { if (!this.destroyed) this.creature.tint = 0xffffff; });
    this.rig.x = 10;
    void tween(this.rig, { x: 0 }, 0.3, ease.outCubic);
    fx.shake(4, 0.15);
  }
  async defeat(fx: Effects): Promise<void> {
    this.alive = false;
    for (let i = 0; i < 6; i++) {
      const p = this.hitPoint();
      fx.burst(p.x + rand(-60, 60), p.y + rand(-80, 80), this.magicColor, { count: 26, speed: 300, size: 0.35 });
      fx.shake(8, 0.2);
      await wait(0.18);
    }
    fx.flash(0xffffff, 0.6, 0.8);
    fx.burst(this.x, this.y - 170, 0xffffff, { count: 60, speed: 520, size: 0.4, texture: textures.sparkle, gravity: 0 });
    await tween(this, { alpha: 0 }, 0.6);
  }
  private update(dt: number): void {
    if (!this.alive) return;
    const t = now();
    this.charge = approach(this.charge, this.chargeTarget, 6, dt);
    this.rig.y = (this.kind === 'frost-witch' ? Math.sin(t * 1.3) * 4 : 0) + (this.staggered ? 8 : 0);
    this.rig.rotation = approach(this.rig.rotation, this.staggered ? 0.045 : 0, 6, dt);
    this.creature.scale.y = Math.abs(this.creature.scale.x) * (1 + Math.sin(t * 1.4) * 0.005);
    this.aura.alpha = 0.2 + this.charge * 0.25;
    this.ward.alpha = approach(this.ward.alpha, this.staggered ? 0 : 0.55 + this.charge * 0.4, 5, dt);
    this.ward.rotation += dt * (0.04 + this.charge * 0.13);
    this.focus.scale.set(0.24 + this.charge * 0.7);
  }
}
