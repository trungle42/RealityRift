/** Pure helpers for the phone joystick, kept free of DOM/Three so they can be unit tested. */
export interface StickMove { x: number; z: number; mag: number; sprint: boolean }

export const STICK_DEADZONE = 0.14;
/** Without a fresh message for this long, the stick counts as released (a dropped Wi-Fi packet must never leave the hero running). */
export const STICK_STALE_SECONDS = 0.45;

/**
 * Raw phone message -> game movement. The phone sends x (right +) and y (forward +); the game's
 * movement vector is x (right +) and z (back +), so forward is negative z, the same as pressing W.
 * Magnitude is rescaled so the deadzone edge is 0 and full push is 1, giving analog speed without a jump at the rim of the deadzone.
 */
export function parseStick(raw: unknown): StickMove | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as { type?: unknown; x?: unknown; y?: unknown; sprint?: unknown };
  if (m.type !== 'move' || typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return undefined;
  const length = Math.hypot(m.x, m.y);
  if (length < STICK_DEADZONE) return { x: 0, z: 0, mag: 0, sprint: false };
  const ux = m.x / length, uy = m.y / length, mag = Math.min(1, (length - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return { x: ux, z: -uy, mag, sprint: m.sprint === true && mag > 0.9 };
}

export const NO_STICK: StickMove = { x: 0, z: 0, mag: 0, sprint: false };

/** The phone's buttons: a quick tap on the pad is `action` (like E / Enter / Space), plus the Scan and Roll buttons. */
export type PhoneCommand = 'action' | 'scan' | 'roll';
export function parseCommand(raw: unknown): PhoneCommand | undefined {
  const type = typeof raw === 'object' && raw !== null ? (raw as { type?: unknown }).type : undefined;
  return type === 'action' || type === 'scan' || type === 'roll' ? type : undefined;
}

/** Up to three phones play at once; the relay stamps each message with its sender's slot, `player` 0-2. */
export const MAX_PLAYERS = 3;
/** Every phone button, including Slash (a backup for the camera slash, and the only slash for players 2 and 3). */
export type PhoneButton = PhoneCommand | 'slash';
export function parseButton(raw: unknown): PhoneButton | undefined {
  return parseCommand(raw) ?? (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'slash' ? 'slash' : undefined);
}
/** The message's player slot: missing means 0 (a relay from before player slots); anything else invalid is undefined. */
export function parsePlayer(raw: unknown): number | undefined {
  const player = typeof raw === 'object' && raw !== null ? (raw as { player?: unknown }).player : undefined;
  if (player === undefined) return 0;
  return Number.isInteger(player) && (player as number) >= 0 && (player as number) < MAX_PLAYERS ? player as number : undefined;
}

/** The stick to apply right now: the latest one, or none if it has gone stale. */
export function currentStick(latest: StickMove | undefined, receivedAt: number, now: number): StickMove {
  return latest && now - receivedAt <= STICK_STALE_SECONDS ? latest : NO_STICK;
}
