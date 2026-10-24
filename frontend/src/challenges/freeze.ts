import type { BeatOutcome, ChallengeSpec, PlayerIndex } from '../contracts';
import { until, wait } from '../core/clock';
import type { Stage } from '../game/Stage';
import { textures } from '../fx/textures';
import { palette } from '../theme';

type FreezeSpec = Extract<ChallengeSpec, { type: 'freeze' }>;

/** How long a player may keep moving before the spell catches them. */
export const CATCH_SEC = 0.3;

/**
 * Tracks stillness for both players. Shared by the freeze challenge and the
 * boss's frost-gaze attack.
 */
export class StillnessWatch {
  readonly caught: [boolean, boolean] = [false, false];
  private readonly strain: [number, number] = [0, 0];

  constructor(private readonly stage: Stage, private readonly tolerance: number) {}

  /** Returns the players caught this frame. */
  step(dt: number): PlayerIndex[] {
    const newlyCaught: PlayerIndex[] = [];
    for (const p of [0, 1] as const) {
      if (this.caught[p]) continue;
      const hero = this.stage.heroes[p];
      const moving = this.stage.input.read(p).motion > this.tolerance;
      this.strain[p] = moving ? this.strain[p] + dt : Math.max(0, this.strain[p] - dt * 0.5);
      hero.setMeter(1 - this.strain[p] / CATCH_SEC, palette.frost);
      if (this.strain[p] >= CATCH_SEC) {
        this.caught[p] = true;
        newlyCaught.push(p);
        hero.setMeter(null);
        hero.setMark('fail');
        hero.setFrozen(true);
        void hero.hurt();
        this.stage.fx.burst(hero.x, hero.y - 80, palette.frost, { count: 30, speed: 220, size: 0.3, texture: textures.sparkle });
      }
    }
    return newlyCaught;
  }
}

export async function runFreeze(stage: Stage, beatId: string, spec: FreezeSpec): Promise<BeatOutcome> {
  const { prompt, banner, fx, sfx, heroes } = stage;
  await prompt.show('Freeze Spell', spec.prompt);
  for (const n of ['3', '2', '1']) {
    sfx.tick();
    void banner.show(n, '', 0.45);
    await wait(0.7);
  }

  sfx.freeze();
  fx.flash(palette.frost, 0.55, 0.6);
  void banner.show('FREEZE!', 'Don’t move a muscle…', 1, palette.frost);
  void fx.setFrost(0.9, 1);

  const watch = new StillnessWatch(stage, spec.tolerance);
  let heartLost = false;
  await until((dt, t) => {
    prompt.setTimer(1 - t / spec.durationSec, palette.frost);
    if (watch.step(dt).length > 0 && !heartLost) {
      heartLost = true;
      stage.loseHeart();
    }
    return t >= spec.durationSec;
  });

  await fx.setFrost(0, 0.8);
  const stars: [number, number] = [0, 0];
  for (const p of [0, 1] as const) {
    if (watch.caught[p]) continue;
    heroes[p].setMark('ok');
    stage.awardStar(p);
    stars[p] = 1;
  }
  await prompt.hide();
  const success = !watch.caught[0] && !watch.caught[1];
  await stage.conclude(success, success ? 'The Frost Passes!' : 'The Curse Takes Hold!');
  await stage.resetHeroes();

  const caughtNames = ([0, 1] as const).filter((p) => watch.caught[p]).map((p) => stage.name(p));
  const summary = success
    ? `${stage.name(0)} and ${stage.name(1)} held perfectly still through the freeze spell`
    : `${caughtNames.join(' and ')} moved during the freeze spell`;
  return stage.outcome(beatId, 'freeze', success, stars, [!watch.caught[0], !watch.caught[1]], heartLost ? 1 : 0, summary);
}
