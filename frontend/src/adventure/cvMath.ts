/** Pure helpers for the body tracker (cv_2 through the backend relay), kept free of DOM/Three so they can be unit tested. */
export interface WandShape { shape: string | null; score: number }
/** Line segments of [x, y] points, 0-1 of the camera picture, x mirrored (selfie view). */
export type WandTrace = [number, number][][];
/**
 * The tracker's wand round. While the game is in the room the game drives it (CvInput.gate): on, and `target` is the shape the
 * game asked for, or null for any shape. Without a game the tracker falls back to its own 5 s on/off timer and cycles targets.
 */
export interface WandState {
  active: boolean;
  secondsLeft: number;
  target: string | null;
  next: string | null;
  /** Per colour: the shape its drawing reads as (null shape = closed but no preset), or null before the stroke closes. */
  shapes: Record<string, WandShape | null>;
  /** Per colour: its drawing matched `target` this round (stays true until the round ends). */
  complete: Record<string, boolean>;
  traces: Record<string, WandTrace>;
}
/** The phone's marker in the camera picture: 0-1, x mirrored (selfie view); radius is a fraction of the picture's width. */
export interface CvPoint { x: number; y: number; radius: number }
/** One tracker frame. slash and jump are running counts: an event is the count going up. motion is the fraction of the picture moving. */
export interface CvFrame { slash: number; jump: number; motion: number | null; phone: CvPoint | null; wands: Record<string, CvPoint | null>; wand: WandState | null }
/** A camera picture from the tracker (it is the only program that opens the webcam): base64 JPEG, `id` on a snapshot. */
export interface CameraPicture { jpeg: string; w: number; h: number; id?: number }

/** Without a new camera picture for this long the wand panel and scanner stop showing the old one. */
export const PICTURE_STALE_SECONDS = 1.5;
const JPEG_BASE64 = /^\/9j\/[A-Za-z0-9+/]*={0,2}$/;

/**
 * Fraction of the picture moving above which the freeze trial counts the player as moving. Standing still reads ~0 (camera noise
 * stays under the tracker's per-pixel floor); leaning or waving measured 0.12-0.20 and a jump 0.41-0.52 on the dev camera.
 * Small fidgets have not been measured live, and people walking behind the player count too.
 */
export const FREEZE_MOTION = 0.06;
/** Without a frame for this long the tracker's motion no longer counts (it sends ~25-30 a second). */
export const CV_STALE_SECONDS = 0.5;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Raw relay message -> tracker frame, or undefined if it is not one. The relay has already checked the wand block's contents. */
export function parseCv(raw: unknown): CvFrame | undefined {
  if (!isRecord(raw) || raw.type !== 'cv' || !isCount(raw.slash) || !isCount(raw.jump)) return undefined;
  const motion = typeof raw.motion === 'number' && Number.isFinite(raw.motion) ? Math.min(1, Math.max(0, raw.motion)) : null;
  const w = raw.wand;
  const wand = isRecord(w) && typeof w.active === 'boolean' && typeof w.secondsLeft === 'number' && isRecord(w.shapes) && isRecord(w.complete) && isRecord(w.traces)
    ? w as unknown as WandState : null;
  const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  const point = (p: unknown): CvPoint | null => isRecord(p) && unit(p.x) && unit(p.y) && unit(p.radius) ? { x: p.x as number, y: p.y as number, radius: p.radius as number } : null;
  const wands: Record<string, CvPoint | null> = {};
  if (isRecord(raw.wands)) for (const [colour, p] of Object.entries(raw.wands)) wands[colour] = point(p);
  return { slash: raw.slash, jump: raw.jump, motion, phone: point(raw.phone), wands, wand };
}

/**
 * Setup hint for one player standing 1.5-2 m from the webcam with the yellow wand and the lime-taped phone, or '' when all is well.
 * "Too close" is a marker much bigger than at that distance (a ~7 cm ball is ~0.03 of the picture's width there, the tape ~0.06).
 * First guesses, not yet measured on a real webcam.
 */
export const NEAR_WAND = 0.09, NEAR_PHONE = 0.16;
export function setupHint(frame: Pick<CvFrame, 'wands' | 'phone'> | undefined, colour = 'yellow'): string {
  if (!frame) return '';
  const wand = frame.wands[colour] ?? null, phone = frame.phone;
  if ((wand && wand.radius > NEAR_WAND) || (phone && phone.radius > NEAR_PHONE)) return 'Step back a little';
  if (!wand && !phone) return 'Wand and phone tape not seen';
  if (!wand) return `${colour[0].toUpperCase()}${colour.slice(1)} wand not seen`;
  return phone ? '' : 'Phone tape not seen';
}

/** A relay message -> camera picture of that type ("frame": the live preview, "snapshot": the one the scanner asked for). */
export function parsePicture(raw: unknown, type: 'frame' | 'snapshot'): CameraPicture | undefined {
  if (!isRecord(raw) || raw.type !== type || typeof raw.jpeg !== 'string' || !JPEG_BASE64.test(raw.jpeg)) return undefined;
  if (!isCount(raw.w) || !isCount(raw.h) || !raw.w || !raw.h || (type === 'snapshot' && !isCount(raw.id))) return undefined;
  return { jpeg: raw.jpeg, w: raw.w, h: raw.h, ...(type === 'snapshot' ? { id: raw.id as number } : {}) };
}

/** How many events a running count adds. The first count seen, or one that went down (the tracker restarted), is a new baseline. */
export function newEvents(last: number | undefined, count: number): number {
  return last === undefined || count < last ? 0 : count - last;
}

/** Colours whose drawing has just matched the target. Without an earlier frame there is nothing to compare with, so none. */
export function newlyComplete(before: Record<string, boolean> | undefined, after: Record<string, boolean>): string[] {
  return before ? Object.keys(after).filter((colour) => after[colour] === true && before[colour] !== true) : [];
}

/** The shape a wand just completed: what it drew, or the asked-for target (the tracker only latches a match). */
export function completedShape(wand: WandState, colour: string): string | undefined {
  return wand.shapes[colour]?.shape ?? wand.target ?? undefined;
}

/** Each pose seal's rune, so a seal can be opened with the wand as well as with the pose keys. */
export const POSE_SHAPE: Record<string, string> = { 'arms-up': 'triangle', 't-pose': 'square', crouch: 'circle' };

/** The wand panel's prompt: the asked-for shape, or how to start a free drawing; empty while the wand is off. */
export function wandPrompt(wand: WandState | undefined): string {
  if (!wand?.active) return '';
  return wand.target ? `Draw a ${wand.target}` : 'Hold still, then draw a shape';
}

/** Whether the tracker currently sees the player moving: only a fresh reading counts. */
export function bodyMoving(motion: number | null | undefined, receivedAt: number, now: number): boolean {
  return motion != null && now - receivedAt <= CV_STALE_SECONDS && motion >= FREEZE_MOTION;
}
