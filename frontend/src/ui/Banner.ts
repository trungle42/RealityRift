import { Container, type Text } from 'pixi.js';
import { tween, wait, ease } from '../core/clock';
import { fonts, goldText, makeText, palette, VIEW } from '../theme';

/** Big center-screen announcements: "FREEZE!", "Victory", etc. */
export class Banner extends Container {
  private readonly title: Text;
  private readonly sub: Text;
  private token = 0;

  constructor() {
    super();
    this.position.set(VIEW.width / 2, 300);
    this.title = goldText('', 54);
    this.sub = makeText('', {
      fontFamily: fonts.heading,
      fontWeight: '700',
      fontSize: 26,
      fill: palette.parchment,
      stroke: { color: 0x120818, width: 6 },
      align: 'center',
    });
    this.sub.y = 64;
    this.addChild(this.title, this.sub);
    this.alpha = 0;
  }

  /** Resolves when the banner has faded. Pass hold = Infinity to keep it up until hide(). */
  async show(title: string, sub = '', hold = 1.4, color: number = palette.gold): Promise<void> {
    const token = ++this.token;
    this.title.text = title;
    this.title.style.fill = color;
    this.sub.text = sub;
    this.title.scale.set(1);
    this.sub.scale.set(1);
    this.alpha = 1;
    const fit = Math.min(1, 1100 / Math.max(this.title.width, this.sub.width));
    this.title.scale.set(fit);
    this.sub.scale.set(fit);
    this.scale.set(1.12);
    void tween(this.scale, { x: 1, y: 1 }, 0.4, ease.outBack);
    if (!Number.isFinite(hold)) return;
    await wait(hold);
    if (token === this.token) await tween(this, { alpha: 0 }, 0.35);
  }

  hide(): Promise<void> {
    this.token++;
    return tween(this, { alpha: 0 }, 0.25);
  }
}
