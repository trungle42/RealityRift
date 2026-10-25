import { Container, Graphics, Sprite } from 'pixi.js';
import { onFrame, now } from '../core/clock';
import { textures } from '../fx/textures';
import { palette } from '../theme';

/** Pip, the fairy ally who joins the boss fight if the heroes freed her. */
export class Fairy extends Container {
  private readonly wings = new Graphics();
  private readonly stopUpdates: () => void;

  constructor(private readonly homeX: number, private readonly homeY: number) {
    super();
    const glow = new Sprite(textures.glow);
    glow.anchor.set(0.5);
    glow.tint = palette.fairy;
    glow.blendMode = 'add';
    glow.scale.set(0.7);
    this.wings.ellipse(-10, -6, 12, 6).ellipse(10, -6, 12, 6).fill({ color: 0xffffff, alpha: 0.6 });
    const body = new Graphics().ellipse(0, 0, 5, 9).fill(0xfff6e0).circle(0, -11, 5).fill(0xffe0c0);
    this.addChild(glow, this.wings, body);
    this.position.set(homeX, homeY);
    this.stopUpdates = onFrame(() => {
      const t = now();
      this.x = this.homeX + Math.sin(t * 1.7) * 40;
      this.y = this.homeY + Math.sin(t * 3.1) * 16;
      this.wings.scale.y = 0.4 + Math.abs(Math.sin(t * 30)) * 0.6;
    });
  }

  override destroy(): void {
    this.stopUpdates();
    super.destroy({ children: true });
  }
}
