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
/** Yellow wand is hero one, blue is hero two. Red stays off: the tracker mistakes it for lips and skin. */
export const COLOUR_HERO: Partial<Record<WandColour, PlayerIndex>> = { yellow: 0, blue: 1 };

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

export function heroFor(colour: WandColour, solo: boolean): PlayerIndex | undefined {
  const hero = COLOUR_HERO[colour];
  return hero === 1 && solo ? undefined : hero;
}

/** Per hero and shape cooldowns, on the game clock (so a paused game does not tick them). */
export class ShapeCooldowns {
  private readonly until = new Map<string, number>();
  left(hero: PlayerIndex, shape: WandShape, now: number): number { return Math.max(0, (this.until.get(`${hero}:${shape}`) ?? -Infinity) - now); }
  ready(hero: PlayerIndex, shape: WandShape, now: number): boolean { return this.left(hero, shape, now) === 0; }
  use(hero: PlayerIndex, shape: WandShape, now: number): void { this.until.set(`${hero}:${shape}`, now + SHAPE_COOLDOWN[shape]); }
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

/** Keyboard stand-in: 4/5/6/7 = yellow circle/triangle/square/star, 8/9/0/- = the same for blue. */
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
