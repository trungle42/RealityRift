import { makeWeapon, parseArtifactResponse, type ArtifactResponse, type Weapon } from './weapon';

/**
 * Reality Rift armory: every weapon a player forged, with the photo of the real object it came from.
 * Lives only in this browser (localStorage); photos never leave it except the one Gemini call.
 * Pure apart from the injected storage, so it can be unit tested. Stored data is untrusted on read.
 */
export const ARMORY_KEY = 'storybound.armory.v1';
export const ARMORY_MAX = 8;
/** A 200px JPEG thumbnail is ~10-20 KB as a data URL; anything far bigger is not one of ours. */
export const PHOTO_MAX = 80_000;

export interface ArmoryEntry { response: ArtifactResponse; photo: string; savedAt: number }
export interface ArmoryStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

const PHOTO = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;
export const isPhoto = (value: unknown): value is string => typeof value === 'string' && value.length <= PHOTO_MAX && PHOTO.test(value);

/** localStorage, or undefined where it is blocked (private windows, previews, cleared site data). */
export function browserStore(): ArmoryStore | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function readArmory(store: ArmoryStore | undefined): ArmoryEntry[] {
  let raw: unknown;
  try { raw = JSON.parse(store?.getItem(ARMORY_KEY) ?? '[]'); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const entries: ArmoryEntry[] = [];
  for (const item of raw.slice(0, ARMORY_MAX)) {
    const { response, photo, savedAt } = (item ?? {}) as { response?: unknown; photo?: unknown; savedAt?: unknown };
    const parsed = parseArtifactResponse(response);
    if (parsed) entries.push({ response: parsed, photo: isPhoto(photo) ? photo : '', savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0 });
  }
  return entries;
}

/** Newest first; forging the same weapon from the same object again replaces the old entry. */
export function addToArmory(entries: readonly ArmoryEntry[], entry: ArmoryEntry): ArmoryEntry[] {
  const same = (e: ArmoryEntry) => e.response.artifact.artifactName === entry.response.artifact.artifactName && e.response.artifact.object === entry.response.artifact.object;
  return [entry, ...entries.filter((e) => !same(e))].slice(0, ARMORY_MAX);
}

/** Saves, dropping the oldest entries if the browser is out of space. Returns what was kept. */
export function writeArmory(store: ArmoryStore | undefined, entries: readonly ArmoryEntry[]): ArmoryEntry[] {
  for (let keep = entries.length; keep >= 0; keep--) {
    try { store?.setItem(ARMORY_KEY, JSON.stringify(entries.slice(0, keep))); return entries.slice(0, keep); } catch { /* quota: try with fewer */ }
  }
  return [];
}

export const weaponOf = (entry: ArmoryEntry): Weapon => makeWeapon(entry.response);
