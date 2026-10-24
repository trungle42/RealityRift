import { Container, Graphics, Sprite } from 'pixi.js';
import type { BeatOutcome, ChallengeSpec, PlayerIndex } from '../contracts';
import { onFrame, tween, until, wait, ease } from '../core/clock';
import type { Stage } from '../game/Stage';
import { textures } from '../fx/textures';
import { drawParchment } from '../ui/NarrationPanel';
import { fonts, makeText, palette, PLAYER_COLORS, VIEW } from '../theme';

type VoteSpec = Extract<ChallengeSpec, { type: 'vote' }>;

const CARD_W = 300;
const CARD_H = 150;
const CARD_X = [VIEW.width / 2 - 200, VIEW.width / 2 + 200] as const;
const CARD_Y = 320;
/** Once both players agree, close the vote after this pause (so they can still change their minds). */
const SETTLE_SEC = 1.2;

export async function runVote(stage: Stage, beatId: string, spec: VoteSpec): Promise<BeatOutcome> {
  const { prompt, fx, sfx, ui, input } = stage;
  await prompt.show('Choose Together', `${spec.prompt}  (A / D  ·  ← / →)`);

  const cards = spec.options.map((opt, i) => {
    const c = new Container();
    const glow = new Sprite(textures.glow);
    glow.anchor.set(0.5);
    glow.tint = palette.gold;
    glow.blendMode = 'add';
    glow.scale.set(3, 2);
    glow.alpha = 0;
    const label = makeText(opt.label, { fontFamily: fonts.heading, fontWeight: '700', fontSize: 28, fill: palette.ink, align: 'center', wordWrap: true, wordWrapWidth: CARD_W - 40 });
    const arrow = makeText(i === 0 ? '◀' : '▶', { fontSize: 22, fill: palette.goldDeep });
    arrow.y = 46;
    c.addChild(glow, drawParchment(new Graphics(), -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H), label, arrow);
    c.position.set(CARD_X[i], CARD_Y);
    c.scale.set(0.3);
    c.alpha = 0;
    ui.addChildAt(c, 0);
    void tween(c, { alpha: 1 }, 0.3);
    void tween(c.scale, { x: 1, y: 1 }, 0.4, ease.outBack);
    return { container: c, glow };
  });

  // One gem per player that hops between cards.
  const gems = ([0, 1] as const).map((p) => {
    const g = new Container();
    const halo = new Sprite(textures.glow);
    halo.anchor.set(0.5);
    halo.tint = PLAYER_COLORS[p];
    halo.blendMode = 'add';
    halo.scale.set(0.5);
    const name = makeText(stage.name(p), { fontFamily: fonts.heading, fontWeight: '700', fontSize: 16, fill: PLAYER_COLORS[p], stroke: { color: 0x120818, width: 4 } });
    name.y = 26;
    g.addChild(halo, new Graphics().poly([0, -12, 10, 0, 0, 12, -10, 0]).fill(PLAYER_COLORS[p]).stroke({ width: 2, color: 0xffffff }), name);
    g.visible = false;
    ui.addChild(g);
    return g;
  });

  const votes: [number | null, number | null] = [null, null];
  const place = (p: PlayerIndex) => {
    const v = votes[p];
    if (v === null) return;
    const x = CARD_X[v] + (p === 0 ? -50 : 50);
    const y = CARD_Y + CARD_H / 2 + 36;
    if (!gems[p].visible) {
      gems[p].visible = true;
      gems[p].position.set(x, y);
      gems[p].scale.set(0.2);
      void tween(gems[p].scale, { x: 1, y: 1 }, 0.3, ease.outBack);
    } else {
      void tween(gems[p], { x, y }, 0.25, ease.outCubic);
    }
  };

  let settle = 0;
  const off = input.subscribe((e) => {
    if (e.player === null || (e.kind !== 'left' && e.kind !== 'right')) return;
    votes[e.player] = e.kind === 'left' ? 0 : 1;
    settle = 0;
    sfx.tick();
    place(e.player);
  });
  const offGlow = onFrame(() => {
    cards.forEach((c, i) => {
      const n = votes.filter((v) => v === i).length;
      c.glow.alpha += (n * 0.35 - c.glow.alpha) * 0.15;
    });
  });

  await until((dt, t) => {
    prompt.setTimer(1 - t / spec.timeLimitSec);
    if (votes[0] !== null && votes[0] === votes[1]) settle += dt;
    return t >= spec.timeLimitSec || settle >= SETTLE_SEC;
  });
  off();
  await prompt.hide();

  let winner: number;
  let how: string;
  if (votes[0] !== null && votes[0] === votes[1]) {
    winner = votes[0];
    how = 'Agreed!';
  } else if (votes[0] === null && votes[1] === null) {
    winner = Math.random() < 0.5 ? 0 : 1;
    how = 'Fate decides…';
  } else if (votes[0] === null || votes[1] === null) {
    winner = (votes[0] ?? votes[1]) as number;
    how = `${stage.name(votes[0] === null ? 1 : 0)} decides!`;
  } else {
    how = 'Fate breaks the tie…';
    winner = Math.random() < 0.5 ? 0 : 1;
    // Flicker between the two before landing.
    for (let i = 0; i < 9; i++) {
      cards.forEach((c, j) => (c.glow.alpha = j === i % 2 ? 0.9 : 0));
      sfx.tick();
      await wait(0.08 + i * 0.02);
    }
  }
  offGlow();

  const win = cards[winner].container;
  const lose = cards[1 - winner].container;
  cards[winner].glow.alpha = 0.9;
  void tween(lose, { alpha: 0.15 }, 0.4);
  void tween(win.scale, { x: 1.15, y: 1.15 }, 0.4, ease.outBack);
  fx.burst(win.x, win.y, palette.gold, { count: 50, speed: 320, size: 0.3, texture: textures.sparkle });
  fx.ring(win.x, win.y, palette.gold, 180);
  sfx.success();
  await stage.banner.show(how, spec.options[winner].label, 1.6);

  await Promise.all([...cards.map((c) => tween(c.container, { alpha: 0 }, 0.3)), ...gems.map((g) => tween(g, { alpha: 0 }, 0.3))]);
  cards.forEach((c) => c.container.destroy({ children: true }));
  gems.forEach((g) => g.destroy({ children: true }));

  const choice = spec.options[winner];
  const voted: [boolean, boolean] = [votes[0] === winner, votes[1] === winner];
  const summary = `${how.replace(/[!…]/g, '')}: the heroes chose "${choice.label}"`;
  return stage.outcome(beatId, 'vote', true, [0, 0], voted, 0, summary, choice.id);
}
