import type { EnvironmentId, StoryBeat } from '../contracts';
import { questFor } from '../campaign/locations';

export interface Position { x: number; z: number }
export interface Solid extends Position { radius: number; y?: number }
export const CENTERS: Record<EnvironmentId, Position> = {
  forest: { x: 0, z: 2 }, castle: { x: -40, z: -44 }, cave: { x: 40, z: -44 },
};
export const PATHS: Position[][] = [
  [{ x: 0, z: 48 }, { x: 0, z: 20 }, { x: 0, z: -14 }],
  [{ x: 0, z: -14 }, { x: -22, z: -25 }, { x: -40, z: -37 }, { x: -40, z: -57 }],
  [{ x: 0, z: -14 }, { x: 22, z: -25 }, { x: 40, z: -37 }, { x: 40, z: -57 }],
];

export function segmentDistance(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
}

export function pathDistance(x: number, z: number): number {
  return Math.min(...PATHS.flatMap((path) => path.slice(1).map((p, i) => segmentDistance({ x, z }, path[i], p))));
}

/** Shared by rendered terrain, locomotion, scenery placement and collision. */
export function heightAt(x: number, z: number): number {
  const ground = 0.55 + Math.sin(x * 0.065) * 1.05 + Math.sin(z * 0.08) * 0.8 + Math.cos((x + z) * 0.13) * 0.3;
  const flat = Math.max(0, 1 - pathDistance(x, z) / 5);
  let height = ground * (1 - flat * 0.8);
  const lake = Math.hypot(x - 30, z - 24);
  if (lake < 20) height = height * Math.min(1, Math.max(0, (lake - 14) / 6)) - Math.max(0, 1 - lake / 20) * 4;
  // Gentle terraces beneath the castle and the open crystal grotto.
  if (z < -31 && Math.abs(x) > 25 && Math.abs(x) < 56) height *= 0.18;
  return height;
}

export function moveOnGround(p: Position, dx: number, dz: number, solids: readonly Solid[]): Position {
  let x = p.x, z = p.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
  const valid = (nx: number, nz: number) => Math.abs(nx) < 67 && nz > -69 && nz < 58
    && solids.every((s) => Math.hypot(s.x - nx, s.z - nz) >= s.radius + 0.42);
  for (let i = 0; i < steps; i++) {
    if (valid(x + dx / steps, z)) x += dx / steps;
    if (valid(x, z + dz / steps)) z += dz / steps;
  }
  return { x, z };
}

export function regionAt(x: number, z: number): EnvironmentId {
  return z < -25 ? x < 0 ? 'castle' : 'cave' : 'forest';
}

/** Shorten the follow camera before it crosses a solid trunk or building. */
export function cameraReach(from: Position, to: Position, solids: readonly Solid[]): number {
  const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
  if (length < 0.001) return 1;
  let allowed = length;
  for (const solid of solids) {
    const along = ((solid.x - from.x) * dx + (solid.z - from.z) * dz) / length;
    const away = Math.abs((solid.x - from.x) * dz - (solid.z - from.z) * dx) / length;
    const radius = solid.radius + 0.2;
    if (along <= 0 || along > length + radius || away >= radius) continue;
    allowed = Math.min(allowed, Math.max(1.8, along - Math.sqrt(radius * radius - away * away) - 0.15));
  }
  return Math.min(1, allowed / length);
}

/** Keep encounters out of architecture, preferring the hero's side of a wall. */
export function encounterSpawn(preferred: Position, hero: Position, solids: readonly Solid[]): Position {
  const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.z - b.z);
  const open = (p: Position) => Math.abs(p.x) < 64 && p.z > -67 && p.z < 56
    && distance(p, hero) > 2.5 && solids.every((solid) => distance(p, solid) > solid.radius + 1);
  if (open(preferred)) return preferred;
  const angle = Math.atan2(hero.z - preferred.z, hero.x - preferred.x);
  for (let radius = 0.5; radius <= 12; radius += 0.5) {
    for (const offset of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI]) {
      const p = { x: preferred.x + Math.cos(angle + offset) * radius, z: preferred.z + Math.sin(angle + offset) * radius };
      if (open(p)) return p;
    }
  }
  return preferred;
}

/** Keep Dev 1's quest names and beat ids; place them in a continuous 3D world. */
export function objectiveFor(beat: StoryBeat): Position & { name: string } {
  const points: Record<string, Position> = {
    intro: { x: 0, z: 22 }, 'frost-spell': { x: 0, z: 4 },
    'spirit-gift': { x: -10, z: -3 }, 'shadow-ambush': { x: 8, z: -5 },
    crossroads: { x: 0, z: -14 },
  };
  const center = CENTERS[beat.environment];
  const offset = beat.id === 'gate' ? 12 : beat.id === 'boss' ? -11 : 0;
  return { ...(points[beat.id] ?? { x: center.x, z: center.z + offset }), name: questFor(beat).name };
}
