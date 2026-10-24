import { Graphics } from 'pixi.js';
import type { PoseId } from '../contracts';

export const POSE_LABELS: Record<PoseId, string> = {
  'arms-up': 'Arms to the Sky',
  't-pose': 'Spread Your Wings',
  crouch: 'Duck Low',
};

/** A glowing stick-figure card showing the pose to copy. Centered on (0, 0). */
export function poseIcon(pose: PoseId, color: number): Graphics {
  const g = new Graphics();
  g.roundRect(-70, -90, 140, 180, 16).fill({ color: 0x120a1e, alpha: 0.85 }).stroke({ width: 3, color });
  const line = { width: 7, color, cap: 'round' as const, join: 'round' as const };
  const crouch = pose === 'crouch';
  const hip = crouch ? 30 : 20;
  const neck = crouch ? -5 : -30;
  g.circle(0, neck - 18, 14).fill(color);
  g.moveTo(0, neck).lineTo(0, hip).stroke(line);
  if (crouch) g.moveTo(-26, 70).lineTo(-18, 48).lineTo(0, hip).lineTo(18, 48).lineTo(26, 70).stroke(line);
  else g.moveTo(-22, 72).lineTo(0, hip).lineTo(22, 72).stroke(line);
  const shoulder = neck + 8;
  if (pose === 'arms-up') g.moveTo(-26, shoulder - 44).lineTo(0, shoulder).lineTo(26, shoulder - 44).stroke(line);
  else if (pose === 't-pose') g.moveTo(-52, shoulder).lineTo(52, shoulder).stroke(line);
  else g.moveTo(-24, shoulder - 26).lineTo(0, shoulder).lineTo(24, shoulder - 26).stroke(line);
  return g;
}
