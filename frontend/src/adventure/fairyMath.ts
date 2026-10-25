/**
 * Pure helpers for Pip, the lantern fairy (the third player), kept free of DOM/Three so they can be unit tested.
 * Pip flies freely: no physics capsule, just the ground height plus a hover band and the edges of the map.
 */
import type { StickMove } from './phoneMath';

/** Phone and wand slot of the fairy: hero 0 and hero 1 are slots 0 and 1. */
export const FAIRY_SLOT = 2;
/** The playable map (the trails run x -40..40, z -57..48), with room to fly around the edges. */
export const FAIRY_BOUNDS = { minX: -70, maxX: 70, minZ: -75, maxZ: 62 };
/** Pip floats this far above the ground, never lower or higher. */
export const HOVER_MIN = 1.5, HOVER_MAX = 2.5;
export const FAIRY_SPEED = 7.5;
export const FAIRY_SPRINT = 1.6;
/** Slash on the phone: a short burst forward. */
export const DASH_SPEED = 24, DASH_TIME = 0.22, DASH_COOLDOWN = 0.9;
/** Without a phone Pip circles hero 0 at this radius. */
export const FOLLOW_RADIUS = 1.7;

export interface Point3 { x: number; y: number; z: number }
export interface FairyMotion extends Point3 { heading: number; dash: number; dashCooldown: number }

const clampTo = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Inside the map and inside the hover band above the ground at its (x, z). */
export function clampFairy(p: Point3, groundAt: (x: number, z: number) => number): Point3 {
  const x = clampTo(p.x, FAIRY_BOUNDS.minX, FAIRY_BOUNDS.maxX), z = clampTo(p.z, FAIRY_BOUNDS.minZ, FAIRY_BOUNDS.maxZ);
  const ground = groundAt(x, z);
  return { x, y: clampTo(p.y, ground + HOVER_MIN, ground + HOVER_MAX), z };
}

/** The gentle bob: the middle of the hover band, swaying 0.35 m. */
export function hoverHeight(ground: number, time: number): number { return ground + (HOVER_MIN + HOVER_MAX) / 2 + Math.sin(time * 2.4) * 0.35; }

/** Where Pip drifts to without a phone: circling hero 0. */
export function followPoint(hero: { x: number; z: number }, time: number): { x: number; z: number } {
  return { x: hero.x + Math.cos(time * 0.6) * FOLLOW_RADIUS, z: hero.z + Math.sin(time * 0.6) * FOLLOW_RADIUS };
}

/**
 * One frame of flight. A pushed stick flies Pip (sprint is faster); otherwise Pip drifts toward its spot beside hero 0.
 * A running dash overrides both. The result is always clamped to the map and the hover band.
 */
export function stepFairy(m: FairyMotion, stick: StickMove, hero: { x: number; z: number }, dt: number, time: number, groundAt: (x: number, z: number) => number): FairyMotion {
  let { x, z, heading } = m;
  const dash = Math.max(0, m.dash - dt), dashCooldown = Math.max(0, m.dashCooldown - dt);
  if (m.dash > 0) { x += Math.sin(heading) * DASH_SPEED * dt; z += Math.cos(heading) * DASH_SPEED * dt; }
  else if (stick.mag > 0) {
    const speed = FAIRY_SPEED * stick.mag * (stick.sprint ? FAIRY_SPRINT : 1);
    x += stick.x * speed * dt; z += stick.z * speed * dt; heading = Math.atan2(stick.x, stick.z);
  } else {
    const spot = followPoint(hero, time), k = 1 - Math.exp(-3 * dt), dx = (spot.x - x) * k, dz = (spot.z - z) * k;
    x += dx; z += dz; if (Math.hypot(dx, dz) > 0.002) heading = Math.atan2(dx, dz);
  }
  const ground = groundAt(clampTo(x, FAIRY_BOUNDS.minX, FAIRY_BOUNDS.maxX), clampTo(z, FAIRY_BOUNDS.minZ, FAIRY_BOUNDS.maxZ));
  return { ...clampFairy({ x, y: hoverHeight(ground, time), z }, groundAt), heading, dash, dashCooldown };
}

/** Start a dash along the current heading, unless one ran too recently. */
export function startDash(m: FairyMotion): FairyMotion { return m.dashCooldown > 0 ? m : { ...m, dash: DASH_TIME, dashCooldown: DASH_COOLDOWN }; }
