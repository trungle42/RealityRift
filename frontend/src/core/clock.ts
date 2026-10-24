import type { Ticker } from 'pixi.js';

/** dt is in seconds. */
export type FrameFn = (dt: number) => void;

const subscribers = new Set<FrameFn>();
let elapsed = 0;

/** Drive every onFrame / tween / wait from one ticker. dt is clamped so a background tab doesn't teleport everything. */
export function startClock(ticker: Ticker): void {
  ticker.add((t) => {
    const dt = Math.min(t.deltaMS / 1000, 0.1);
    elapsed += dt;
    for (const fn of [...subscribers]) fn(dt);
  });
}

export function now(): number {
  return elapsed;
}

export function onFrame(fn: FrameFn): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function wait(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    let t = 0;
    const off = onFrame((dt) => {
      t += dt;
      if (t >= seconds) {
        off();
        resolve();
      }
    });
  });
}

/** Run step every frame until it returns true. step receives dt and total elapsed seconds. */
export function until(step: (dt: number, elapsed: number) => boolean): Promise<void> {
  return new Promise((resolve) => {
    let elapsed = 0;
    const off = onFrame((dt) => {
      elapsed += dt;
      if (step(dt, elapsed)) {
        off();
        resolve();
      }
    });
  });
}

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inCubic: (t: number) => t ** 3,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} satisfies Record<string, Ease>;

/** Animate numeric properties of target. Stops quietly if a Pixi object is destroyed mid-tween. */
export function tween(target: object, to: Record<string, number>, seconds: number, easing: Ease = ease.outCubic): Promise<void> {
  const keys = Object.keys(to);
  const values = target as Record<string, number>;
  const goal = to;
  const from = keys.map((k) => values[k]);
  return new Promise((resolve) => {
    let t = 0;
    const off = onFrame((dt) => {
      if ((target as { destroyed?: boolean }).destroyed) {
        off();
        resolve();
        return;
      }
      t = seconds <= 0 ? 1 : Math.min(t + dt / seconds, 1);
      const k = easing(t);
      keys.forEach((key, i) => {
        values[key] = from[i] + (goal[key] - from[i]) * k;
      });
      if (t >= 1) {
        off();
        resolve();
      }
    });
  });
}
