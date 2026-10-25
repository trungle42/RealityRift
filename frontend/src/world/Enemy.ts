import { Container, Sprite } from 'pixi.js';
import type { EnemyKind } from '../contracts';
import { now } from '../core/clock';
import { rand } from '../core/math';
import type { Effects } from '../fx/Effects';
import { textures } from '../fx/textures';
import { art } from './art';

export class Enemy extends Container {
  alive = true;
  private readonly shape: Sprite;
  private readonly phase = rand(0, 10);
  constructor(readonly kind: EnemyKind) {
    super();
    const wisp = kind === 'shadow-wisp';
    const shadow = new Sprite(textures.glow);
    shadow.anchor.set(0.5);
    shadow.tint = 0x000000;
    shadow.scale.set(0.8, 0.13);
    shadow.alpha = 0.65;
    this.shape = new Sprite(art(wisp ? 'wisp' : 'imp'));
    this.shape.anchor.set(0.5, 1);
    this.shape.scale.set((wisp ? 142 : 120) / this.shape.texture.height);
    this.addChild(shadow, this.shape);
  }
  animate(): void {
    const t = now() + this.phase;
    this.shape.y = this.kind === 'shadow-wisp' ? -12 + Math.sin(t * 2) * 8 : -Math.abs(Math.sin(t * 5)) * 5;
    this.shape.rotation = Math.sin(t * 2) * 0.025;
  }
  dissolve(fx: Effects): void {
    if (!this.alive) return;
    this.alive = false;
    const color = this.kind === 'shadow-wisp' ? 0xb999e2 : 0xd1bf86;
    fx.burst(this.x, this.y - 60, color, { count: 25, speed: 220, size: 0.25, gravity: -60 });
    fx.burst(this.x, this.y - 60, 0xe5f4e0, { count: 10, speed: 140, size: 0.16, texture: textures.sparkle });
    this.destroy({ children: true });
  }
}
