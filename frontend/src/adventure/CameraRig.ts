import * as T from 'three';
import type { Physics } from './Physics';
import { heightAt } from './terrain';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export interface CameraInput {
  hero: T.Vector3; velocity: T.Vector3; sprint: boolean; airborne: boolean;
  lock?: T.Vector3; physics?: Physics; flurry: number; reduced: boolean;
}

/**
 * Calm third-person camera in the Breath of the Wild mould:
 * - it only turns when the player turns it (drag / C / V) or while Z-targeting, never on its own;
 * - steady follow without look-ahead, so running does not bob the view;
 * - spring arm: walls and terrain always pull it in (fast in, slow out); thin props pull it in only when
 *   they would sit at the lens, so the camera is never inside geometry and does not pump in the forest;
 * - light trauma shake for impacts.
 */
export class CameraRig {
  readonly focus = new T.Vector3();
  private yawS: number;
  private pitchS: number;
  private arm: number;
  private trauma = 0;
  private fov: number;
  private readonly seed = Math.random() * 100;
  private readonly want = new T.Vector3();
  private readonly dir = new T.Vector3();

  constructor(readonly camera: T.PerspectiveCamera, public yaw: number, public pitch: number, public zoom: number) {
    this.yawS = yaw; this.pitchS = pitch; this.arm = zoom; this.fov = camera.fov;
  }

  /** Movement is relative to what the player sees, so expose the smoothed yaw. */
  get viewYaw(): number { return this.yawS; }
  /** Kept for callers; the camera no longer auto-rotates, so manual input needs no bookkeeping. */
  manual(_time: number): void {}
  addTrauma(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }
  snap(hero: T.Vector3): void { this.focus.copy(hero).add(new T.Vector3(0, 1.45, 0)); this.yawS = this.yaw; this.pitchS = this.pitch; }

  update(dt: number, time: number, o: CameraInput): void {
    if (o.lock) {
      // Z-targeting: swing behind the hero so the target sits beyond them.
      const want = Math.atan2(o.hero.x - o.lock.x, o.hero.z - o.lock.z);
      this.yaw += wrap(want - this.yaw) * damp(3.5, dt);
      this.pitch += (0.34 - this.pitch) * damp(2.5, dt);
    }
    this.yawS += wrap(this.yaw - this.yawS) * damp(12, dt);
    this.pitchS += (this.pitch - this.pitchS) * damp(10, dt);

    const want = this.want.copy(o.hero); want.y += 1.45;
    if (o.lock) want.lerp(o.lock, 0.18);
    this.focus.x += (want.x - this.focus.x) * damp(9, dt);
    this.focus.z += (want.z - this.focus.z) * damp(9, dt);
    this.focus.y += (want.y - this.focus.y) * damp(o.airborne ? 3 : 7, dt);

    const cp = Math.cos(this.pitchS), dir = this.dir.set(Math.sin(this.yawS) * cp, Math.sin(this.pitchS), Math.cos(this.yawS) * cp);
    let allowed = this.zoom;
    if (o.physics) {
      // Five rays approximate a sphere cast around the lens.
      const right = new T.Vector3(Math.cos(this.yawS), 0, -Math.sin(this.yawS));
      for (const [r, u] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.22], [0, -0.18]]) {
        const from = this.focus.clone().addScaledVector(right, r * 0.4); from.y += u * 0.4;
        const to = this.focus.clone().addScaledVector(dir, this.zoom + 0.5).addScaledVector(right, r); to.y += u;
        const hit = o.physics.cameraHits(from, to);
        if (hit.wall !== undefined) allowed = Math.min(allowed, hit.wall - 0.45);
        // A trunk mid-way just dissolves; one right at the lens would be seen from inside, so stop short of it.
        if (hit.thin !== undefined && hit.thin > this.zoom - 1.8) allowed = Math.min(allowed, hit.thin - 0.45);
      }
    }
    allowed = Math.max(1.6, allowed);
    this.arm += (allowed - this.arm) * (allowed < this.arm ? damp(16, dt) : damp(2, dt));

    const pos = this.camera.position.copy(this.focus).addScaledVector(dir, this.arm);
    const ground = heightAt(pos.x, pos.z) + 0.7;
    if (pos.y < ground) pos.y = ground;

    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const shake = this.trauma * this.trauma * (o.reduced ? 0.15 : 0.8);
    if (shake > 0) {
      pos.x += (Math.sin(time * 37 + this.seed) + Math.sin(time * 61.3)) * 0.14 * shake;
      pos.y += (Math.sin(time * 43.1 + this.seed * 2) + Math.sin(time * 71.7)) * 0.12 * shake;
    }
    this.camera.lookAt(this.focus);
    if (shake > 0) this.camera.rotateZ(Math.sin(time * 29 + this.seed) * 0.025 * shake);

    const fov = 55 + (o.sprint && Math.hypot(o.velocity.x, o.velocity.z) > 6 ? 2 : 0) + o.flurry * 5;
    if (Math.abs(fov - this.fov) > 0.01) { this.fov += (fov - this.fov) * damp(4, dt); this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }
}
