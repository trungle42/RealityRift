import type { PlayerIndex } from '../contracts';
import { spellFor, type Ability, type Weapon } from './weapon';

/**
 * Reality Rift wand forging: a shape drawn in the air with a coloured wand (haicil's cv_2 tracker) gives a
 * scanned weapon its power, and in a fight completing a shape unleashes a Rift Surge.
 *
 * The game only sees `ShapeSource`: "this wand colour just completed this shape". The CV link feeds it from
 * the tracker's `complete` event (see `shapeFromWand`); `KeyboardShapes` is the stand-in so every step also
 * works, and can be tested, without a camera. Pure apart from KeyboardShapes' key listener.
 */
export type WandShape = 'circle' | 'triangle' | 'square' | 'star';
export type WandColour = 'yellow' | 'blue' | 'red';

export const WAND_SHAPES: readonly WandShape[] = ['circle', 'triangle', 'square', 'star'];
/** The four tracker presets onto four of the six abilities; bolt and pierce stay Gemini's to give. */
export const SHAPE_ABILITY: Record<WandShape, Ability> = { circle: 'nova', triangle: 'meteor', square: 'wave', star: 'chain' };
/** Yellow wand is hero one, blue is hero two. Red stays off: the tracker mistakes it for lips and skin. */
export const COLOUR_HERO: Partial<Record<WandColour, PlayerIndex>> = { yellow: 0, blue: 1 };

export type ShapeListener = (colour: WandColour, shape: WandShape) => void;
export interface ShapeSource { subscribe(listener: ShapeListener): () => void; dispose(): void }

const isShape = (value: unknown): value is WandShape => (WAND_SHAPES as readonly unknown[]).includes(value);

export function heroFor(colour: WandColour, solo: boolean): PlayerIndex | undefined {
  const hero = COLOUR_HERO[colour];
  return hero === 1 && solo ? undefined : hero;
}

/** The weapon, with its ability (and so its spell) set by the drawn shape. Name, element and damage stay. */
export function reforge(weapon: Weapon, shape: WandShape): Weapon {
  const artifact = { ...weapon, ability: SHAPE_ABILITY[shape] };
  return { ...artifact, spell: spellFor(artifact), shape };
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
