import { Assets, Rectangle, Texture } from 'pixi.js';
import { MOTION_CLIPS } from './animation';

const names = ['forest', 'castle', 'cave', 'forest-field', 'castle-field', 'cave-field', 'ranger-motion', 'mage-motion', 'witch', 'dragon', 'wisp', 'imp',
  ...['chest', 'shrine', 'portal', 'quest', 'pillar', 'lore'].map((name) => `prop-${name}`),
  ...['ranger', 'mage'].flatMap((hero) => ['idle', 'arms-up', 't-pose', 'crouch'].map((pose) => `${hero}-${pose}`))];
const loaded = new Map<string, Texture>();

/** All artwork is local: the game never needs an image-generation service at runtime. */
export async function loadArt(progress: (fraction: number) => void): Promise<void> {
  let complete = 0;
  await Promise.all(names.map(async (name) => {
    const texture = await Assets.load<Texture>(`${import.meta.env.BASE_URL}art/${name}.webp`);
    loaded.set(name, texture);
    progress(++complete / names.length);
  }));
  for (const hero of ['ranger', 'mage']) {
    const atlas = loaded.get(`${hero}-motion`)!;
    MOTION_CLIPS.forEach((clip, row) => {
      for (let frame = 0; frame < 5; frame++) loaded.set(`${hero}-${clip}-${frame}`, new Texture({ source: atlas.source, frame: new Rectangle(frame * 256, row * 256, 256, 256) }));
    });
  }
}

export function art(name: string): Texture {
  const texture = loaded.get(name);
  if (!texture) throw new Error(`Missing game artwork: ${name}`);
  return texture;
}
