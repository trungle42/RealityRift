import { Container, Graphics, type Text } from 'pixi.js';
import type { InputSource, Storybook } from '../contracts';
import { onFrame, now, tween, ease } from '../core/clock';
import { fonts, goldText, makeText, palette, VIEW } from '../theme';

const PAGE_W = 460;
const PAGE_H = 470;
const BOOK_Y = 150;

/**
 * The personalized storybook at the end of the adventure. Two pages per
 * spread; Space / → turns the page, ← goes back. Resolves after the last spread.
 */
export async function showStorybook(parent: Container, input: InputSource, book: Storybook): Promise<void> {
  const screen = new Container();
  screen.addChild(new Graphics().rect(0, 0, VIEW.width, VIEW.height).fill({ color: 0x05040c, alpha: 0.75 }));

  const title = goldText(book.title, 44);
  title.position.set(VIEW.width / 2, 90);
  screen.addChild(title);

  const cx = VIEW.width / 2;
  const cover = new Graphics()
    .roundRect(cx - PAGE_W - 24, BOOK_Y - 16, PAGE_W * 2 + 48, PAGE_H + 32, 14)
    .fill(0x5a1a14)
    .stroke({ width: 4, color: palette.gold });
  const pages = new Graphics();
  for (const side of [-1, 1]) {
    const x = side < 0 ? cx - PAGE_W : cx;
    pages.roundRect(x, BOOK_Y, PAGE_W, PAGE_H, 6).fill(palette.parchment);
    pages.roundRect(x + 14, BOOK_Y + 14, PAGE_W - 28, PAGE_H - 28, 4).stroke({ width: 2, color: palette.goldDeep, alpha: 0.6 });
  }
  pages.rect(cx - 3, BOOK_Y, 6, PAGE_H).fill({ color: 0x000000, alpha: 0.18 });
  screen.addChild(cover, pages);

  const slots = [-1, 1].map((side) => {
    const x = side < 0 ? cx - PAGE_W / 2 : cx + PAGE_W / 2;
    const heading = makeText('', { fontFamily: fonts.display, fontSize: 28, fill: 0x7a2316, align: 'center', wordWrap: true, wordWrapWidth: PAGE_W - 80 });
    heading.position.set(x, BOOK_Y + 70);
    const body = makeText('', { fontSize: 23, fill: palette.ink, align: 'center', wordWrap: true, wordWrapWidth: PAGE_W - 90, lineHeight: 32 }, 0.5);
    body.anchor.set(0.5, 0);
    body.position.set(x, BOOK_Y + 120);
    const folio = makeText('', { fontFamily: fonts.heading, fontSize: 16, fill: palette.goldDeep });
    folio.position.set(x, BOOK_Y + PAGE_H - 34);
    const content = new Container();
    content.addChild(heading, body, folio);
    screen.addChild(content);
    return { content, heading, body, folio };
  });

  const hint = makeText('', { fontFamily: fonts.heading, fontWeight: '700', fontSize: 20, fill: palette.gold });
  hint.position.set(cx, BOOK_Y + PAGE_H + 50);
  screen.addChild(hint);

  screen.alpha = 0;
  parent.addChild(screen);
  void tween(screen, { alpha: 1 }, 0.6);

  const spreads = Math.ceil(book.pages.length / 2);
  let spread = 0;
  const render = () => {
    slots.forEach((slot, i) => {
      const page = book.pages[spread * 2 + i];
      slot.heading.text = page?.heading ?? '';
      slot.body.text = page?.text ?? '';
      slot.folio.text = page ? `— ${spread * 2 + i + 1} —` : '';
      // Fit long text onto the page.
      fit(slot.body);
      slot.content.alpha = 0;
      void tween(slot.content, { alpha: 1 }, 0.4, ease.outCubic);
    });
    hint.text = spread < spreads - 1 ? 'Space ▸ turn the page' : 'Space ▸ play again';
  };
  render();
  const off = onFrame(() => (hint.alpha = 0.55 + 0.45 * Math.sin(now() * 3)));

  await new Promise<void>((resolve) => {
    const unsub = input.subscribe((e) => {
      if (e.kind === 'left' && spread > 0) {
        spread--;
        render();
      } else if (e.kind === 'confirm' || e.kind === 'right') {
        if (spread < spreads - 1) {
          spread++;
          render();
        } else if (e.kind === 'confirm') {
          unsub();
          resolve();
        }
      }
    });
  });

  off();
  await tween(screen, { alpha: 0 }, 0.5);
  screen.destroy({ children: true });
}

function fit(text: Text): void {
  text.style.fontSize = 23;
  while (text.height > PAGE_H - 200 && (text.style.fontSize as number) > 14) text.style.fontSize = (text.style.fontSize as number) - 1;
}
