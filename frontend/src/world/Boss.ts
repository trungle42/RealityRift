import { Container, Graphics, Sprite } from 'pixi.js';
import type { BossKind } from '../contracts';
import { onFrame, now, tween, wait, ease } from '../core/clock';
import { approach, rand } from '../core/math';
import type { Effects } from '../fx/Effects';
import { textures } from '../fx/textures';
import { palette } from '../theme';

const THEME: Record<BossKind, { aura: number; eyes: number; magic: number }> = {
  'frost-witch': { aura: 0x5fd4ff, eyes: 0xbff6ff, magic: palette.frost },
  'shadow-dragon': { aura: 0x8a3cff, eyes: 0xff4fd8, magic: 0xb06bff },
};

/** The big foe. Two looks share one behaviour surface: charge, stagger, hit, defeat. */
export class Boss extends Container {
  readonly magicColor: number;
  private readonly rig = new Container();
  private readonly aura: Sprite;
  private readonly focus: Sprite;
  private readonly wingL = new Graphics();
  private readonly wingR = new Graphics();
  private charge = 0;
  private chargeTarget = 0;
  private staggered = false;
  private alive = true;
  private readonly stopUpdates: () => void;

  constructor(readonly kind: BossKind) {
    super();
    const theme = THEME[kind];
    this.magicColor = theme.magic;

    this.aura = new Sprite(textures.glow);
    this.aura.anchor.set(0.5);
    this.aura.position.set(0, -170);
    this.aura.scale.set(4.2);
    this.aura.tint = theme.aura;
    this.aura.blendMode = 'add';
    this.aura.alpha = 0.35;

    this.focus = new Sprite(textures.glow);
    this.focus.anchor.set(0.5);
    this.focus.tint = theme.magic;
    this.focus.blendMode = 'add';

    this.addChild(new Graphics().ellipse(0, 4, 110, 18).fill({ color: 0x000000, alpha: 0.45 }), this.aura, this.rig);
    if (kind === 'frost-witch') this.buildWitch(theme.eyes);
    else this.buildDragon(theme.eyes);
    this.rig.addChild(this.focus);

    this.stopUpdates = onFrame((dt) => this.update(dt));
  }

  override destroy(): void {
    this.stopUpdates();
    super.destroy({ children: true });
  }

  /** Where attacks are launched from, in the parent's space. */
  attackOrigin(): { x: number; y: number } {
    return this.parent ? this.parent.toLocal(this.focus.getGlobalPosition()) : { x: this.x, y: this.y - 200 };
  }

  /** Where spells should land, in the parent's space. */
  hitPoint(): { x: number; y: number } {
    return { x: this.x - 10 + rand(-30, 30), y: this.y - 170 + rand(-40, 40) };
  }

  async enter(): Promise<void> {
    const homeX = this.x;
    this.x = homeX + 420;
    this.alpha = 0;
    void tween(this, { alpha: 1 }, 0.8);
    await tween(this, { x: homeX }, 1.6, ease.outCubic);
  }

  setCharging(on: boolean): void {
    this.chargeTarget = on ? 1 : 0;
  }

  setStaggered(on: boolean): void {
    this.staggered = on;
  }

  hit(fx: Effects): void {
    this.rig.tint = 0xffaaaa;
    void wait(0.1).then(() => {
      if (!this.destroyed) this.rig.tint = 0xffffff;
    });
    this.rig.x = 14;
    void tween(this.rig, { x: 0 }, 0.3, ease.outBack);
    fx.shake(5, 0.15);
  }

  async defeat(fx: Effects): Promise<void> {
    this.alive = false;
    for (let i = 0; i < 6; i++) {
      const p = this.hitPoint();
      fx.burst(p.x + rand(-60, 60), p.y + rand(-80, 80), this.magicColor, { count: 26, speed: 300, size: 0.35 });
      fx.shake(8, 0.2);
      await wait(0.18);
    }
    fx.flash(0xffffff, 0.8, 0.8);
    fx.burst(this.x, this.y - 170, 0xffffff, { count: 60, speed: 520, size: 0.4, texture: textures.sparkle, gravity: 0 });
    await tween(this, { alpha: 0 }, 0.6);
  }

  private update(dt: number): void {
    if (!this.alive) return;
    const t = now();
    this.charge = approach(this.charge, this.chargeTarget, 6, dt);
    this.rig.y = Math.sin(t * 1.6) * 10 + (this.staggered ? 18 : 0);
    this.rig.rotation = approach(this.rig.rotation, this.staggered ? 0.08 : 0, 6, dt);
    this.aura.alpha = 0.3 + this.charge * 0.45 + Math.sin(t * 2) * 0.05;
    this.aura.scale.set(4.2 + this.charge * 1.2);
    this.focus.scale.set(0.5 + this.charge * 1.1 + Math.sin(t * 12) * 0.05 * this.charge);
    this.focus.alpha = 0.6 + this.charge * 0.4;
    if (this.kind === 'shadow-dragon') {
      const flap = Math.sin(t * (2.5 + this.charge * 4)) * 0.25;
      this.wingL.rotation = -0.2 + flap;
      this.wingR.rotation = 0.2 - flap;
    }
  }

  private buildWitch(eyes: number): void {
    const g = new Graphics();
    // Floating robe.
    g.poly([-90, -20, 80, -20, 46, -230, -46, -230]).fill(0x16244a);
    g.poly([-90, -20, 80, -20, 70, -40, -80, -40]).fill(0x9fe6ff);
    for (let i = 0; i < 7; i++) g.poly([-90 + i * 25, -20, -78 + i * 25, -20, -84 + i * 25, 6]).fill(0x9fe6ff);
    g.poly([-46, -230, 46, -230, 30, -160, -30, -160]).fill(0x223a6e);
    // Sleeves.
    g.poly([-46, -220, -100, -130, -78, -120, -36, -190]).fill(0x1c2f5c);
    g.poly([40, -220, 104, -150, 88, -136, 34, -186]).fill(0x1c2f5c);
    // Face.
    g.ellipse(0, -262, 30, 36).fill(0xd8ecf5);
    g.poly([-30, -262, -38, -200, -20, -230]).fill(0xeaf6ff).poly([30, -262, 40, -196, 20, -230]).fill(0xeaf6ff);
    g.poly([-6, -258, 0, -244, 6, -258]).fill(0xb5ccd8);
    g.moveTo(-12, -238).quadraticCurveTo(0, -232, 12, -238).stroke({ width: 2, color: 0x4a6a80 });
    // Crooked hat.
    g.ellipse(0, -292, 64, 12).fill(0x0e1a38);
    g.poly([-36, -296, 36, -296, 20, -360, 60, -420, -6, -372, -24, -330]).fill(0x0e1a38);
    g.rect(-36, -304, 72, 8).fill(0x9fe6ff);
    // Staff with an ice crystal.
    g.roundRect(-128, -330, 8, 320, 4).fill(0x6a8aa8);
    g.poly([-124, -400, -104, -356, -124, -326, -144, -356]).fill(0xdff9ff);
    this.rig.addChild(g);
    this.addEyes(eyes, [[-11, -266], [11, -266]], 0.17);
    this.focus.position.set(-124, -362);
  }

  private buildDragon(eyes: number): void {
    const body = 0x24103a;
    const belly = 0x4a2470;
    for (const [wing, side] of [[this.wingL, -1], [this.wingR, 1]] as const) {
      wing.poly([0, 0, side * 200, -120, side * 170, -40, side * 210, 10, side * 140, 20, side * 150, 70, side * 60, 40]).fill({ color: 0x3a1858, alpha: 0.95 });
      wing.moveTo(0, 0).lineTo(side * 200, -120).moveTo(0, 0).lineTo(side * 210, 10).moveTo(0, 0).lineTo(side * 150, 70).stroke({ width: 4, color: 0x150822 });
      wing.position.set(side * 20, -190);
      this.rig.addChild(wing);
    }
    const g = new Graphics();
    // Tail.
    g.moveTo(60, -60).bezierCurveTo(160, -40, 200, -110, 150, -150).stroke({ width: 22, color: body, cap: 'round' });
    g.poly([150, -150, 130, -190, 175, -165]).fill(belly);
    // Body.
    g.ellipse(10, -110, 90, 70).fill(body);
    g.ellipse(-10, -100, 50, 50).fill(belly);
    // Legs.
    g.roundRect(-60, -70, 34, 72, 14).fill(body).roundRect(40, -70, 34, 72, 14).fill(body);
    // Neck and head.
    g.moveTo(-30, -160).bezierCurveTo(-60, -230, -120, -250, -130, -290).stroke({ width: 44, color: body, cap: 'round' });
    g.ellipse(-150, -300, 54, 34).fill(body);
    g.poly([-190, -300, -240, -290, -236, -270, -188, -278]).fill(body);
    g.poly([-130, -326, -110, -380, -100, -322]).fill(0xc9b28a).poly([-160, -328, -152, -376, -136, -326]).fill(0xc9b28a);
    // Spines.
    for (let i = 0; i < 6; i++) g.poly([-40 + i * 22, -176 + i * 4, -30 + i * 22, -200 + i * 4, -20 + i * 22, -174 + i * 4]).fill(belly);
    this.rig.addChild(g);
    this.addEyes(eyes, [[-160, -308]], 0.2);
    this.focus.position.set(-236, -282);
  }

  private addEyes(color: number, at: [number, number][], scale: number): void {
    for (const [x, y] of at) {
      const eye = new Sprite(textures.glow);
      eye.anchor.set(0.5);
      eye.position.set(x, y);
      eye.scale.set(scale);
      eye.tint = color;
      eye.blendMode = 'add';
      const core = new Sprite(textures.dot);
      core.anchor.set(0.5);
      core.scale.set(0.8);
      eye.addChild(core);
      this.rig.addChild(eye);
    }
  }
}
