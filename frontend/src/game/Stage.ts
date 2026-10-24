import { Container, Graphics, type Text } from 'pixi.js';
import type { BeatOutcome, EnvironmentId, InputSource, OutcomeKind, PlayerIndex, RewardSpec } from '../contracts';
import type { Narrator } from '../audio/Narrator';
import type { Sfx } from '../audio/Sfx';
import { onFrame, now, tween, wait, ease } from '../core/clock';
import { Effects } from '../fx/Effects';
import { textures } from '../fx/textures';
import { Banner } from '../ui/Banner';
import { BossBar } from '../ui/BossBar';
import { Hud } from '../ui/Hud';
import { NarrationPanel } from '../ui/NarrationPanel';
import { PromptCard } from '../ui/PromptCard';
import { Backdrop } from '../world/Backdrop';
import { Hero } from '../world/Hero';
import { fonts, GROUND_Y, HERO_X, makeText, palette, VIEW } from '../theme';
import { GameState, MAX_HEARTS } from './GameState';

/**
 * Everything on screen plus the shared rules every challenge uses
 * (losing hearts, awarding stars, granting rewards).
 */
export class Stage {
  /** Letterboxed to the window. */
  readonly root = new Container();
  /** Shakes as one piece. */
  readonly world = new Container();
  readonly backdrop = new Backdrop();
  readonly actors = new Container();
  readonly fx: Effects;
  readonly ui = new Container();
  readonly hud = new Hud(MAX_HEARTS);
  readonly narration: NarrationPanel;
  readonly banner = new Banner();
  readonly prompt = new PromptCard();
  readonly bossBar = new BossBar();
  readonly heroes: [Hero, Hero] = [new Hero(0), new Hero(1)];
  /** Full-screen layer for title, party setup and storybook. */
  readonly screens = new Container();
  state!: GameState;
  private readonly thinking: Text;

  constructor(readonly input: InputSource, readonly sfx: Sfx, readonly narrator: Narrator) {
    this.fx = new Effects(this.world);
    this.narration = new NarrationPanel(input, narrator);
    this.actors.sortableChildren = true;

    this.heroes.forEach((h, i) => {
      h.position.set(HERO_X[i], GROUND_Y);
      h.zIndex = GROUND_Y + i;
      this.actors.addChild(h);
    });

    this.thinking = makeText('The storyteller ponders…', { fontFamily: fonts.body, fontStyle: 'italic', fontSize: 24, fill: palette.parchment, stroke: { color: 0x120818, width: 5 } });
    this.thinking.position.set(VIEW.width / 2, 640);
    this.thinking.alpha = 0;

    this.world.addChild(this.backdrop, this.actors, this.fx.layer);
    this.ui.addChild(this.hud, this.bossBar, this.prompt, this.banner, this.narration, this.thinking);
    const mask = new Graphics().rect(0, 0, VIEW.width, VIEW.height).fill(0xffffff);
    this.root.addChild(this.world, this.fx.overlay, this.ui, this.screens, mask);
    this.root.mask = mask;

    // Heroes always mirror what the players are doing.
    onFrame(() => {
      this.heroes.forEach((h, i) => h.setPose(this.input.read(i as PlayerIndex).pose));
      if (this.thinking.alpha > 0) this.thinking.scale.set(1 + Math.sin(now() * 4) * 0.03);
    });
  }

  layout(screenWidth: number, screenHeight: number): void {
    const s = Math.min(screenWidth / VIEW.width, screenHeight / VIEW.height);
    this.root.scale.set(s);
    this.root.position.set((screenWidth - VIEW.width * s) / 2, (screenHeight - VIEW.height * s) / 2);
  }

  begin(state: GameState): void {
    this.state = state;
    this.hud.setParty(state.party);
    this.hud.setHearts(state.hearts, false);
    state.party.forEach((p, i) => {
      this.heroes[i].setName(p.name);
      this.hud.setStars(i, 0);
    });
  }

  setGameplayVisible(on: boolean): void {
    this.actors.visible = on;
    this.hud.visible = on;
  }

  async setEnvironment(env: EnvironmentId): Promise<void> {
    this.state?.visit(env);
    if (this.backdrop.environment === env) return;
    this.sfx.chime();
    await this.backdrop.show(env);
  }

  name(p: PlayerIndex): string {
    return this.state.party[p].name;
  }

  loseHeart(): void {
    if (this.state.hearts <= 0) return;
    this.state.hearts--;
    this.hud.setHearts(this.state.hearts);
    const at = this.hud.heartPosition();
    this.fx.burst(at.x, at.y, palette.heart, { count: 18, speed: 200, size: 0.2 });
    this.fx.flash(palette.danger, 0.35, 0.4);
    this.fx.shake(12, 0.4);
    this.sfx.hurt();
  }

  gainHeart(): void {
    if (this.state.hearts >= MAX_HEARTS) return;
    this.state.hearts++;
    this.hud.setHearts(this.state.hearts);
    const at = this.hud.heartPosition();
    this.fx.burst(at.x, at.y, palette.heart, { count: 18, speed: 160, size: 0.2, texture: textures.sparkle, gravity: -40 });
  }

  awardStar(p: PlayerIndex, count = 1): void {
    this.state.stars[p] += count;
    this.hud.setStars(p, this.state.stars[p]);
    const h = this.heroes[p];
    this.fx.floatText(`+${count} ★`, h.x, h.y - 200, palette.star, 28);
    this.fx.burst(h.x, h.y - 80, palette.star, { count: 10, speed: 150, size: 0.25, texture: textures.sparkle, gravity: -60 });
  }

  async grantReward(reward: RewardSpec): Promise<void> {
    this.state.rewards.push(reward);
    this.sfx.success();
    const cx = (HERO_X[0] + HERO_X[1]) / 2;
    this.fx.burst(cx, GROUND_Y - 120, palette.gold, { count: 50, speed: 320, size: 0.3, texture: textures.sparkle, gravity: 40 });
    this.fx.ring(cx, GROUND_Y - 120, palette.gold, 160);
    if (reward.kind === 'heart') this.gainHeart();
    await this.banner.show(reward.name, reward.description, 2.4, palette.gold);
  }

  /** Show a "pondering" indicator if the storyteller takes a moment (e.g. waiting on Gemini). */
  async think<T>(work: Promise<T>): Promise<T> {
    let shown = false;
    const timer = setTimeout(() => {
      shown = true;
      void tween(this.thinking, { alpha: 1 }, 0.3);
    }, 300);
    try {
      return await work;
    } finally {
      clearTimeout(timer);
      if (shown) void tween(this.thinking, { alpha: 0 }, 0.3);
    }
  }

  /** Celebrate or commiserate at the end of a challenge. */
  async conclude(success: boolean, title: string, sub = ''): Promise<void> {
    if (success) {
      this.sfx.success();
      void this.heroes[0].celebrate();
      void wait(0.12).then(() => this.heroes[1].celebrate());
    } else {
      this.sfx.fail();
    }
    await this.banner.show(title, sub, 1.6, success ? palette.gold : 0xff8a8a);
    this.heroes.forEach((h) => {
      h.setMark(null);
      h.setMeter(null);
    });
  }

  outcome(beatId: string, kind: OutcomeKind, success: boolean, stars: [number, number], perPlayerSuccess: [boolean, boolean], heartsLost: number, summary: string, choiceId?: string): BeatOutcome {
    return {
      beatId,
      kind,
      success,
      choiceId,
      heartsLost,
      summary,
      perPlayer: [
        { success: perPlayerSuccess[0], stars: stars[0] },
        { success: perPlayerSuccess[1], stars: stars[1] },
      ],
    };
  }

  /** Slide heroes back to their marks (after knockbacks etc). */
  async resetHeroes(): Promise<void> {
    await Promise.all(this.heroes.map((h, i) => tween(h, { x: HERO_X[i], y: GROUND_Y }, 0.4, ease.outCubic)));
    this.heroes.forEach((h) => h.setFrozen(false));
  }
}
