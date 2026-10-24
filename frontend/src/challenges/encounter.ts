import type { BeatOutcome, EncounterSpec, PlayerIndex } from '../contracts';
import { until, wait } from '../core/clock';
import { rand } from '../core/math';
import type { Stage } from '../game/Stage';
import { Enemy } from '../world/Enemy';
import { GROUND_Y, HERO_X, VIEW } from '../theme';
import { heartsLostSince } from '../game/rules';

const BASE_SPEED = 80;
const BASE_INTERVAL = 1.6;
/** Enemies that get this close to the front hero land a hit. */
const REACH_X = HERO_X[1] + 60;

export function castCooldown(stage: Stage): number {
  return stage.state.has('quick-cast') ? 0.25 : 0.5;
}

export async function runEncounter(stage: Stage, beatId: string, spec: EncounterSpec): Promise<BeatOutcome> {
  const { prompt, fx, sfx, heroes, actors, input } = stage;
  const startingHearts = stage.state.hearts;
  let active = true;
  const label = spec.enemy === 'shadow-wisp' ? 'Shadow Wisps' : 'Thorn Imps';
  await prompt.show(`Ambush · ${label}`, 'Cast spells to drive them back!  (W  ·  ↑)');

  const enemies: Enemy[] = [];
  /** Enemies already targeted by a bolt in flight, so the second player aims at the next one. */
  const doomed = new Set<Enemy>();
  const cooldown: [number, number] = [0, 0];
  const kills: [number, number] = [0, 0];
  let spawned = 0;
  let spawnTimer = 0.4;
  let heartsLost = 0;
  let inFlight = 0;

  const off = input.subscribe((e) => {
    if (!active || stage.state.defeated || e.kind !== 'cast' || e.player === null) return;
    const p: PlayerIndex = e.player;
    if (cooldown[p] > 0) return;
    cooldown[p] = castCooldown(stage);
    const tip = heroes[p].cast();
    sfx.zap();
    const target = enemies.filter((en) => en.alive && !doomed.has(en)).sort((a, b) => a.x - b.x)[0];
    if (!target) {
      void fx.bolt(tip.x, tip.y, tip.x + 380, tip.y - 40, heroes[p].color, 0.4);
      return;
    }
    doomed.add(target);
    inFlight++;
    // Lead the target slightly since it keeps walking.
    void fx.bolt(tip.x, tip.y, target.x - 20, target.y - 45, heroes[p].color, 0.35).then(() => {
      inFlight--;
      if (!active || stage.state.defeated || !target.alive) return;
      target.dissolve(fx);
      sfx.impact();
      kills[p]++;
      stage.awardStar(p);
    });
  });

  await until((dt) => {
    cooldown[0] = Math.max(0, cooldown[0] - dt);
    cooldown[1] = Math.max(0, cooldown[1] - dt);

    spawnTimer -= dt;
    if (spawned < spec.count && spawnTimer <= 0) {
      spawnTimer = BASE_INTERVAL / spec.speed;
      const enemy = new Enemy(spec.enemy);
      enemy.position.set(VIEW.width + 60, GROUND_Y + rand(-6, 24));
      enemy.zIndex = enemy.y;
      actors.addChild(enemy);
      enemies.push(enemy);
      spawned++;
    }

    for (const enemy of enemies) {
      if (!enemy.alive || stage.state.defeated) continue;
      enemy.x -= BASE_SPEED * spec.speed * dt;
      enemy.animate();
      if (enemy.x <= REACH_X) {
        enemy.dissolve(fx);
        heartsLost++;
        stage.loseHeart();
        heroes.forEach((h) => void h.hurt());
      }
    }
    const remaining = enemies.some((en) => en.alive);
    return stage.state.defeated || (spawned >= spec.count && !remaining && inFlight === 0);
  });
  active = false;
  off();
  enemies.filter((en) => en.alive).forEach((en) => en.dissolve(fx));
  await wait(0.4);
  await prompt.hide();

  const success = heartsLost === 0;
  await stage.conclude(success, success ? 'Driven Back!' : 'They Got Through!', `${kills[0] + kills[1]} of ${spec.count} defeated`);
  await stage.resetHeroes();

  const summary = `${stage.name(0)} defeated ${kills[0]} and ${stage.name(1)} defeated ${kills[1]} ${label.toLowerCase()}${heartsLost ? `; ${heartsLost} got through` : ''}`;
  return stage.outcome(beatId, 'encounter', success, kills, [kills[0] > 0, kills[1] > 0], heartsLostSince(startingHearts, stage.state.hearts), summary);
}
