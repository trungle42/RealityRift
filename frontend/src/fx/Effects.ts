import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { onFrame, tween, ease } from '../core/clock';
import { rand } from '../core/math';
import { VIEW, fonts, makeText } from '../theme';
import { textures } from './textures';

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  spin: number;
  startScale: number;
}

export interface BurstOptions {
  count?: number;
  speed?: number;
  life?: number;
  size?: number;
  gravity?: number;
  texture?: Texture;
}

/** Particles, spell bolts, screen shake, flashes and the frost vignette. */
export class Effects {
  /** Additive particle layer that sits above the actors. */
  readonly layer = new Container();
  /** Screen-space overlays (flash, frost) that sit above everything in the world. */
  readonly overlay = new Container();

  private particles: Particle[] = [];
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeIntensity = 0;
  private readonly flashRect = new Graphics();
  private readonly frost = new Container();

  constructor(private readonly world: Container) {
    this.flashRect.rect(0, 0, VIEW.width, VIEW.height).fill(0xffffff);
    this.flashRect.alpha = 0;
    this.buildFrost();
    this.overlay.addChild(this.frost, this.flashRect);
    onFrame((dt) => this.update(dt));
  }

  burst(x: number, y: number, color: number, opts: BurstOptions = {}): void {
    const { count = 24, speed = 220, life = 0.8, size = 0.22, gravity = 120, texture = textures.glow } = opts;
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const v = rand(speed * 0.3, speed);
      this.spawn(texture, x, y, color, Math.cos(angle) * v, Math.sin(angle) * v, rand(life * 0.6, life), size * rand(0.6, 1.3), gravity);
    }
  }

  spawn(texture: Texture, x: number, y: number, color: number, vx: number, vy: number, life: number, scale: number, gravity = 0, drag = 1.6): void {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.tint = color;
    sprite.blendMode = 'add';
    sprite.scale.set(scale);
    this.layer.addChild(sprite);
    this.particles.push({ sprite, vx, vy, life, maxLife: life, gravity, drag, spin: rand(-4, 4), startScale: scale });
  }

  /** Expanding magic ring. */
  ring(x: number, y: number, color: number, radius = 90): void {
    const g = new Graphics().circle(0, 0, 40).stroke({ width: 6, color });
    g.position.set(x, y);
    g.blendMode = 'add';
    g.scale.set(0.2);
    this.layer.addChild(g);
    const k = radius / 40;
    void tween(g.scale, { x: k, y: k }, 0.45);
    void tween(g, { alpha: 0 }, 0.45, ease.inCubic).then(() => g.destroy());
  }

  /** A glowing orb that arcs from one point to another, leaving a trail. Resolves on impact. */
  bolt(fromX: number, fromY: number, toX: number, toY: number, color: number, seconds = 0.38): Promise<void> {
    const orb = new Sprite(textures.glow);
    orb.anchor.set(0.5);
    orb.tint = color;
    orb.blendMode = 'add';
    orb.scale.set(0.55);
    const core = new Sprite(textures.dot);
    core.anchor.set(0.5);
    core.scale.set(0.9);
    orb.addChild(core);
    this.layer.addChild(orb);

    const lift = rand(60, 140);
    const midX = (fromX + toX) / 2;
    const midY = Math.min(fromY, toY) - lift;
    return new Promise((resolve) => {
      let t = 0;
      const off = onFrame((dt) => {
        t = Math.min(t + dt / seconds, 1);
        const u = 1 - t;
        const x = u * u * fromX + 2 * u * t * midX + t * t * toX;
        const y = u * u * fromY + 2 * u * t * midY + t * t * toY;
        orb.position.set(x, y);
        orb.rotation += dt * 10;
        this.spawn(textures.glow, x, y, color, rand(-30, 30), rand(-30, 30), 0.35, 0.18);
        if (t >= 1) {
          off();
          orb.destroy({ children: true });
          this.burst(toX, toY, color, { count: 20, speed: 260, size: 0.2 });
          this.burst(toX, toY, 0xffffff, { count: 8, speed: 160, size: 0.35, texture: textures.sparkle });
          this.ring(toX, toY, color, 70);
          resolve();
        }
      });
    });
  }

  floatText(text: string, x: number, y: number, color: number, size = 30): void {
    const t = makeText(text, {
      fontFamily: fonts.heading,
      fontWeight: '700',
      fontSize: size,
      fill: color,
      stroke: { color: 0x120818, width: 5 },
    });
    t.position.set(x, y);
    t.scale.set(0.4);
    this.layer.addChild(t);
    void tween(t.scale, { x: 1, y: 1 }, 0.35, ease.outBack);
    void tween(t, { y: y - 70 }, 1.3, ease.outCubic);
    void tween(t, { alpha: 0 }, 1.3, ease.inCubic).then(() => t.destroy());
  }

  flash(color = 0xffffff, alpha = 0.6, seconds = 0.35): void {
    this.flashRect.tint = color;
    this.flashRect.alpha = alpha;
    void tween(this.flashRect, { alpha: 0 }, seconds, ease.outCubic);
  }

  shake(intensity = 10, seconds = 0.35): void {
    this.shakeIntensity = Math.max(this.shakeIntensity * (1 - this.shakeTime / Math.max(this.shakeDuration, 0.001)), intensity);
    this.shakeDuration = seconds;
    this.shakeTime = 0;
  }

  /** 0 = clear, 1 = screen edges iced over. */
  setFrost(amount: number, seconds = 0.6): Promise<void> {
    return tween(this.frost, { alpha: amount }, seconds, ease.inOutSine);
  }

  private buildFrost(): void {
    const g = new Graphics();
    const { width: w, height: h } = VIEW;
    for (let i = 0; i < 14; i++) {
      const inset = i * 9;
      g.rect(inset, inset, w - inset * 2, h - inset * 2).stroke({ width: 10, color: 0xbff4ff, alpha: 0.11 - i * 0.007 });
    }
    // Ice shards growing in from the edges.
    for (let i = 0; i < 46; i++) {
      const side = i % 4;
      const along = rand(0, side % 2 === 0 ? w : h);
      const len = rand(40, 130);
      const half = rand(6, 16);
      const pts =
        side === 0 ? [along - half, 0, along + half, 0, along + rand(-20, 20), len]
        : side === 1 ? [w, along - half, w, along + half, w - len, along + rand(-20, 20)]
        : side === 2 ? [along - half, h, along + half, h, along + rand(-20, 20), h - len]
        : [0, along - half, 0, along + half, len, along + rand(-20, 20)];
      g.poly(pts).fill({ color: 0xdff9ff, alpha: rand(0.25, 0.55) });
    }
    this.frost.addChild(g);
    this.frost.alpha = 0;
  }

  private update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + p.gravity * dt;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.rotation += p.spin * dt;
      const k = p.life / p.maxLife;
      p.sprite.alpha = Math.min(1, k * 1.6);
      p.sprite.scale.set(p.startScale * (0.4 + 0.6 * k));
    }

    if (this.shakeTime < this.shakeDuration) {
      this.shakeTime += dt;
      const k = Math.max(0, 1 - this.shakeTime / this.shakeDuration) * this.shakeIntensity;
      this.world.position.set(rand(-k, k), rand(-k, k));
    } else {
      this.world.position.set(0, 0);
    }
  }
}
