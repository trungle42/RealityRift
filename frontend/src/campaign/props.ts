import { Container, Graphics, Sprite } from 'pixi.js';
import { textures } from '../fx/textures';
import { makeText, palette } from '../theme';
import { art } from '../world/art';
import type { Landmark } from './locations';
import { depthScale } from './navigation';

const HEIGHT = { chest: 68, shrine: 98, portal: 180, quest: 130, lore: 165 };

/** Rendered world objects share the heroes' perspective, ground plane and depth order. */
export function landmarkView(item: Landmark, used: boolean, locked: boolean): Container {
  const root = new Container();
  root.position.set(item.x, item.y); root.zIndex = item.y; root.scale.set(depthScale(item.y));
  const shadow = new Sprite(textures.glow);
  shadow.anchor.set(0.5); shadow.tint = 0x000000; shadow.scale.set(0.9, 0.18); shadow.alpha = 0.7;
  const body = new Sprite(art(`prop-${item.kind}`)); body.anchor.set(0.5, 1);
  body.scale.set(HEIGHT[item.kind] / body.texture.height);
  if (used && item.kind !== 'lore') body.tint = 0x899f91;
  if (locked) { body.tint = 0x50685b; body.alpha = 0.8; }
  if (item.kind === 'lore') body.alpha = 0.8;
  const color = locked ? 0x9ba99b : item.kind === 'quest' ? palette.gold : item.kind === 'shrine' ? 0xaeece9 : 0xc3e5bf;
  root.addChild(shadow, body);
  if (item.kind === 'quest') {
    const beam = new Graphics();
    for (let i = 0; i < 7; i++) beam.rect(-12 + i, -230, 24 - i * 2, 150).fill({ color, alpha: 0.015 });
    beam.ellipse(0, 0, 42, 11).stroke({ color, alpha: 0.5, width: 1 });
    root.addChild(beam);
  }
  const label = makeText(`${locked ? '◇ ' : used ? '✓ ' : item.kind === 'quest' ? '◆ ' : ''}${item.name}`, {
    fontSize: 17, fill: color, stroke: { color: 0x07180f, width: 5 }, align: 'center', wordWrap: true, wordWrapWidth: 230,
  });
  label.position.set(0, -HEIGHT[item.kind] - 22); root.addChild(label);
  root.eventMode = 'static'; root.cursor = 'pointer';
  return root;
}

export function pillar(x: number, y: number, radius: number, cave: boolean): Container {
  const root = new Container(); root.position.set(x, y); root.zIndex = y;
  const shadow = new Sprite(textures.glow); shadow.anchor.set(0.5); shadow.tint = 0x000000;
  shadow.scale.set((radius + 14) / 60, 0.13); shadow.alpha = 0.6;
  const body = new Sprite(art('prop-pillar')); body.anchor.set(0.5, 1);
  body.scale.set((radius * 2 + 15) / body.texture.width);
  if (cave) body.tint = 0x96c9e4;
  root.addChild(shadow, body); return root;
}
