import { Container, Graphics, Sprite } from 'pixi.js';
import type { EnemyKind } from '../contracts';
import { now } from '../core/clock';
import { rand } from '../core/math';
import type { Effects } from '../fx/Effects';
import { textures } from '../fx/textures';

const EYE_COLORS: Record<EnemyKind, number> = { 'shadow-wisp': 0xc77dff, 'thorn-imp': 0xffd23f };

/** A small foe that drifts toward the heroes. Movement is driven by the encounter. */
export class Enemy extends Container {
  alive = true;
  private readonly shape = new Graphics();
  private readonly phase = rand(0, 10);

  constructor(readonly kind: EnemyKind) {
    super();
    const aura = new Sprite(textures.glow);
    aura.anchor.set(0.5);
    aura.position.set(0, -40);
    aura.scale.set(0.9);
    aura.tint = kind === 'shadow-wisp' ? 0x6a1fb0 : 0x5a8a2a;
    aura.alpha = 0.5;
    aura.blendMode = 'add';
    this.addChild(new Graphics().ellipse(0, 0, 26, 7).fill({ color: 0x000000, alpha: 0.4 }), aura, this.shape);
    for (const dx of [-9, 9]) {
      const eye = new Sprite(textures.glow);
      eye.anchor.set(0.5);
      eye.position.set(dx, kind === 'shadow-wisp' ? -52 : -38);
      eye.scale.set(0.16);
      eye.tint = EYE_COLORS[kind];
      eye.blendMode = 'add';
      const pupil = new Sprite(textures.dot);
      pupil.anchor.set(0.5);
      pupil.scale.set(0.9);
      eye.addChild(pupil);
      this.addChild(eye);
    }
    if (kind === 'thorn-imp') this.drawImp();
  }

  /** Called every frame by the encounter for idle motion. */
  animate(): void {
    const t = now() + this.phase;
    if (this.kind === 'shadow-wisp') {
      this.drawWisp(t);
      this.shape.y = Math.sin(t * 3) * 5;
    } else {
      this.shape.y = -Math.abs(Math.sin(t * 6)) * 12;
    }
  }

  dissolve(fx: Effects): void {
    this.alive = false;
    const color = EYE_COLORS[this.kind];
    fx.burst(this.x, this.y - 40, this.kind === 'shadow-wisp' ? 0x7a2fd0 : 0x7fbf3f, { count: 30, speed: 240, size: 0.3, gravity: -60 });
    fx.burst(this.x, this.y - 40, color, { count: 10, speed: 140, size: 0.2, texture: textures.sparkle });
    this.destroy({ children: true });
  }

  private drawWisp(t: number): void {
    const g = this.shape.clear();
    const pts: number[] = [];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI + (i / steps) * Math.PI;
      const r = 30 + Math.sin(t * 4 + i) * 2;
      pts.push(Math.cos(a) * r, -50 + Math.sin(a) * r * 1.1);
    }
    // Ragged tendril hem.
    for (let i = 0; i <= 6; i++) {
      const x = 30 - i * 10;
      const y = -18 + (i % 2 === 0 ? 14 + Math.sin(t * 6 + i) * 6 : 0);
      pts.push(x, y);
    }
    g.poly(pts).fill({ color: 0x1a0828, alpha: 0.95 });
    g.ellipse(-8, -66, 10, 6).fill({ color: 0x5b2a86, alpha: 0.5 });
  }

  private drawImp(): void {
    const g = this.shape;
    g.ellipse(0, -30, 24, 26).fill(0x3d5a1e);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + 0.3 + (i / 6) * (Math.PI - 0.6);
      const x = Math.cos(a) * 24;
      const y = -30 + Math.sin(a) * 26;
      g.poly([x - 5, y + 2, x + 5, y + 2, x + Math.cos(a) * 14, y + Math.sin(a) * 14]).fill(0x6b8f2a);
    }
    g.rect(-14, -6, 8, 8).fill(0x2a3f12).rect(6, -6, 8, 8).fill(0x2a3f12);
    g.moveTo(-8, -26).lineTo(-3, -22).lineTo(2, -26).lineTo(7, -22).stroke({ width: 2, color: 0xf2e6c0 });
  }
}
