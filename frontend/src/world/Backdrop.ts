import { Container, Graphics, Sprite } from 'pixi.js';
import type { EnvironmentId } from '../contracts';
import { onFrame, now, tween, ease } from '../core/clock';
import { lerpColor, rand } from '../core/math';
import { textures } from '../fx/textures';
import { GROUND_Y, VIEW } from '../theme';

const W = VIEW.width;
const H = VIEW.height;

interface Mote {
  sprite: Sprite;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  phase: number;
  pulse: number;
}

interface Scene {
  root: Container;
  motes: Mote[];
  /** Per-frame flourishes (crystal pulses, flickering windows). */
  animate?: (t: number) => void;
}

/** Painted, parallax-free fairy-tale backdrops with drifting ambient particles. */
export class Backdrop extends Container {
  private scenes = new Map<EnvironmentId, Scene>();
  private current: EnvironmentId | null = null;

  constructor() {
    super();
    onFrame((dt) => this.update(dt));
  }

  get environment(): EnvironmentId | null {
    return this.current;
  }

  async show(env: EnvironmentId, seconds = 1.2): Promise<void> {
    if (env === this.current) return;
    const next = this.scene(env);
    const prev = this.current ? this.scenes.get(this.current) : undefined;
    this.current = env;
    this.addChild(next.root);
    next.root.alpha = prev ? 0 : 1;
    if (prev) {
      await tween(next.root, { alpha: 1 }, seconds, ease.inOutSine);
      this.removeChild(prev.root);
    }
  }

  private scene(env: EnvironmentId): Scene {
    let s = this.scenes.get(env);
    if (!s) {
      s = env === 'forest' ? forest() : env === 'castle' ? castle() : cave();
      this.scenes.set(env, s);
    }
    return s;
  }

  private update(dt: number): void {
    const t = now();
    for (const s of this.scenes.values()) {
      if (!s.root.parent) continue;
      s.animate?.(t);
      for (const m of s.motes) {
        m.baseX += m.vx * dt;
        m.baseY += m.vy * dt;
        if (m.baseX < -20) m.baseX = W + 20;
        if (m.baseX > W + 20) m.baseX = -20;
        if (m.baseY < -20) m.baseY = GROUND_Y;
        if (m.baseY > H + 20) m.baseY = -20;
        m.sprite.x = m.baseX + Math.sin(t * 0.8 + m.phase) * 18;
        m.sprite.y = m.baseY + Math.cos(t * 0.6 + m.phase) * 10;
        m.sprite.alpha = 0.35 + 0.65 * Math.abs(Math.sin(t * m.pulse + m.phase));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Painting helpers
// ---------------------------------------------------------------------------

function sky(g: Graphics, top: number, bottom: number, height: number = H): void {
  const bands = 48;
  for (let i = 0; i < bands; i++) {
    g.rect(0, (height * i) / bands, W, height / bands + 1).fill(lerpColor(top, bottom, i / (bands - 1)));
  }
}

function starfield(g: Graphics, count: number, maxY: number): void {
  for (let i = 0; i < count; i++) g.circle(rand(0, W), rand(0, maxY), rand(0.6, 1.8)).fill({ color: 0xffffff, alpha: rand(0.2, 0.9) });
}

/** A rolling silhouette across the full width. */
function hills(g: Graphics, baseY: number, amp: number, color: number, seed: number): void {
  const pts: number[] = [0, H];
  for (let x = 0; x <= W; x += 32) {
    const y = baseY - amp * (0.5 + 0.3 * Math.sin(x * 0.006 + seed) + 0.2 * Math.sin(x * 0.017 + seed * 2));
    pts.push(x, y);
  }
  pts.push(W, H);
  g.poly(pts).fill(color);
}

function pine(g: Graphics, x: number, baseY: number, height: number, color: number): void {
  const tiers = 4;
  const width = height * 0.42;
  g.rect(x - width * 0.06, baseY - height * 0.15, width * 0.12, height * 0.15).fill(lerpColor(color, 0x000000, 0.3));
  for (let i = 0; i < tiers; i++) {
    const tierBottom = baseY - height * 0.1 - (i * height * 0.85) / tiers;
    const tierWidth = width * (1 - i * 0.2);
    g.poly([x - tierWidth / 2, tierBottom, x + tierWidth / 2, tierBottom, x, tierBottom - height * 0.38]).fill(color);
  }
}

function glowSprite(x: number, y: number, color: number, scale: number, alpha: number): Sprite {
  const s = new Sprite(textures.glow);
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.tint = color;
  s.scale.set(scale);
  s.alpha = alpha;
  s.blendMode = 'add';
  return s;
}

function motes(root: Container, count: number, color: number, scale: number, vx: [number, number], vy: [number, number], yRange: [number, number]): Mote[] {
  const list: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const sprite = glowSprite(0, 0, color, scale * rand(0.6, 1.3), 1);
    root.addChild(sprite);
    list.push({ sprite, baseX: rand(0, W), baseY: rand(yRange[0], yRange[1]), vx: rand(vx[0], vx[1]), vy: rand(vy[0], vy[1]), phase: rand(0, 10), pulse: rand(0.6, 2.2) });
  }
  return list;
}

function groundStrip(g: Graphics, top: number, bottom: number, edge: number): void {
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    const y = GROUND_Y - 14 + ((H - GROUND_Y + 14) * i) / bands;
    g.rect(0, y, W, (H - GROUND_Y + 14) / bands + 1).fill(lerpColor(top, bottom, i / (bands - 1)));
  }
  g.rect(0, GROUND_Y - 16, W, 4).fill({ color: edge, alpha: 0.5 });
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

function forest(): Scene {
  const root = new Container();
  const g = new Graphics();
  sky(g, 0x070d24, 0x2a5a63, GROUND_Y);
  starfield(g, 140, 300);
  root.addChild(g);

  root.addChild(glowSprite(1030, 120, 0xfff1c0, 3.2, 0.45));
  root.addChild(new Graphics().circle(1030, 120, 48).fill(0xfff6dc).circle(1046, 108, 10).fill({ color: 0xe8dcb8, alpha: 0.6 }));

  const land = new Graphics();
  hills(land, 400, 120, 0x123047, 1);
  for (let x = -20; x < W + 40; x += rand(26, 44)) pine(land, x, 470 - rand(0, 40), rand(130, 210), 0x0e2638);
  hills(land, 470, 60, 0x0b1e2a, 4);
  for (let x = -40; x < W + 60; x += rand(70, 130)) pine(land, x, GROUND_Y - 6, rand(240, 340), 0x081620);
  groundStrip(land, 0x1b3d2c, 0x0a1a12, 0x6fd39a);
  // Winding path.
  land.ellipse(W / 2 + 60, GROUND_Y + 60, 520, 34).fill({ color: 0x3a5a3a, alpha: 0.35 });
  // Grass tufts.
  for (let x = 0; x < W; x += rand(8, 18)) {
    const h = rand(6, 16);
    land.moveTo(x, GROUND_Y - 12).lineTo(x + rand(-4, 4), GROUND_Y - 12 - h).stroke({ width: 2, color: 0x2f6a45, alpha: 0.8 });
  }
  root.addChild(land);

  // Glowing mushrooms along the ground.
  const shrooms = new Container();
  for (const [x, s] of [[90, 1], [620, 0.8], [760, 1.1], [1180, 0.9], [1240, 0.7]] as const) {
    shrooms.addChild(glowSprite(x, GROUND_Y + 4, 0x7affd0, 0.5 * s, 0.6));
    shrooms.addChild(
      new Graphics()
        .rect(x - 2 * s, GROUND_Y - 4, 4 * s, 14 * s).fill(0xd8f2e8)
        .ellipse(x, GROUND_Y - 4, 12 * s, 7 * s).fill(0x58e0b0),
    );
  }
  root.addChild(shrooms);

  const ms = motes(root, 34, 0xd8ff7a, 0.13, [-12, 12], [-8, 8], [180, GROUND_Y + 40]);
  return { root, motes: ms, animate: (t) => (shrooms.alpha = 0.8 + 0.2 * Math.sin(t * 1.5)) };
}

function castle(): Scene {
  const root = new Container();
  const g = new Graphics();
  sky(g, 0x150b2e, 0xd36d7e, GROUND_Y);
  starfield(g, 60, 160);
  root.addChild(g);
  root.addChild(glowSprite(640, 430, 0xffb070, 6, 0.5));
  root.addChild(new Graphics().circle(640, 440, 70).fill({ color: 0xffd7a0, alpha: 0.85 }));

  // Drifting clouds.
  const clouds = new Graphics();
  for (let i = 0; i < 7; i++) {
    const cx = rand(0, W);
    const cy = rand(80, 260);
    for (let j = 0; j < 5; j++) clouds.ellipse(cx + j * 40 - 80, cy + rand(-8, 8), rand(50, 90), rand(14, 24)).fill({ color: 0xffc2c8, alpha: 0.12 });
  }
  root.addChild(clouds);

  const land = new Graphics();
  hills(land, 470, 90, 0x3a1d48, 2);
  // Castle silhouette on the hill.
  const cx = 820;
  const base = 410;
  const stone = 0x221030;
  land.rect(cx - 170, base - 90, 340, 120).fill(stone);
  for (let x = cx - 170; x < cx + 170; x += 24) land.rect(x, base - 104, 14, 16).fill(stone);
  const towers: [number, number, number][] = [[-190, 70, 230], [-80, 50, 280], [40, 64, 340], [170, 56, 250]];
  for (const [dx, w, h] of towers) {
    const x = cx + dx;
    land.rect(x - w / 2, base - h + 30, w, h).fill(stone);
    land.poly([x - w / 2 - 10, base - h + 32, x + w / 2 + 10, base - h + 32, x, base - h - 70]).fill(0x1a0a26);
    land.moveTo(x, base - h - 70).lineTo(x, base - h - 105).stroke({ width: 3, color: stone });
    land.poly([x, base - h - 105, x + 30, base - h - 96, x, base - h - 86]).fill(0xb8344f);
  }
  land.roundRect(cx - 30, base - 30, 60, 60, 30).fill(0x12061a);
  root.addChild(land);

  const windows = new Graphics();
  for (const [dx, , h] of towers) {
    for (let k = 0; k < 3; k++) windows.roundRect(cx + dx - 6, base - h + 70 + k * 60, 12, 22, 6).fill(0xffd27a);
  }
  root.addChild(windows);

  const near = new Graphics();
  hills(near, 500, 40, 0x24112f, 7);
  groundStrip(near, 0x35283f, 0x140c1c, 0xffb4c8);
  for (let x = 0; x < W; x += rand(50, 90)) near.ellipse(x, GROUND_Y + rand(10, 160), rand(18, 34), rand(6, 10)).fill({ color: 0x4a3a56, alpha: 0.7 });
  root.addChild(near);

  const ms = motes(root, 30, 0xffa6c8, 0.1, [-25, -8], [10, 26], [-20, GROUND_Y]);
  return { root, motes: ms, animate: (t) => (windows.alpha = 0.75 + 0.25 * Math.sin(t * 7) * Math.sin(t * 3.1)) };
}

function cave(): Scene {
  const root = new Container();
  const g = new Graphics();
  sky(g, 0x04060c, 0x162740, GROUND_Y);
  root.addChild(g);

  const rock = new Graphics();
  hills(rock, 360, 160, 0x0c1424, 3);
  hills(rock, 460, 90, 0x111d32, 5);
  // Stalactites.
  for (let x = -10; x < W + 20; x += rand(30, 70)) {
    const len = rand(50, 180);
    const w = rand(20, 46);
    rock.poly([x, -2, x + w, -2, x + w / 2 + rand(-6, 6), len]).fill(0x0a111e);
  }
  rock.rect(0, 0, W, 24).fill(0x0a111e);
  groundStrip(rock, 0x1a2638, 0x070b14, 0x7fe7ff);
  for (let x = 0; x < W; x += rand(40, 80)) rock.poly([x, GROUND_Y - 6, x + rand(10, 20), GROUND_Y - rand(14, 28), x + rand(26, 40), GROUND_Y - 6]).fill(0x223049);
  root.addChild(rock);

  const crystals = new Container();
  const clusters: [number, number, number, number][] = [[80, GROUND_Y - 10, 1.2, 0x6ef2ff], [560, GROUND_Y - 6, 0.7, 0xb57bff], [720, 455, 0.8, 0x6ef2ff], [1150, GROUND_Y - 8, 1.4, 0xb57bff], [960, 470, 0.6, 0x6ef2ff]];
  for (const [x, y, s, color] of clusters) {
    crystals.addChild(glowSprite(x, y - 30 * s, color, 1.6 * s, 0.5));
    const c = new Graphics();
    for (let i = -2; i <= 2; i++) {
      const h = (70 - Math.abs(i) * 18) * s;
      const w = 12 * s;
      const lean = i * 0.25;
      const bx = x + i * 14 * s;
      const tipX = bx + lean * h;
      c.poly([bx - w / 2, y, bx + w / 2, y, tipX + w / 2, y - h + w, tipX, y - h, tipX - w / 2, y - h + w]).fill({ color, alpha: 0.85 });
      c.poly([bx, y, tipX, y - h, tipX - w / 2, y - h + w, bx - w / 2, y]).fill({ color: 0xffffff, alpha: 0.25 });
    }
    crystals.addChild(c);
  }
  root.addChild(crystals);

  const ms = motes(root, 40, 0x7fd8ff, 0.09, [-6, 6], [-22, -8], [120, H]);
  return { root, motes: ms, animate: (t) => (crystals.alpha = 0.78 + 0.22 * Math.sin(t * 1.1)) };
}
