import { Container, Sprite } from 'pixi.js';
import type { BeatOutcome, ChallengeSpec } from '../contracts';
import { tween, until, wait, ease } from '../core/clock';
import type { Stage } from '../game/Stage';
import { textures } from '../fx/textures';
import { poseIcon, POSE_LABELS } from '../ui/poseIcon';
import { palette, VIEW } from '../theme';

type PoseSpec = Extract<ChallengeSpec, { type: 'pose' }>;

const HOLD_SEC = 0.6;

export async function runPose(stage: Stage, beatId: string, spec: PoseSpec): Promise<BeatOutcome> {
  const { prompt, fx, sfx, heroes, ui } = stage;
  const stars: [number, number] = [0, 0];
  let roundsPassed = 0;

  for (let round = 0; round < spec.poses.length; round++) {
    const pose = spec.poses[round];
    await prompt.show(`Shape ${round + 1} of ${spec.poses.length}`, `${POSE_LABELS[pose]} — hold it!`);

    const card = new Container();
    const glow = new Sprite(textures.glow);
    glow.anchor.set(0.5);
    glow.tint = palette.gold;
    glow.blendMode = 'add';
    glow.scale.set(2.4);
    glow.alpha = 0.4;
    card.addChild(glow, poseIcon(pose, palette.gold));
    card.position.set(VIEW.width / 2 + 40, 330);
    card.scale.set(0.2);
    ui.addChildAt(card, 0);
    sfx.chime();
    await tween(card.scale, { x: 1, y: 1 }, 0.35, ease.outBack);

    const hold: [number, number] = [0, 0];
    const locked: [boolean, boolean] = [false, false];
    await until((dt, t) => {
      prompt.setTimer(1 - t / spec.secondsPerPose);
      for (const p of [0, 1] as const) {
        if (locked[p]) continue;
        const matching = stage.input.read(p).pose === pose;
        hold[p] = matching ? hold[p] + dt : Math.max(0, hold[p] - dt * 2);
        heroes[p].setMeter(hold[p] / HOLD_SEC);
        if (hold[p] >= HOLD_SEC) {
          locked[p] = true;
          heroes[p].setMeter(null);
          heroes[p].setMark('ok');
          fx.burst(heroes[p].x, heroes[p].y - 80, heroes[p].color, { count: 24, speed: 200, size: 0.25, texture: textures.sparkle });
          stage.awardStar(p);
          stars[p]++;
          sfx.chime();
        }
      }
      return (locked[0] && locked[1]) || t >= spec.secondsPerPose;
    });

    const passed = locked[0] && locked[1];
    if (passed) {
      roundsPassed++;
      fx.burst(card.x, card.y, palette.gold, { count: 40, speed: 300, size: 0.3, texture: textures.sparkle });
      fx.ring(card.x, card.y, palette.gold, 140);
      sfx.success();
    } else {
      for (const p of [0, 1] as const) if (!locked[p]) heroes[p].setMark('fail');
      sfx.fail();
    }
    await Promise.all([tween(card, { alpha: 0 }, 0.4), tween(card.scale, { x: passed ? 1.4 : 0.6, y: passed ? 1.4 : 0.6 }, 0.4)]);
    card.destroy({ children: true });
    await wait(0.5);
    heroes.forEach((h) => {
      h.setMark(null);
      h.setMeter(null);
    });
  }

  await prompt.hide();
  const needed = Math.ceil(spec.poses.length * 0.6);
  const success = roundsPassed >= needed;
  if (!success) stage.loseHeart();
  await stage.conclude(success, success ? 'The Seal Opens!' : 'The Magic Rejects You!', `${roundsPassed} of ${spec.poses.length} shapes matched`);

  const summary = `The heroes matched ${roundsPassed} of ${spec.poses.length} magic poses (${stage.name(0)}: ${stars[0]}, ${stage.name(1)}: ${stars[1]})`;
  const half = spec.poses.length / 2;
  return stage.outcome(beatId, 'pose', success, stars, [stars[0] >= half, stars[1] >= half], success ? 0 : 1, summary);
}
