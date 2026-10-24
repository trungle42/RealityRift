import { Assets, type Texture } from 'pixi.js';

const names = ['forest', 'castle', 'cave', 'witch', 'dragon', 'wisp', 'imp',
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
}

export function art(name: string): Texture {
  const texture = loaded.get(name);
  if (!texture) throw new Error(`Missing game artwork: ${name}`);
  return texture;
}
