export const MOTION_CLIPS = ['walk', 'backwalk', 'run', 'roll', 'cast', 'hit'] as const;
export type MotionClip = typeof MOTION_CLIPS[number];
export type Locomotion = 'idle' | 'walk' | 'run';
export interface AnimationFrame { clip: MotionClip | 'idle'; frame: number; facing: number }
const DURATION = { roll: 0.32, cast: 0.42, hit: 0.55 };
const PRIORITY = { roll: 3, cast: 1, hit: 4 };

/** Deterministic animation state; actions finish once, locomotion loops. */
export class HeroAnimation {
  private movement: Locomotion = 'idle';
  private away = false;
  private facing = 1;
  private action: keyof typeof DURATION | null = null;
  private actionTime = 0;
  private loopTime = 0;
  private previous = 'idle';
  private frame: AnimationFrame = { clip: 'idle', frame: 0, facing: 1 };
  move(mode: Locomotion, dx = 0, dy = 0): void {
    this.movement = mode;
    if (Math.abs(dx) > 0.1) this.facing = dx < 0 ? -1 : 1;
    if (mode !== 'idle') this.away = dy < -0.3;
  }
  trigger(action: keyof typeof DURATION): void {
    if (this.action && PRIORITY[this.action] > PRIORITY[action]) return;
    this.action = action; this.actionTime = 0;
  }
  reset(): void {
    this.action = null; this.actionTime = 0; this.loopTime = 0; this.movement = 'idle';
    this.previous = 'idle'; this.facing = 1; this.away = false;
    this.frame = { clip: 'idle', frame: 0, facing: 1 };
  }
  get current(): AnimationFrame { return this.frame; }
  advance(dt: number, frozen = false): AnimationFrame {
    if (frozen) return this.frame;
    if (this.action) {
      this.actionTime += dt;
      if (this.actionTime >= DURATION[this.action]) this.action = null;
    }
    const clip = this.action ?? (this.movement === 'idle' ? 'idle' : this.away ? 'backwalk' : this.movement);
    if (clip !== this.previous) { this.loopTime = 0; this.previous = clip; }
    this.loopTime += dt;
    const frame = this.action ? Math.min(4, Math.floor(this.actionTime / DURATION[this.action] * 5))
      : clip === 'idle' ? 0 : Math.floor(this.loopTime * (this.movement === 'run' ? 12 : 8)) % 5;
    this.frame = { clip, frame, facing: this.facing };
    return this.frame;
  }
}
