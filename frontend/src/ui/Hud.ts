import { Container, Graphics, type Text } from 'pixi.js';
import type { Player } from '../contracts';
import { tween, ease } from '../core/clock';
import { fonts, goldText, makeText, palette, PLAYER_COLORS, VIEW } from '../theme';

export function drawHeart(g: Graphics, x: number, y: number, size: number, color: number): Graphics {
  const r = size * 0.3;
  g.circle(x - r, y - r * 0.4, r).circle(x + r, y - r * 0.4, r).fill(color);
  g.poly([x - size * 0.58, y - r * 0.1, x + size * 0.58, y - r * 0.1, x, y + size * 0.55]).fill(color);
  return g;
}

/** Shared hearts, per-player stars and the current chapter title. */
export class Hud extends Container {
  private readonly hearts: Container[] = [];
  private readonly starTexts: Text[] = [];
  private readonly nameTexts: Text[] = [];
  private readonly chapter: Text;
  private readonly chapterPlate = new Graphics();
  private heartCount = 0;

  constructor(private readonly maxHearts: number) {
    super();
    const plate = new Graphics()
      .roundRect(24, 22, 224, 122, 3)
      .fill({ color: 0x081c16, alpha: 0.78 })
      .stroke({ width: 1, color: palette.gold, alpha: 0.35 });
    this.addChild(plate);

    for (let i = 0; i < maxHearts; i++) {
      const c = new Container();
      c.position.set(51 + i * 32, 47);
      c.addChild(drawHeart(new Graphics(), 0, 0, 23, 0x3a302c), drawHeart(new Graphics(), 0, 0, 23, palette.heart));
      this.hearts.push(c);
      this.addChild(c);
    }

    for (let p = 0; p < 2; p++) {
      const name = makeText('', { fontFamily: fonts.heading, fontWeight: '500', fontSize: 15, fill: PLAYER_COLORS[p] }, 0);
      name.anchor.set(0, 0.5);
      name.position.set(40, 87 + p * 30);
      const stars = makeText('★ 0', { fontFamily: fonts.heading, fontWeight: '700', fontSize: 18, fill: palette.star }, 0);
      stars.anchor.set(1, 0.5);
      stars.position.set(232, 87 + p * 30);
      this.nameTexts.push(name);
      this.starTexts.push(stars);
      this.addChild(name, stars);
    }

    this.chapter = goldText('', 20, fonts.heading);
    this.chapter.position.set(VIEW.width / 2, 43);
    this.addChild(this.chapterPlate, this.chapter);

    const hint = makeText('SHARED LIFE', { fontFamily: fonts.heading, fontSize: 9, fill: palette.parchmentDark }, 1);
    hint.anchor.set(1, 0.5);
    hint.alpha = 0.6;
    hint.position.set(232, 47);
    this.addChild(hint);
  }

  setParty(party: readonly Player[]): void {
    party.forEach((p, i) => {
      const text = this.nameTexts[i];
      text.text = p.name;
      text.scale.set(1);
      text.scale.set(Math.min(1, 145 / text.width));
    });
  }

  setHearts(count: number, animate = true): void {
    const before = this.heartCount;
    this.heartCount = count;
    this.hearts.forEach((c, i) => {
      const full = c.children[1];
      const filled = i < count;
      if (!animate) {
        full.alpha = filled ? 1 : 0;
        full.scale.set(1);
        return;
      }
      if (filled && i >= before) {
        full.alpha = 1;
        full.scale.set(0.2);
        void tween(full.scale, { x: 1, y: 1 }, 0.45, ease.outBack);
      } else if (!filled && i < before) {
        void tween(full.scale, { x: 1.8, y: 1.8 }, 0.35);
        void tween(full, { alpha: 0 }, 0.35);
      }
    });
  }

  setStars(player: number, stars: number): void {
    const t = this.starTexts[player];
    t.text = `★ ${stars}`;
    t.scale.set(1.5);
    void tween(t.scale, { x: 1, y: 1 }, 0.35, ease.outBack);
  }

  heartPosition(): { x: number; y: number } {
    const i = Math.max(0, Math.min(this.maxHearts - 1, this.heartCount - 1));
    return { x: this.hearts[i].x, y: this.hearts[i].y };
  }

  setChapter(text: string): void {
    this.chapter.text = text;
    this.chapter.scale.set(1);
    this.chapter.scale.set(Math.min(1, 500 / this.chapter.width));
    this.chapterPlate.clear();
    if (!text) return;
    const w = this.chapter.width + 70;
    this.chapterPlate
      .roundRect(VIEW.width / 2 - w / 2, 22, w, 42, 2)
      .fill({ color: 0x081c16, alpha: 0.68 })
      .stroke({ width: 1, color: palette.gold, alpha: 0.35 });
    this.chapter.alpha = 0;
    void tween(this.chapter, { alpha: 1 }, 0.6);
  }
}
