/**
 * Reality Rift: a real object, read by Gemini, becomes the hero's spell weapon.
 * Pure (no DOM, no Three) so the mapping and the response check can be unit tested.
 */
export type Element = 'fire' | 'water' | 'lightning' | 'ice' | 'nature' | 'shadow' | 'light';
export type Ability = 'wave' | 'bolt' | 'nova' | 'pierce' | 'meteor' | 'chain';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type ArtifactType = 'staff' | 'spear' | 'sword' | 'mirror' | 'chalice' | 'orb';

/** Matches backend/app/schemas.py `Artifact`. */
export interface Artifact {
  object: string; artifactName: string; artifactType: ArtifactType; element: Element;
  ability: Ability; damage: number; rarity: Rarity; description: string;
}
export interface ArtifactResponse { artifact: Artifact; source: 'gemini' | 'fallback' }

export const ELEMENTS: readonly Element[] = ['fire', 'water', 'lightning', 'ice', 'nature', 'shadow', 'light'];
export const ABILITIES: readonly Ability[] = ['wave', 'bolt', 'nova', 'pierce', 'meteor', 'chain'];
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const TYPES: readonly ArtifactType[] = ['staff', 'spear', 'sword', 'mirror', 'chalice', 'orb'];

export const ELEMENT_COLOR: Record<Element, number> = {
  fire: 0xff7a3d, water: 0x4fb8ff, lightning: 0xf6e85a, ice: 0xbfe9ff, nature: 0x7fe08a, shadow: 0xa275ff, light: 0xfff1b8,
};
export const ABILITY_LABEL: Record<Ability, string> = {
  wave: 'Wave: three bolts in a fan', bolt: 'Bolt: a fast single shot', nova: 'Nova: a burst all around you',
  pierce: 'Pierce: passes through foes', meteor: 'Meteor: a strike from the sky', chain: 'Chain: leaps between foes',
};

export interface SpellSpec {
  ability: Ability; element?: Element; color: number; damage: number; cooldown: number;
  speed: number; life: number; count: number; spread: number; pierce: number;
  radius: number; delay: number; chain: number;
}

const BASE: Record<Ability, Omit<SpellSpec, 'ability' | 'color' | 'damage'>> = {
  bolt:   { cooldown: 0.8, speed: 23, life: 1.1, count: 1, spread: 0,    pierce: 0, radius: 0,   delay: 0,    chain: 0 },
  pierce: { cooldown: 0.9, speed: 34, life: 1.0, count: 1, spread: 0,    pierce: 4, radius: 0,   delay: 0,    chain: 0 },
  wave:   { cooldown: 0.9, speed: 19, life: 0.6, count: 3, spread: 0.3,  pierce: 0, radius: 0,   delay: 0,    chain: 0 },
  nova:   { cooldown: 1.5, speed: 0,  life: 0,   count: 0, spread: 0,    pierce: 0, radius: 5.2, delay: 0,    chain: 0 },
  meteor: { cooldown: 2.2, speed: 0,  life: 0,   count: 0, spread: 0,    pierce: 0, radius: 3.4, delay: 0.75, chain: 0 },
  chain:  { cooldown: 1.0, speed: 26, life: 1.1, count: 1, spread: 0,    pierce: 0, radius: 6.5, delay: 0,    chain: 2 },
};

/** Damage per hit, 1..3 (regular foes have 3 hp), from Gemini's 1..100; a meteor hits one tier harder. */
export function damageTier(damage: number): number { return damage <= 30 ? 1 : damage <= 65 ? 2 : 3; }

export function spellFor(artifact: Artifact): SpellSpec {
  const base = BASE[artifact.ability];
  return { ability: artifact.ability, element: artifact.element, color: ELEMENT_COLOR[artifact.element], damage: damageTier(artifact.damage) + (artifact.ability === 'meteor' ? 1 : 0), ...base };
}

/** Each boss fears one element and shrugs off another, so which object you scan is a real choice. */
export const BOSS_ELEMENTS: Record<string, { weak: Element; resists: Element }> = {
  'frost-witch': { weak: 'fire', resists: 'ice' },
  'shadow-dragon': { weak: 'light', resists: 'shadow' },
};
export const WEAK_MULTIPLIER = 2;
export const RESIST_MULTIPLIER = 0.5;

/** Damage multiplier for an element hitting a boss kind: x2 if it is weak to it, x0.5 if it resists, else x1. */
export function elementMultiplier(bossKind: string | undefined, element: Element | undefined): number {
  const entry = bossKind ? BOSS_ELEMENTS[bossKind] : undefined;
  if (!entry || !element) return 1;
  return element === entry.weak ? WEAK_MULTIPLIER : element === entry.resists ? RESIST_MULTIPLIER : 1;
}

/** Final damage: scaled by the multiplier, never below 1 and always a whole number. */
export function scaledDamage(base: number, multiplier: number): number { return Math.max(1, Math.round(base * multiplier)); }

/** The spell every hero has before scanning anything. */
export function defaultSpell(color: number): SpellSpec { return { ability: 'bolt', color, damage: 1, ...BASE.bolt }; }

/** Wand spells with no relic held: a neutral arcane violet, no element. */
export const ARCANE_COLOR = 0xc4a8ff;

/**
 * A relic's power: 1, or 2 for a legendary or a very strong (90+) one. Kept low on purpose: a relic's real weight is its
 * element, which doubles every hit on the boss that fears it ("Weak point!"); a high tier on top made Morwen fall in seconds.
 */
export function relicTier(relic: Pick<Artifact, 'damage' | 'rarity'>): number { return relic.rarity === 'legendary' || relic.damage >= 90 ? 2 : 1; }

/**
 * A wand spell of `ability`. A held relic infuses it with its element, colour and power tier; without one it is
 * tier 1 in `color`. A meteor strikes one tier harder either way.
 */
export function wandSpell(ability: Ability, relic?: Artifact, color = ARCANE_COLOR): SpellSpec {
  const tier = relic ? relicTier(relic) : 1;
  return { ability, element: relic?.element, color: relic ? ELEMENT_COLOR[relic.element] : color, damage: tier + (ability === 'meteor' ? 1 : 0), ...BASE[ability] };
}

export interface Weapon extends Artifact { spell: SpellSpec; source: 'gemini' | 'fallback' }

export function makeWeapon(response: ArtifactResponse): Weapon { return { ...response.artifact, spell: spellFor(response.artifact), source: response.source }; }

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined => (list as readonly unknown[]).includes(value) ? value as T : undefined;
const text = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/** Validate what /api/artifact returned. Anything unexpected is rejected rather than half-trusted. */
export function parseArtifactResponse(raw: unknown): ArtifactResponse | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { artifact: a, source } = raw as { artifact?: Record<string, unknown>; source?: unknown };
  if (typeof a !== 'object' || a === null || (source !== 'gemini' && source !== 'fallback')) return undefined;
  const artifactType = oneOf(TYPES, a.artifactType), element = oneOf(ELEMENTS, a.element), ability = oneOf(ABILITIES, a.ability), rarity = oneOf(RARITIES, a.rarity);
  const artifactName = text(a.artifactName, 40), object = text(a.object, 40), description = text(a.description, 200);
  if (!artifactType || !element || !ability || !rarity || !artifactName || !object || !description) return undefined;
  const damage = typeof a.damage === 'number' && Number.isFinite(a.damage) ? Math.max(1, Math.min(100, Math.round(a.damage))) : undefined;
  if (damage === undefined) return undefined;
  return { artifact: { object, artifactName, artifactType, element, ability, damage, rarity, description }, source };
}

/** Scale a camera frame to at most `max` px on its longest side (backend caps the upload; Gemini does not need more). */
export function fitWithin(width: number, height: number, max = 512): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
