import { Container, Graphics, type Text } from 'pixi.js';
import { tween, ease } from '../core/clock';
import { fonts, makeText, palette, VIEW } from '../theme';

const W = 620;

/** Instruction plaque under the chapter title with an optional countdown bar. */
export class PromptCard extends Container {
  private readonly plate = new Graphics();
  private readonly heading: Text;
  private readonly detail: Text;
  private readonly bar = new Graphics();

  constructor() {
    super();
    this.position.set(VIEW.width / 2, 120);
    this.heading = makeText('', { fontFamily: fonts.heading, fontWeight: '700', fontSize: 30, fill: palette.gold, stroke: { color: 0x120818, width: 5 } });
    this.heading.y = -12;
    this.detail = makeText('', { fontFamily: fonts.body, fontSize: 20, fill: palette.parchment, align: 'center', wordWrap: true, wordWrapWidth: W - 40 });
    this.detail.y = 24;
    this.addChild(this.plate, this.heading, this.detail, this.bar);
    this.alpha = 0;
    this.visible = false;
  }

  async show(heading: string, detail: string): Promise<void> {
    this.heading.text = heading;
    this.detail.text = detail;
    const h = 92 + Math.max(0, this.detail.height - 26);
    this.plate.clear().roundRect(-W / 2, -46, W, h, 14).fill({ color: 0x120a1e, alpha: 0.82 }).stroke({ width: 2, color: palette.gold });
    this.bar.clear();
    this.bar.y = h - 52;
    this.visible = true;
    this.scale.set(0.85);
    void tween(this.scale, { x: 1, y: 1 }, 0.3, ease.outBack);
    await tween(this, { alpha: 1 }, 0.25);
  }

  /** 1 = full time left, 0 = out of time. */
  setTimer(fraction: number, color: number = palette.gold): void {
    const w = W - 60;
    this.bar.clear().roundRect(-w / 2, 0, w, 8, 4).fill({ color: 0x000000, alpha: 0.5 });
    if (fraction > 0) this.bar.roundRect(-w / 2, 0, w * Math.min(1, fraction), 8, 4).fill(fraction < 0.25 ? palette.danger : color);
  }

  async hide(): Promise<void> {
    if (!this.visible) return;
    await tween(this, { alpha: 0 }, 0.2);
    this.visible = false;
  }
}
