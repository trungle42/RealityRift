import { Container, Graphics, Sprite } from 'pixi.js';
import type { BeatOutcome, BossAttack, BossSpec, PlayerIndex } from '../contracts';
import { until, wait, tween } from '../core/clock';
import type { Stage } from '../game/Stage';
import { textures } from '../fx/textures';
import { Boss } from '../world/Boss';
import { Fairy } from '../world/Fairy';
import { FOE_X, GROUND_Y, HERO_X, palette } from '../theme';
import { StillnessWatch } from './freeze';
import { castCooldown } from './encounter';
import { heartsLostSince, initialBossHp, matchesPose } from '../game/rules';

const GAZE_SEC = 2.4;
const WAVE_SEC = 1.8;
const FAIRY_ZAP_SEC = 0.9;

const ATTACK_TEXT: Record<BossAttack, [string, string]> = {
  'frost-gaze': ['Frost Gaze', 'FREEZE when it strikes — any movement and you’re caught!'],
  'shadow-wave': ['Shadow Wave', 'DUCK LOW to let it pass over you!  (S  ·  ↓)'],
};

export async function runBoss(stage: Stage, beatId: string, spec: BossSpec): Promise<BeatOutcome> {
  const { prompt, fx, sfx, heroes, actors, input, bossBar, banner, state } = stage;
  const startingHearts = state.hearts;
  let active = true;

  const boss = new Boss(spec.kind);
  boss.position.set(FOE_X, GROUND_Y);
  boss.zIndex = GROUND_Y - 1;
  actors.addChild(boss);
  sfx.roar();
  fx.shake(14, 1.2);
  await boss.enter();
  await bossBar.show(spec.name);

  let hp = initialBossHp(spec.maxHp, state.has('boss-weaken'));
  if (state.has('boss-weaken')) {
    await wait(0.3);
    fx.floatText('Moonpetal Charm!  −25%', boss.x - 40, boss.y - 300, palette.gold, 30);
    fx.burst(boss.x, boss.y - 180, palette.gold, { count: 40, speed: 300, size: 0.3, texture: textures.sparkle });
    boss.hit(fx);
  }
  bossBar.set(hp / spec.maxHp);

  const fairy = state.has('fairy-ally') ? new Fairy((HERO_X[0] + HERO_X[1]) / 2, GROUND_Y - 230) : null;
  if (fairy) actors.addChild(fairy);

  const stars: [number, number] = [0, 0];
  const hits: [number, number] = [0, 0];
  const dodged: [number, number] = [0, 0];
  let attacksFaced = 0;
  let vulnerable = false;
  const cooldown: [number, number] = [0, 0];

  const damage = (amount: number, at: { x: number; y: number }) => {
    if (!active || state.defeated || hp <= 0 || boss.destroyed) return;
    hp = Math.max(0, hp - amount);
    bossBar.set(hp / spec.maxHp);
    boss.hit(fx);
    sfx.impact();
    fx.floatText(`-${amount}`, at.x, at.y - 20, 0xffffff, 26);
  };

  const off = input.subscribe((e) => {
    if (!active || state.defeated || e.kind !== 'cast' || e.player === null || hp <= 0) return;
    const p: PlayerIndex = e.player;
    if (cooldown[p] > 0) return;
    cooldown[p] = castCooldown(stage);
    const tip = heroes[p].cast();
    sfx.zap();
    const target = boss.hitPoint();
    if (!vulnerable) {
      // Bounces off the boss's ward.
      void fx.bolt(tip.x, tip.y, target.x - 120, target.y, heroes[p].color, 0.35).then(() => fx.floatText('Warded!', target.x - 120, target.y - 30, 0xbfc8ff, 22));
      return;
    }
    void fx.bolt(tip.x, tip.y, target.x, target.y, heroes[p].color, 0.35).then(() => {
      if (!active || state.defeated || hp <= 0) return;
      damage(1, target);
      hits[p]++;
      if (hits[p] % 3 === 0) {
        stage.awardStar(p);
        stars[p]++;
      }
    });
  });
  const tickCooldowns = (dt: number) => {
    cooldown[0] = Math.max(0, cooldown[0] - dt);
    cooldown[1] = Math.max(0, cooldown[1] - dt);
  };

  let round = 0;
  while (hp > 0 && !state.defeated) {
    const attack = spec.attacks[round++ % spec.attacks.length];
    attacksFaced++;

    // Telegraph.
    const [title, detail] = ATTACK_TEXT[attack];
    boss.setCharging(true);
    await prompt.show(title, detail);
    await until((dt, t) => {
      tickCooldowns(dt);
      prompt.setTimer(1 - t / spec.telegraphSec, 0xb06bff);
      return t >= spec.telegraphSec;
    });
    boss.setCharging(false);

    // Resolve.
    const caught = attack === 'frost-gaze' ? await frostGaze(stage, boss, tickCooldowns) : await shadowWave(stage, boss, tickCooldowns);
    await prompt.hide();
    if (caught.length > 0) {
      stage.loseHeart();
    } else {
      sfx.chime();
    }
    for (const p of [0, 1] as const) {
      if (caught.includes(p)) continue;
      dodged[p]++;
      heroes[p].setMark('ok');
      stage.awardStar(p);
      stars[p]++;
    }
    await wait(0.8);
    heroes.forEach((h) => h.setMark(null));
    await stage.resetHeroes();
    if (state.defeated) break;

    // Window of vulnerability.
    vulnerable = true;
    boss.setStaggered(true);
    void banner.show('Strike Now!', '', 0.9, palette.gold);
    await prompt.show('It Falters!', 'CAST your spells!  (W  ·  ↑)');
    let fairyTimer = FAIRY_ZAP_SEC;
    await until((dt, t) => {
      tickCooldowns(dt);
      prompt.setTimer(1 - t / spec.vulnerableSec);
      if (fairy) {
        fairyTimer -= dt;
        if (fairyTimer <= 0 && hp > 0) {
          fairyTimer = FAIRY_ZAP_SEC;
          const target = boss.hitPoint();
          void fx.bolt(fairy.x, fairy.y, target.x, target.y, palette.fairy, 0.4).then(() => damage(1, target));
        }
      }
      return t >= spec.vulnerableSec || hp <= 0;
    });
    vulnerable = false;
    boss.setStaggered(false);
    await prompt.hide();
    await wait(0.4);
  }
  active = false;
  off();

  const victory = hp <= 0;
  if (victory) {
    await bossBar.hide();
    sfx.roar();
    await boss.defeat(fx);
    await stage.conclude(true, 'Victory!', `${spec.name} is defeated!`);
  } else {
    boss.setCharging(true);
    await stage.conclude(false, 'Overwhelmed…', 'The darkness is too strong');
    await Promise.all([bossBar.hide(), tween(boss, { alpha: 0 }, 1)]);
  }
  boss.destroy();
  fairy?.destroy();

  const summary = victory
    ? `They defeated ${spec.name} after ${attacksFaced} attacks (${stage.name(0)} landed ${hits[0]} spells, ${stage.name(1)} landed ${hits[1]})`
    : `${spec.name} overwhelmed them with ${hp} health remaining`;
  return stage.outcome(beatId, 'boss', victory, stars, [dodged[0] > 0 || hits[0] > 0, dodged[1] > 0 || hits[1] > 0], heartsLostSince(startingHearts, state.hearts), summary);
}

/** Icy beams sweep the party; anyone moving gets frozen. */
async function frostGaze(stage: Stage, boss: Boss, tick: (dt: number) => void): Promise<PlayerIndex[]> {
  const { fx, sfx, heroes, actors } = stage;
  sfx.freeze();
  fx.flash(palette.frost, 0.4, 0.5);
  void fx.setFrost(0.75, 0.5);
  void stage.banner.show('FREEZE!', '', 0.8, palette.frost);
  const origin = boss.attackOrigin();
  const beams = new Graphics();
  beams.blendMode = 'add';
  actors.addChild(beams);
  beams.zIndex = 10_000;

  const watch = new StillnessWatch(stage, 0.3);
  const caught: PlayerIndex[] = [];
  await until((dt, t) => {
    tick(dt);
    caught.push(...watch.step(dt));
    beams.clear();
    for (const h of heroes) {
      const sway = Math.sin(t * 9 + h.x) * 18;
      beams.moveTo(origin.x, origin.y).lineTo(h.x - 30 + sway, h.y - 60).lineTo(h.x + 30 + sway, h.y - 60).closePath().fill({ color: palette.frost, alpha: 0.18 });
    }
    if (Math.random() < 0.5) {
      const h = heroes[Math.floor(Math.random() * 2)];
      fx.spawn(textures.sparkle, h.x + (Math.random() - 0.5) * 80, h.y - Math.random() * 140, palette.frost, 0, -20, 0.6, 0.3);
    }
    return t >= GAZE_SEC;
  });
  beams.destroy();
  void fx.setFrost(0, 0.6);
  heroes.forEach((h) => h.setMeter(null));
  return caught;
}

/** A wall of shadow rolls across the ground at head height; crouch to let it pass. */
async function shadowWave(stage: Stage, boss: Boss, tick: (dt: number) => void): Promise<PlayerIndex[]> {
  const { fx, sfx, heroes, actors, input } = stage;
  sfx.roar();
  void stage.banner.show('DUCK!', '', 0.8, 0xc58bff);
  const wave = new Container();
  const waveGlow = new Sprite(textures.glow);
  waveGlow.anchor.set(0.5);
  waveGlow.tint = 0x7a2fd0;
  wave.scale.set(1.1, 1.6);
  const core = new Graphics()
    .moveTo(-30, -70).quadraticCurveTo(40, 0, -30, 70).quadraticCurveTo(0, 0, -30, -70).fill({ color: 0x1a0828, alpha: 0.9 });
  wave.addChild(waveGlow, core);
  const startX = boss.x - 120;
  const endX = -120;
  wave.position.set(startX, GROUND_Y - 120);
  wave.zIndex = 10_000;
  actors.addChild(wave);

  const caught: PlayerIndex[] = [];
  const passed: [boolean, boolean] = [false, false];
  await until((dt, t) => {
    tick(dt);
    wave.x = startX + (endX - startX) * Math.min(1, t / WAVE_SEC);
    wave.rotation = Math.sin(t * 20) * 0.05;
    fx.spawn(textures.glow, wave.x + 20, wave.y + (Math.random() - 0.5) * 120, 0x7a2fd0, 120, 0, 0.5, 0.3);
    for (const p of [0, 1] as const) {
      if (passed[p] || wave.x > heroes[p].x + 20) continue;
      passed[p] = true;
      if (matchesPose(input.read(p), 'crouch')) {
        fx.floatText('Dodged!', heroes[p].x, heroes[p].y - 170, 0xd6b8ff, 24);
      } else {
        caught.push(p);
        heroes[p].setMark('fail');
        void heroes[p].hurt();
        fx.burst(heroes[p].x, heroes[p].y - 100, 0x7a2fd0, { count: 30, speed: 260, size: 0.3 });
        fx.shake(10, 0.3);
      }
    }
    return t >= WAVE_SEC;
  });
  wave.destroy({ children: true });
  return caught;
}
