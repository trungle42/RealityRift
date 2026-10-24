import type { EnvironmentId, StoryBeat } from '../contracts';
import type { Obstacle, Point } from './navigation';

export interface Landmark extends Point {
  id: string;
  name: string;
  kind: 'chest' | 'shrine' | 'lore' | 'portal' | 'quest';
  destination?: EnvironmentId;
  detail?: string;
}
export const REGIONS: Record<EnvironmentId, { name: string; subtitle: string; color: number; obstacles: Obstacle[]; landmarks: Landmark[] }> = {
  forest: {
    name: 'Whispering Wood', subtitle: 'Where the old magic still remembers', color: 0xa2e5bc,
    obstacles: [{ x: 520, y: 510, radius: 30 }, { x: 850, y: 565, radius: 25 }],
    landmarks: [
      { id: 'chest', kind: 'chest', name: 'Mossbound cache', x: 290, y: 458 },
      { id: 'shrine', kind: 'shrine', name: 'Moonwell', x: 415, y: 603 },
      { id: 'lore', kind: 'lore', name: 'Willow, the waykeeper', x: 665, y: 420, detail: 'The Witch stole our spring, but she could not steal our kindness. Search the wood for a Moonpetal Charm. Follow the golden beacon when you are ready. The old crossings will open after you choose your path.' },
      { id: 'castle', kind: 'portal', name: 'Rosewater Castle', destination: 'castle', x: 1060, y: 433 },
      { id: 'cave', kind: 'portal', name: 'Crystal Caves', destination: 'cave', x: 1090, y: 590 },
    ],
  },
  castle: {
    name: 'Rosewater Castle', subtitle: 'A kingdom held between dusk and winter', color: 0xe9cb96,
    obstacles: [{ x: 505, y: 485, radius: 28 }, { x: 850, y: 555, radius: 30 }],
    landmarks: [
      { id: 'chest', kind: 'chest', name: 'Royal coffer', x: 750, y: 435 },
      { id: 'shrine', kind: 'shrine', name: 'Spring of remembrance', x: 375, y: 600 },
      { id: 'lore', kind: 'lore', name: 'Willow’s echo', x: 625, y: 590, detail: 'Morwen hides behind a ward. Watch her warning: stand still for frost, crouch beneath shadow. Cast only when the ward falls. A small act of kindness can bring a powerful ally.' },
      { id: 'forest', kind: 'portal', name: 'Whispering Wood', destination: 'forest', x: 170, y: 450 },
    ],
  },
  cave: {
    name: 'Crystal Caves', subtitle: 'Listen closely. The mountain is alive.', color: 0x8fdfe9,
    obstacles: [{ x: 500, y: 540, radius: 34 }, { x: 810, y: 470, radius: 28 }],
    landmarks: [
      { id: 'chest', kind: 'chest', name: 'Starlight cache', x: 1030, y: 595 },
      { id: 'shrine', kind: 'shrine', name: 'Luminous spring', x: 355, y: 450 },
      { id: 'lore', kind: 'lore', name: 'Willow’s echo', x: 685, y: 610, detail: 'Umbraxis sleeps beyond the crystal seal. Its shadows cannot touch a hero who ducks in time. The springs restore one heart, once per region. Save their magic until you need it.' },
      { id: 'forest', kind: 'portal', name: 'Whispering Wood', destination: 'forest', x: 165, y: 565 },
    ],
  },
};

export function questFor(beat: StoryBeat): Landmark {
  const byId: Record<string, [string, number, number]> = {
    intro: ['Read the ancient waystone', 760, 515],
    'frost-spell': ['Investigate the frozen grove', 950, 475],
    'spirit-gift': ['Meet the forest spirit', 640, 440],
    'shadow-ambush': ['Dispel the gathering shadows', 930, 535],
    crossroads: ['Choose a path at the crossroads', 980, 520],
    gate: ['Unseal the ancient gate', 940, 420],
    'thorn-guard': ['Drive back the thorn guard', 910, 520],
    'lantern-fairy': ['Find the captive lantern fairy', 590, 440],
    'fairy-joins': ['Welcome Pip to your party', 685, 480],
    'hurry-on': ['Retrieve the fallen wand', 700, 520],
    boss: ['Enter the final sanctum', 1030, 490],
  };
  const [name, x, y] = byId[beat.id] ?? [beat.boss ? 'Confront the guardian' : beat.speaker ? `Meet ${beat.speaker}` : 'Investigate the golden beacon', 940, 510];
  return { id: beat.id, kind: 'quest', name, x, y };
}

/** Per-adventure progress; separate from the Dev 2 story-provider contract. */
export class CampaignProgress {
  region: EnvironmentId = 'forest';
  readonly unlocked = new Set<EnvironmentId>(['forest']);
  readonly collected = new Set<string>();
  readonly defeated = new Set<string>();
  readonly completed: string[] = [];
  unlock(beat: StoryBeat): void { this.unlocked.add(beat.environment); }
  claim(id: string): boolean {
    if (this.collected.has(id)) return false;
    this.collected.add(id); return true;
  }
}
