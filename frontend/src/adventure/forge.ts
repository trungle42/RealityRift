import type { PlayerIndex } from '../contracts';
import type { Ability } from './weapon';

/**
 * The wand, one of each hero's two weapons (the sword is the other): a shape drawn in the air with a coloured wand
 * (haicil's cv_2 tracker) casts that shape's spell at once. A held Reality Rift relic only infuses it with an
 * element and power (`wandSpell` in weapon.ts); the shape alone decides the spell.
 *
 * The game only sees "this wand colour just completed this shape" (`Adventure.onShape(colour, shape)`). The CV link
 * feeds it from the tracker's `complete` event (`CvInput` -> `shapeFromWand`); `KeyboardShapes` is a `ShapeSource`
 * stand-in so every step also works, and can be tested, without a camera. Pure apart from KeyboardShapes' key listener.
 */
export type WandShape = 'circle' | 'triangle' | 'square' | 'star';
export type WandColour = 'yellow' | 'blue' | 'red';

export const WAND_SHAPES: readonly WandShape[] = ['circle', 'triangle', 'square', 'star'];
/** The spell each tracker shape casts. (Bolt is the plain F cast; pierce has no shape.) */
export const SHAPE_ABILITY: Record<WandShape, Ability> = { circle: 'nova', triangle: 'meteor', square: 'wave', star: 'chain' };
export const WAND_COLOURS: readonly WandColour[] = ['yellow', 'blue', 'red'];
/**
 * Which wand colour belongs to which player slot, in order: slot 0 = hero one, slot 1 = hero two, slot 2 = Pip the fairy
 * (not a hero; see Adventure.fairy). Default: yellow is hero one, blue is hero two.
 */
export type WandSeats = readonly WandColour[];
export type WandSlot = 0 | 1 | 2;
export const DEFAULT_SEATS: WandSeats = ['yellow', 'blue'];

/**
 * Each player has their own wand colour. The game is told with `?wand=red` (red drives hero one), `?wand=red,blue` (two
 * players at one camera) or `?wand=red,blue,yellow` (three: the third casts for Pip the fairy). No value, an unknown
 * colour, the same colour twice or more than three fall back to the default.
 */
export function wandSeats(search: string): WandSeats {
  const raw = new URLSearchParams(search).get('wand');
  if (!raw) return DEFAULT_SEATS;
  const names = raw.split(',').map((name) => name.trim().toLowerCase());
  const colours = names.filter((name): name is WandColour => (WAND_COLOURS as readonly string[]).includes(name));
  if (colours.length !== names.length || !colours.length || colours.length > 3 || new Set(colours).size !== colours.length) return DEFAULT_SEATS;
  return colours;
}

/** The player slot a wand colour belongs to, or undefined for a colour nobody has. */
export function wandSlot(colour: WandColour, seats: WandSeats = DEFAULT_SEATS): WandSlot | undefined {
  const slot = seats.indexOf(colour);
  return slot < 0 || slot > 2 ? undefined : slot as WandSlot;
}

/** Seconds before the same hero can cast the same shape again, so drawing cannot be spammed. Other shapes stay ready. */
export const SHAPE_COOLDOWN: Record<WandShape, number> = { circle: 2.2, triangle: 3, square: 1.6, star: 1.8 };

/**
 * A source of completed wand shapes. Contract: call the listener once per finished drawing (never for a live,
 * still-open stroke), with the colour of the wand that drew it and the shape it matched.
 */
export type ShapeListener = (colour: WandColour, shape: WandShape) => void;
export interface ShapeSource { subscribe(listener: ShapeListener): () => void; dispose(): void }

const isShape = (value: unknown): value is WandShape => (WAND_SHAPES as readonly unknown[]).includes(value);
export const colourOf = (value: string): WandColour | undefined => (['yellow', 'blue', 'red'] as const).find((c) => c === value);

/** The hero a wand colour drives (undefined for a colour nobody has, or hero two's while it is not in play). */
export function heroFor(colour: WandColour, solo: boolean, seats: WandSeats = DEFAULT_SEATS): PlayerIndex | undefined {
  const slot = wandSlot(colour, seats);
  return slot === undefined || slot === 2 || (slot === 1 && solo) ? undefined : slot;
}

/**
 * After any drawn spell the wand needs this long before the next one, whatever the shape. Drawing a shape in the air plus the
 * tracker's 0.8 s re-arm takes about this long anyway, so players rarely feel it; it stops four ready shapes going off in one
 * instant. Tuned with tests/demorun.html: two spells per Morwen ward window, so she lasts ~17 s against a fire relic and
 * ~37 s without one (anything from 1.6 to 2.6 s gives the same; outside that the fight jumps to 12 s or 23+ s).
 */
export const WAND_RECOVERY = 2;

/** Seconds a requested rune waits to be drawn before the game asks for a different one, so the player is never stuck. */
export const RUNE_PATIENCE = 10;
export const SHAPE_ICON: Record<WandShape, string> = { circle: '●', triangle: '▲', square: '■', star: '★' };

/** A random shape other than `prev` (any of the four when there is none). `rng` returns 0..1, like Math.random. */
export function nextRune(prev: WandShape | undefined, rng: () => number = Math.random): WandShape {
  const choices = WAND_SHAPES.filter((shape) => shape !== prev);
  return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
}

/**
 * In combat the game asks for one rune at a time: only that shape casts. A cast (or RUNE_PATIENCE seconds without one)
 * moves the request to a different shape. Pure state on the game clock; `rng` is public so a test can seed it.
 */
export class RuneCaller {
  target?: WandShape;
  private since = 0;
  constructor(public rng: () => number = Math.random) {}
  /** Ask for a rune if none is asked yet, or a new one if the current one waited too long. Returns the rune asked for. */
  update(now: number): WandShape {
    if (!this.target || now - this.since >= RUNE_PATIENCE) this.next(now);
    return this.target!;
  }
  /** The requested rune was cast (or skipped): ask for a different one. */
  next(now: number): void { this.target = nextRune(this.target, this.rng); this.since = now; }
  clear(): void { this.target = undefined; }
}

/** Per hero and shape cooldowns plus the wand's recovery, on the game clock (so a paused game does not tick them). */
export class ShapeCooldowns {
  private readonly until = new Map<string, number>();
  left(hero: PlayerIndex, shape: WandShape, now: number): number {
    return Math.max(0, (this.until.get(`${hero}:${shape}`) ?? -Infinity) - now, (this.until.get(`${hero}`) ?? -Infinity) - now);
  }
  ready(hero: PlayerIndex, shape: WandShape, now: number): boolean { return this.left(hero, shape, now) === 0; }
  use(hero: PlayerIndex, shape: WandShape, now: number): void { this.until.set(`${hero}:${shape}`, now + SHAPE_COOLDOWN[shape]); this.until.set(`${hero}`, now + WAND_RECOVERY); }
}

/**
 * The shape a wand completed, from the CV link's wand state when `complete[colour]` turns true. The tracker
 * latches only a drawing that matched the round's `target`, so the target is the shape; anything malformed is
 * ignored rather than guessed.
 */
export function shapeFromWand(colour: WandColour, wand: unknown): WandShape | undefined {
  if (typeof wand !== 'object' || wand === null) return undefined;
  const { target, complete, shapes } = wand as { target?: unknown; complete?: Record<string, unknown>; shapes?: Record<string, { shape?: unknown } | null> };
  if (complete?.[colour] !== true) return undefined;
  const drawn = shapes?.[colour]?.shape;
  return isShape(drawn) ? drawn : isShape(target) ? target : undefined;
}

/** Keyboard stand-in: 4/5/6/7 = yellow circle/triangle/square/star, 8/9/0/- = the same for blue. The game reads these as
 * "hero one's wand" and "hero two's wand" (whatever colours `?wand=` gives them; see Adventure.keyWand). */
export const SHAPE_KEYS: Record<string, [WandColour, WandShape]> = {
  Digit4: ['yellow', 'circle'], Digit5: ['yellow', 'triangle'], Digit6: ['yellow', 'square'], Digit7: ['yellow', 'star'],
  Digit8: ['blue', 'circle'], Digit9: ['blue', 'triangle'], Digit0: ['blue', 'square'], Minus: ['blue', 'star'],
};

export class KeyboardShapes implements ShapeSource {
  private readonly listeners = new Set<ShapeListener>();
  private readonly onKey = (event: KeyboardEvent): void => {
    const hit = SHAPE_KEYS[event.code];
    const typing = ['INPUT', 'TEXTAREA'].includes((event.target as { tagName?: string } | null)?.tagName ?? '');
    if (!hit || event.repeat || typing) return;
    this.listeners.forEach((listener) => listener(...hit));
  };

  constructor(private readonly target: EventTarget = window) { target.addEventListener('keydown', this.onKey as EventListener, true); }
  subscribe(listener: ShapeListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose(): void { this.target.removeEventListener('keydown', this.onKey as EventListener, true); this.listeners.clear(); }
}
