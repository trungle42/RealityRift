import { Container, Graphics, Sprite } from 'pixi.js';
import type { EnvironmentId } from '../contracts';
import { onFrame, now, tween, ease } from '../core/clock';
import { rand } from '../core/math';
import { textures } from '../fx/textures';
import { GROUND_Y, VIEW } from '../theme';
import { art } from './art';

const { width: W, height: H } = VIEW;
const THEMES = {
  forest: { floor: 0.77, glow: 0xc8f3a6, mist: 0x96d7bb, rays: 0xffefc5 },
  castle: { floor: 0.70, glow: 0xffd29e, mist: 0xc2a7d1, rays: 0xffd4a5 },
  cave: { floor: 0.69, glow: 0x7de6ee, mist: 0x498fb0, rays: 0x8edfee },
};
interface Scene { root: Container; animate: (dt: number, t: number) => void }

/** Painted perspective environments, grounded at the same actor baseline. */
export class Backdrop extends Container {
  private readonly scenes = new Map<EnvironmentId, Scene>();
  private current: EnvironmentId | null = null;
  constructor() {
    super();
    onFrame((dt) => {
      for (const s of this.scenes.values()) if (s.root.parent) s.animate(dt, now());
    });
  }
  get environment(): EnvironmentId | null { return this.current; }
  async show(env: EnvironmentId, seconds = 1.2): Promise<void> {
    if (env === this.current) return;
    let next = this.scenes.get(env);
    if (!next) { next = createScene(env); this.scenes.set(env, next); }
    const prev = this.current ? this.scenes.get(this.current) : undefined;
    this.current = env;
    this.addChild(next.root);
    next.root.alpha = prev ? 0 : 1;
    if (prev) {
      await tween(next.root, { alpha: 1 }, seconds, ease.inOutSine);
      this.removeChild(prev.root);
    }
  }
}

function glow(x: number, y: number, color: number, sx: number, sy = sx): Sprite {
  const sprite = new Sprite(textures.glow);
  sprite.anchor.set(0.5);
  sprite.position.set(x, y);
  sprite.scale.set(sx, sy);
  sprite.tint = color;
  sprite.blendMode = 'add';
  return sprite;
}

function createScene(env: EnvironmentId): Scene {
  const root = new Container();
  const theme = THEMES[env];
  const painting = new Sprite(art(env));
  const height = Math.max(H, GROUND_Y / theme.floor, (H - GROUND_Y) / (1 - theme.floor));
  painting.height = height;
  painting.width = height * W / H;
  painting.position.set((W - painting.width) / 2, GROUND_Y - height * theme.floor);
  root.addChild(painting);
  const rays = new Graphics();
  rays.blendMode = 'add';
  for (let i = 0; i < 5; i++) {
    const x = 740 + i * 100;
    rays.poly([x, 0, x + 16, 0, x - 240, 530, x - 360, 530]).fill({ color: theme.rays, alpha: 0.025 });
  }
  root.addChild(rays);
  const mist = [0, 1, 2].map((i) => {
    const s = glow(180 + i * 450, 477 + i * 14, theme.mist, 5.5, 0.5);
    s.alpha = 0.07;
    root.addChild(s);
    return s;
  });
  const particles = Array.from({ length: 44 }, (_, i) => {
    const near = i % 4 === 0;
    const s = glow(rand(0, W), rand(90, H), theme.glow, near ? 0.09 : 0.035);
    const p = { s, x: s.x, y: s.y, phase: rand(0, 7), vx: near ? rand(-16, -8) : rand(-5, 5), vy: rand(-8, -3), near };
    root.addChild(s);
    return p;
  });
  const vignette = new Graphics();
  for (let i = 0; i < 30; i++) {
    const alpha = 0.025 * (1 - i / 30);
    vignette.rect(0, i * 4, W, 4).fill({ color: 0x04100e, alpha: alpha * 14 });
    vignette.rect(0, H - i * 4, W, 4).fill({ color: 0x04100e, alpha: alpha * 22 });
  }
  root.addChild(vignette);
  return { root, animate: (dt, t) => {
    rays.alpha = 0.72 + Math.sin(t * 0.3) * 0.22;
    mist.forEach((s, i) => { s.x = 180 + i * 450 + Math.sin(t * 0.12 + i * 2) * 85; });
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -20) p.x = W + 20;
      if (p.y < 50) p.y = H;
      p.s.position.set(p.x + Math.sin(t * 0.5 + p.phase) * 20, p.y);
      p.s.alpha = (p.near ? 0.6 : 0.35) * (0.6 + 0.4 * Math.sin(t + p.phase));
    }
  } };
}
