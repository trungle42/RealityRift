import { Container, Graphics, type Text } from 'pixi.js';
import { onFrame, tween, ease } from '../core/clock';
import { approach } from '../core/math';
import { fonts, makeText, palette, VIEW } from '../theme';

const W = 520;

/** Boss name and health, with a trailing "damage taken" bar. */
export class BossBar extends Container {
  private readonly bar = new Graphics();
  private readonly nameText: Text;
  private hp = 1;
  private trail = 1;

  constructor() {
    super();
    this.position.set(VIEW.width / 2, VIEW.height - 84);
    this.nameText = makeText('', { fontFamily: fonts.display, fontSize: 22, fill: palette.parchment, stroke: { color: 0x120818, width: 5 } });
    this.nameText.y = -2;
    this.addChild(this.bar, this.nameText);
    this.visible = false;
    onFrame((dt) => {
      if (!this.visible) return;
      this.trail = approach(this.trail, this.hp, 3, dt);
      this.draw();
    });
  }

  async show(name: string): Promise<void> {
    this.nameText.text = name;
    this.hp = this.trail = 1;
    this.visible = true;
    this.alpha = 0;
    this.draw();
    await tween(this, { alpha: 1 }, 0.4, ease.outCubic);
  }

  set(fraction: number): void {
    this.hp = Math.max(0, fraction);
  }

  async hide(): Promise<void> {
    await tween(this, { alpha: 0 }, 0.4);
    this.visible = false;
  }

  private draw(): void {
    const g = this.bar.clear();
    g.roundRect(-W / 2 - 4, 14, W + 8, 22, 11).fill(0x120818).stroke({ width: 2, color: palette.gold });
    g.roundRect(-W / 2, 18, W * this.trail, 14, 7).fill(0xffe3a0);
    if (this.hp > 0) g.roundRect(-W / 2, 18, W * this.hp, 14, 7).fill(0xc2264a);
  }
}
