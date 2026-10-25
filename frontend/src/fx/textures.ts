import { Graphics, Texture, type Renderer } from 'pixi.js';

/** Small procedural textures shared by particles, glows and ambient effects. */
export const textures: Record<'glow' | 'dot' | 'sparkle', Texture> = {
  glow: Texture.WHITE,
  dot: Texture.WHITE,
  sparkle: Texture.WHITE,
};

export function initTextures(renderer: Renderer): void {
  // Soft radial glow from stacked translucent circles.
  const glow = new Graphics();
  const rings = 24;
  for (let i = rings; i >= 1; i--) glow.circle(64, 64, (64 * i) / rings).fill({ color: 0xffffff, alpha: 0.06 });
  textures.glow = renderer.generateTexture(glow);

  const dot = new Graphics().circle(8, 8, 8).fill(0xffffff);
  textures.dot = renderer.generateTexture(dot);

  const sparkle = new Graphics().star(16, 16, 4, 16, 3).fill(0xffffff);
  textures.sparkle = renderer.generateTexture(sparkle);
}
