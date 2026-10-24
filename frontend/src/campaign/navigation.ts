/** World-space navigation shared by keyboard movement, companions and click paths. */
export interface Point { x: number; y: number }
export interface Obstacle extends Point { radius: number }
export const WALK = { top: 390, bottom: 642, left: 95, right: 1185 };
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const depthScale = (y: number): number => 0.50 + (y - WALK.top) / (WALK.bottom - WALK.top) * 0.35;

export function walkable(p: Point, obstacles: readonly Obstacle[], radius = 14): boolean {
  const inset = Math.max(0, (470 - p.y) * 0.8);
  return p.y >= WALK.top && p.y <= WALK.bottom && p.x >= WALK.left + inset && p.x <= WALK.right - inset
    && obstacles.every((o) => distance(p, o) >= o.radius + radius);
}

export function move(p: Point, dx: number, dy: number, obstacles: readonly Obstacle[]): Point {
  // Substeps prevent a long frame or a dash from tunnelling through a pillar.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6));
  // Pixi positions expose x/y through accessors; spreading a display object loses them.
  let next = { x: p.x, y: p.y };
  for (let i = 0; i < steps; i++) {
    const x = { x: next.x + dx / steps, y: next.y };
    if (walkable(x, obstacles)) next = x;
    const y = { x: next.x, y: next.y + dy / steps };
    if (walkable(y, obstacles)) next = y;
  }
  return next;
}

/** Small eight-way A* grid. Obstacles are inflated by the hero's footprint. */
export function findPath(start: Point, target: Point, obstacles: readonly Obstacle[]): Point[] {
  const size = 18;
  const cols = 62, rows = 15;
  const point = (id: number): Point => ({ x: 95 + (id % cols) * size, y: 390 + Math.floor(id / cols) * size });
  const valid = Array.from({ length: cols * rows }, (_, id) => walkable(point(id), obstacles));
  const nearest = (p: Point) => valid.reduce((best, ok, id) => ok && (best < 0 || distance(point(id), p) < distance(point(best), p)) ? id : best, -1);
  const first = nearest(start), last = nearest(target);
  if (first < 0 || last < 0) return [];
  const open = new Set([first]);
  const cost = new Map([[first, 0]]), prev = new Map<number, number>();
  while (open.size) {
    let current = -1, best = Infinity;
    for (const id of open) {
      const score = cost.get(id)! + distance(point(id), point(last));
      if (score < best) { best = score; current = id; }
    }
    if (current === last) {
      const path = [point(last)];
      while (prev.has(current)) { current = prev.get(current)!; path.unshift(point(current)); }
      // The first grid point is included so the route never cuts a nearby corner.
      return path;
    }
    open.delete(current);
    const cx = current % cols, cy = Math.floor(current / cols);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || cx + dx < 0 || cx + dx >= cols || cy + dy < 0 || cy + dy >= rows) continue;
      const id = current + dy * cols + dx;
      if (!valid[id]) continue;
      if (dx && dy && (!valid[current + dx] || !valid[current + dy * cols])) continue;
      const next = cost.get(current)! + Math.hypot(dx, dy) * size;
      if (next >= (cost.get(id) ?? Infinity)) continue;
      cost.set(id, next); prev.set(id, current); open.add(id);
    }
  }
  return [];
}
