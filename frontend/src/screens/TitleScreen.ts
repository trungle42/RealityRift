import { Container, Graphics, Sprite } from 'pixi.js';
import type { InputSource } from '../contracts';
import { onFrame, now, tween, ease } from '../core/clock';
import { textures } from '../fx/textures';
import { fonts, goldText, makeText, palette, VIEW } from '../theme';

/** Title card over the forest backdrop. Resolves on Space / Enter / click. */
export async function showTitle(parent: Container, input: InputSource): Promise<void> {
  const screen = new Container();
  const veil = new Graphics().rect(0, 0, VIEW.width, VIEW.height).fill({ color: 0x05040c, alpha: 0.45 });
  const glow = new Sprite(textures.glow);
  glow.anchor.set(0.5);
  glow.position.set(VIEW.width / 2, 250);
  glow.scale.set(9, 4);
  glow.tint = palette.gold;
  glow.alpha = 0.25;
  glow.blendMode = 'add';

  const title = goldText('RealityRift', 110);
  title.position.set(VIEW.width / 2, 240);
  const subtitle = makeText('An AI-Powered Interactive Fairy Tale', { fontFamily: fonts.heading, fontSize: 28, fill: palette.parchment, letterSpacing: 3, stroke: { color: 0x120818, width: 5 } });
  subtitle.position.set(VIEW.width / 2, 330);
  const tagline = makeText('“Don’t just read the fairy tale. Become part of it.”', { fontStyle: 'italic', fontSize: 26, fill: palette.parchmentDark, stroke: { color: 0x120818, width: 4 } });
  tagline.position.set(VIEW.width / 2, 390);
  const start = makeText('Press Space to begin', { fontFamily: fonts.heading, fontWeight: '700', fontSize: 26, fill: palette.gold, stroke: { color: 0x120818, width: 5 } });
  start.position.set(VIEW.width / 2, 520);

  screen.addChild(veil, glow, title, subtitle, tagline, start);
  screen.alpha = 0;
  parent.addChild(screen);
  title.scale.set(0.8);
  void tween(title.scale, { x: 1, y: 1 }, 1.2, ease.outBack);
  void tween(screen, { alpha: 1 }, 0.8);

  const off = onFrame(() => {
    start.alpha = 0.55 + 0.45 * Math.sin(now() * 3);
    glow.alpha = 0.22 + 0.06 * Math.sin(now() * 1.3);
  });

  await new Promise<void>((resolve) => {
    const done = () => {
      unsub();
      window.removeEventListener('pointerdown', done);
      resolve();
    };
    const unsub = input.subscribe((e) => e.kind === 'confirm' && done());
    window.addEventListener('pointerdown', done);
  });

  await tween(screen, { alpha: 0 }, 0.5);
  off();
  screen.destroy({ children: true });
}
