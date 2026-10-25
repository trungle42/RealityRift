import * as T from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Actor } from './Actor';

/**
 * Each player's look follows their wand colour (the first `?wand=` colour, the same one Presence sends), so the three
 * laptops can tell each other apart: red is the ranger in a crimson cloak, blue the shieldmaiden in royal blue, yellow the
 * ranger in an ochre-gold cloak. The cloth is dyed in the texture itself (see `dyePixels`), so the weave, folds and wear
 * stay; skin, hair, leather and metal keep their own colours. Without `?wand=` the hero keeps today's undyed ranger.
 */
export type Avatar = 'ranger' | 'maiden' | 'crimson' | 'royal' | 'gold';
export const AVATAR_OF: Record<string, Avatar> = { red: 'crimson', blue: 'royal', yellow: 'gold' };
/** Unknown or missing colour: the ranger, today's look. */
export const avatarFor = (colour: string | undefined): Avatar => (colour && AVATAR_OF[colour]) || 'ranger';
/** Which character model a look is built on. */
export const modelOf = (avatar: Avatar): 'ranger' | 'maiden' => (avatar === 'maiden' || avatar === 'royal' ? 'maiden' : 'ranger');

/** This laptop's look: only an explicit `?wand=` picks one, so a plain link keeps today's ranger. */
export function localColour(search: string): string | undefined {
  const first = (new URLSearchParams(search).get('wand') ?? '').split(',')[0]?.trim().toLowerCase();
  return first && first in AVATAR_OF ? first : undefined;
}

/** The ranger has no sword moves of its own; the hollow warden's rig shares its bones, so it lends these. */
export const COMBAT_CLIPS = ['sword_idle', 'sword_slash_horizontal', 'sword_slash_overhead', 'sword_thrust', 'stagger_back'];
export const GOLD = 0xffb53d;
export interface AvatarModels { ranger: GLTF; combat: GLTF; maiden: GLTF }

/**
 * A cloth dye. `hues` picks the cloth by its hue in degrees (the ranger's cloak is olive to green, 62-175; skin and leather
 * sit below 60, so they are never touched); `grey` picks unsaturated, non-metal, mid-light pixels instead (the
 * shieldmaiden's cloth is grey, beside grey steel that the metal map tells apart). The cloth then takes `hue` and at least
 * `sat` saturation, and its own brightness times `gain`, so every fold and thread stays where it was.
 */
export interface Dye { hues?: [number, number]; grey?: boolean; hue: number; sat: number; gain: number }
export const DYES: Partial<Record<Avatar, Dye>> = {
  // The ranger's cloak is dark (brightness 0.16-0.20) and the maiden's cloth mid-dark (0.23-0.35), so the gains lift them
  // enough to read as crimson, gold and royal blue in the forest light; being multiplicative, they keep every fold's contrast.
  crimson: { hues: [62, 175], hue: 352, sat: 0.72, gain: 1.35 },
  gold: { hues: [62, 175], hue: 42, sat: 0.72, gain: 3 },
  royal: { grey: true, hue: 222, sat: 0.65, gain: 1.9 },
};

const smooth = (edge0: number, edge1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t); };

/** HSV (h in degrees, s and v 0..1) to 0..255 RGB. */
function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

/**
 * Dye RGBA pixels in place. `metal` is the matching metal/roughness texture's RGBA (metalness in blue), or undefined.
 * Pure, so it is unit tested; the edges of every window are soft, so dyed and undyed cloth meet without a seam.
 */
export function dyePixels(rgba: Uint8ClampedArray, dye: Dye, metal?: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, s = max > 0 ? d / max : 0, v = max;
    let weight: number;
    if (dye.hues) {
      if (d < 1e-6) continue;
      const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
      const [lo, hi] = dye.hues;
      weight = smooth(lo - 6, lo + 6, h) * (1 - smooth(hi - 6, hi + 6, h)) * smooth(0.08, 0.18, s) * smooth(0.03, 0.08, v);
    } else {
      const metalness = metal ? metal[i + 2] / 255 : 0;
      weight = (1 - smooth(0.08, 0.2, s)) * (1 - smooth(0.25, 0.45, metalness)) * smooth(0.12, 0.22, v) * (1 - smooth(0.85, 0.95, v));
    }
    if (weight <= 0.001) continue;
    const [nr, ng, nb] = hsv(dye.hue, Math.min(1, Math.max(dye.sat, s * 1.2)), Math.min(1, v * dye.gain));
    rgba[i] = r * 255 + (nr - r * 255) * weight; rgba[i + 1] = g * 255 + (ng - g * 255) * weight; rgba[i + 2] = b * 255 + (nb - b * 255) * weight;
  }
}

/** Dyed base-colour maps, one per look and source texture, made once at load and shared by every hero wearing that look. */
const dyed = new Map<string, T.Texture>();

function pixelsOf(image: CanvasImageSource & { width: number; height: number }, width: number, height: number): ImageData | undefined {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true }); if (!g) return undefined;
  g.drawImage(image, 0, 0, width, height); return g.getImageData(0, 0, width, height);
}

/** The base-colour map dyed for `avatar`: a clone of the original (same colorSpace, flipY, wrap and UV channel) on a dyed canvas. */
function dyedMap(map: T.Texture, metal: T.Texture | null, avatar: Avatar, dye: Dye): T.Texture | undefined {
  const key = `${map.uuid}:${avatar}`, cached = dyed.get(key); if (cached) return cached;
  const image = map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image?.width || !image.height) return undefined;   // compressed or not yet decoded: leave the cloth undyed
  const base = pixelsOf(image, image.width, image.height); if (!base) return undefined;
  const metalImage = metal?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const metalness = dye.grey && metalImage?.width ? pixelsOf(metalImage, image.width, image.height)?.data : undefined;
  dyePixels(base.data, dye, metalness);
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(base, 0, 0);
  // clone() shares the original's image Source, so setting .image would repaint the original and every other dye; give it its own.
  const texture = map.clone(); texture.source = new T.Source(canvas); texture.needsUpdate = true;
  dyed.set(key, texture); return texture;
}

/** Dress an Actor as `avatar`. The shieldmaiden carries her own sword clips; the ranger borrows the warden's. */
export function dressAvatar(actor: Actor, avatar: Avatar, models: AvatarModels): void {
  if (modelOf(avatar) === 'maiden') actor.useModel(clone(models.maiden.scene), models.maiden.animations, false);
  else actor.useModel(clone(models.ranger.scene), models.ranger.animations, false, models.combat.animations.filter((clip) => COMBAT_CLIPS.includes(clip.name)));
  const dye = DYES[avatar];
  if (dye) actor.root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
      const standard = mat as T.MeshStandardMaterial;   // useModel already gave this actor its own material copies
      if (!standard.map) continue;
      const map = dyedMap(standard.map, standard.metalnessMap, avatar, dye);
      if (map) { standard.map = map; standard.needsUpdate = true; }
    }
  });
  actor.root.userData.avatar = avatar;
}

/** Without the art pack: the built-in stand-in keeps its shape and wears the player's colour on its cloak. */
export function tintStandIn(actor: Actor, color: number): void {
  const cloak = actor.cloak.material as T.MeshStandardMaterial;
  actor.cloak.material = cloak.clone(); (actor.cloak.material as T.MeshStandardMaterial).color.set(color);
}
