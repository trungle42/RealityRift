/**
 * Pure helpers for online presence (each laptop runs its own game and sees the other players' heroes), kept free of
 * DOM/Three so they can be unit tested. The relay is `WS /ws/presence/{room}?name=&colour=`; it stamps every peer message
 * with the sender's `id`.
 *
 * Step 2 (not built yet) adds host-authoritative enemies on the same socket: the host spawns and simulates enemies and
 * sends snapshots, clients mirror them and send their hits to the host. `parsePresence` returns undefined for any message
 * type it does not know, so those messages can be added here without touching step 1.
 */

export type Anim = 'idle' | 'walk' | 'run' | 'strike' | 'roll' | 'jump' | 'cast' | 'hurt' | 'dead' | 'pose';
export const ANIMS: readonly Anim[] = ['idle', 'walk', 'run', 'strike', 'roll', 'jump', 'cast', 'hurt', 'dead', 'pose'];

/** How often hero 0's state goes out (per second). */
export const SEND_RATE = 12;
/** Remote heroes are drawn this far in the past, so there are almost always two snapshots to blend between. */
export const INTERP_DELAY = 0.1;
/** Snapshots kept per peer. */
export const BUFFER_SIZE = 20;

export interface Peer { id: string; name: string; colour: string }
export interface HeroState { x: number; y: number; z: number; heading: number; speed: number; anim: Anim; hp: number }
export interface FxEvent { kind: 'cast' | 'slash'; ability?: string; element?: string; x: number; y: number; z: number; dx: number; dz: number }

export type PresenceMessage =
  | { type: 'welcome'; id: string; peers: Peer[]; started: boolean }
  | { type: 'peer'; state: 'joined' | 'left'; peer: Peer }
  | { type: 'state'; id: string; state: HeroState }
  | { type: 'fx'; id: string; fx: FxEvent }
  | { type: 'full' }
  | { type: 'replaced' }
  | { type: 'start'; id: string }
  | { type: 'hit'; id: string; enemy: string; damage: number }
  | { type: 'foes'; id: string; foes: FoeSnap[] };

/** One encounter foe as the host sees it: shared id, where it stands, its heading, winding up or not, which attack. */
export interface FoeSnap { id: string; x: number; z: number; h: number; w: boolean; a: number }
/** Attack names by the code the foes message carries. */
export const FOE_ATTACKS = ['strike', 'frost-gaze', 'shadow-wave'] as const;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max = 24): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined);
/** The relay's ids are small numbers (0-2); keep them as strings so a Map key or a later string id works the same. */
const idOf = (v: unknown): string | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? String(v) : text(v, 64));
const peerOf = (raw: Record<string, unknown>): Peer | undefined => {
  const id = idOf(raw.id); if (id === undefined) return undefined;
  return { id, name: text(raw.name) ?? 'Player', colour: text(raw.colour, 12) ?? 'yellow' };
};

/** One relay message, validated; anything malformed or unknown is undefined (ignored, never thrown). */
export function parsePresence(raw: unknown): PresenceMessage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  if (m.type === 'full') return { type: 'full' };
  if (m.type === 'replaced') return { type: 'replaced' };
  if (m.type === 'welcome') {
    const id = idOf(m.id); if (id === undefined) return undefined;
    const peers = Array.isArray(m.peers) ? m.peers.map((p) => (typeof p === 'object' && p ? peerOf(p as Record<string, unknown>) : undefined)).filter((p): p is Peer => !!p && p.id !== id) : [];
    return { type: 'welcome', id, peers, started: m.started === true };
  }
  if (m.type === 'peer' && (m.state === 'joined' || m.state === 'left')) { const peer = peerOf(m); return peer && { type: 'peer', state: m.state, peer }; }
  const id = idOf(m.id); if (id === undefined) return undefined;
  if (m.type === 'start') return { type: 'start', id };
  if (m.type === 'foes') {
    if (!Array.isArray(m.f)) return undefined;
    const foes: FoeSnap[] = [];
    for (const e of m.f.slice(0, 12)) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || !/^[a-z0-9:_-]{1,16}$/.test(e[0]) || ![e[1], e[2], e[3]].every(finite)) return undefined;
      foes.push({ id: e[0], x: e[1], z: e[2], h: e[3], w: e[4] === 1, a: [0, 1, 2].includes(e[5]) ? e[5] : 0 });
    }
    return { type: 'foes', id, foes };
  }
  if (m.type === 'hit') {
    if (typeof m.enemy !== 'string' || !/^[a-z0-9:_-]{1,16}$/.test(m.enemy) || !finite(m.damage) || m.damage < 0) return undefined;
    return { type: 'hit', id, enemy: m.enemy, damage: Math.min(100, m.damage) };
  }
  if (m.type === 'state') {
    if (![m.x, m.y, m.z, m.heading].every(finite)) return undefined;
    const anim = (ANIMS as readonly unknown[]).includes(m.anim) ? (m.anim as Anim) : 'idle';
    return { type: 'state', id, state: { x: m.x as number, y: m.y as number, z: m.z as number, heading: m.heading as number, speed: finite(m.speed) ? Math.max(0, m.speed) : 0, anim, hp: finite(m.hp) ? m.hp : 3 } };
  }
  if (m.type === 'fx' && (m.kind === 'cast' || m.kind === 'slash')) {
    if (![m.x, m.y, m.z, m.dx, m.dz].every(finite)) return undefined;
    return { type: 'fx', id, fx: { kind: m.kind, ability: text(m.ability, 12), element: text(m.element, 12), x: m.x as number, y: m.y as number, z: m.z as number, dx: m.dx as number, dz: m.dz as number } };
  }
  return undefined;
}

/** What the local hero is doing, as the game knows it. */
export interface LocalHero { dead: boolean; stagger: number; roll: number; airborne: boolean; casting: boolean; attack: number; pose: string; speed: number }

/** The animation other players should see: the most specific thing going on wins. */
export function animOf(h: LocalHero): Anim {
  if (h.dead) return 'dead';
  if (h.stagger > 0) return 'hurt';
  if (h.roll >= 0) return 'roll';
  if (h.airborne) return 'jump';
  if (h.casting) return 'cast';
  if (h.attack > 0) return 'strike';
  if (h.pose) return 'pose';
  return h.speed > 5 ? 'run' : h.speed > 0.7 ? 'walk' : 'idle';
}

interface Snapshot extends HeroState { t: number }

/** An angle wrapped to -π..π (the relay's range for `heading`). */
export function wrapAngle(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)); }

/** Shortest-way blend between two angles. */
export function lerpAngle(a: number, b: number, k: number): number { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k; }

/**
 * A peer's recent states on the local clock. `sample(now)` blends the two that straddle `now - INTERP_DELAY`; before the
 * first it holds the oldest, after the last it holds the newest (no guessing ahead), so a dropped packet freezes rather than drifts.
 */
export class SnapshotBuffer {
  private readonly snaps: Snapshot[] = [];
  push(state: HeroState, t: number): void {
    if (this.snaps.length && t < this.snaps[this.snaps.length - 1].t) return;
    this.snaps.push({ ...state, t }); if (this.snaps.length > BUFFER_SIZE) this.snaps.shift();
  }
  get size(): number { return this.snaps.length; }
  sample(now: number, delay = INTERP_DELAY): HeroState | undefined {
    const snaps = this.snaps; if (!snaps.length) return undefined;
    const at = now - delay;
    if (at <= snaps[0].t) return strip(snaps[0]);
    const last = snaps[snaps.length - 1]; if (at >= last.t) return strip(last);
    let i = snaps.length - 2; while (i > 0 && snaps[i].t > at) i--;
    const a = snaps[i], b = snaps[i + 1], k = (at - a.t) / Math.max(1e-6, b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, heading: lerpAngle(a.heading, b.heading, k), speed: a.speed + (b.speed - a.speed) * k, anim: k < 0.5 ? a.anim : b.anim, hp: b.hp };
  }
}
const strip = ({ t: _t, ...state }: Snapshot): HeroState => state;

/** `?presence=ws://host:8000&room=&name=&wand=red,blue,yellow`: null when presence is off (normal single-laptop play). */
export function presenceConfig(search: string, override?: string): { url: string; room: string; name: string; colour: string } | null {
  const params = new URLSearchParams(search), base = (override ?? params.get('presence') ?? '').trim().replace(/\/+$/, '');
  if (!/^wss?:\/\//.test(base)) return null;
  const room = (params.get('room') ?? 'storybound').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'storybound';
  // The relay closes a name outside 1-16 of [A-Za-z0-9 _-] or a colour other than red / blue / yellow, so clean both here.
  const name = (params.get('name') ?? '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 16) || 'Player';
  const first = (params.get('wand') ?? '').split(',')[0]?.trim().toLowerCase() ?? '', colour = ['red', 'blue', 'yellow'].includes(first) ? first : 'yellow';
  return { url: `${base}/ws/presence/${room}?name=${encodeURIComponent(name)}&colour=${encodeURIComponent(colour)}`, room, name, colour };
}

/** Wand colour names to the colours drawn for each player (name tag, wand glow, ring). */
export const PEER_COLOR: Record<string, number> = { red: 0xff5d5d, blue: 0x5aa9ff, yellow: 0xffd34d };
export const peerColor = (colour: string): number => PEER_COLOR[colour] ?? 0xe8e0c8;
