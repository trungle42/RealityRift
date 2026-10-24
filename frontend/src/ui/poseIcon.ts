import { Container, Graphics, Sprite } from 'pixi.js';
import type { PoseId } from '../contracts';
import { art } from '../world/art';
import { makeText, fonts } from '../theme';

export const POSE_LABELS: Record<PoseId, string> = {
  'arms-up': 'Arms to the Sky',
  't-pose': 'Spread Your Wings',
  crouch: 'Duck Low',
};

/** Show a dimensional hero as the pose reference, matching the playable characters. */
export function poseIcon(pose: PoseId, color: number): Container {
  const card = new Container();
  const plate = new Graphics().roundRect(-105, -124, 210, 250, 3)
    .fill({ color: 0x081c16, alpha: 0.9 }).stroke({ width: 1, color, alpha: 0.7 });
  const hero = new Sprite(art(`ranger-${pose}`));
  hero.anchor.set(0.5, 1);
  hero.scale.set(Math.min(175 / hero.texture.height, 170 / hero.texture.width));
  hero.y = 82;
  const label = makeText('MIRROR THE SHAPE', { fontFamily: fonts.heading, fontSize: 11, letterSpacing: 1.4, fill: color });
  label.y = -104;
  card.addChild(plate, hero, label);
  return card;
}
