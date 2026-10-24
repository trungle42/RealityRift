import { Container, Graphics, type Text } from 'pixi.js';
import type { InputSource } from '../contracts';
import type { Narrator } from '../audio/Narrator';
import { onFrame, now, tween, ease } from '../core/clock';
import { fonts, makeText, palette } from '../theme';

const X = 140;
const Y = 584;
const W = 1000;
const H = 124;
const CHARS_PER_SEC = 48;

export function drawParchment(g: Graphics, x: number, y: number, w: number, h: number): Graphics {
  g.roundRect(x - 6, y - 6, w + 12, h + 12, 14).fill(0x3a2208);
  g.roundRect(x, y, w, h, 10).fill(palette.parchment);
  g.roundRect(x + 8, y + 8, w - 16, h - 16, 6).stroke({ width: 2, color: palette.goldDeep, alpha: 0.7 });
  g.roundRect(x - 3, y - 3, w + 6, h + 6, 12).stroke({ width: 2, color: palette.gold });
  // Corner flourishes.
  for (const [cx, cy] of [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8]]) {
    g.star(cx, cy, 4, 9, 3).fill(palette.gold);
  }
  return g;
}

/** Storybook-style text box with a typewriter reveal. Space reveals all, then advances. */
export class NarrationPanel extends Container {
  private readonly body: Text;
  private readonly speakerTag = new Container();
  private readonly speakerText: Text;
  private readonly continueHint: Text;
  private full = '';
  private shown = 0;
  private typing = false;

  constructor(private readonly input: InputSource, private readonly narrator: Narrator) {
    super();
    this.addChild(new Graphics().roundRect(X, Y, W, H, 3).fill({ color: 0x081b15, alpha: 0.94 })
      .stroke({ width: 1, color: palette.gold, alpha: 0.65 })
      .moveTo(X + 20, Y + 8).lineTo(X + W - 20, Y + 8).stroke({ width: 1, color: palette.gold, alpha: 0.14 }));

    this.body = makeText('', { fontSize: 23, fill: palette.parchment, wordWrap: true, wordWrapWidth: W - 170, lineHeight: 29 }, 0);
    this.body.position.set(X + 34, Y + 22);
    this.addChild(this.body);

    this.speakerText = makeText('', { fontFamily: fonts.heading, fontWeight: '700', fontSize: 17, fill: palette.parchment });
    this.speakerTag.addChild(new Graphics(), this.speakerText);
    this.speakerTag.position.set(X + W / 2, Y - 8);
    this.addChild(this.speakerTag);

    this.continueHint = makeText('Space  ›', { fontFamily: fonts.heading, fontWeight: '500', fontSize: 13, fill: palette.gold }, 1);
    this.continueHint.anchor.set(1, 1);
    this.continueHint.position.set(X + W - 22, Y + H - 14);
    this.addChild(this.continueHint);

    this.alpha = 0;
    this.visible = false;

    onFrame((dt) => {
      if (this.typing) {
        this.shown = Math.min(this.full.length, this.shown + dt * CHARS_PER_SEC);
        this.body.text = this.full.slice(0, Math.floor(this.shown));
        if (this.shown >= this.full.length) this.typing = false;
      }
      this.continueHint.visible = !this.typing && this.visible;
      this.continueHint.alpha = 0.5 + 0.5 * Math.sin(now() * 4);
    });
  }

  /** Show each paragraph in turn, waiting for confirm after each. */
  async say(paragraphs: string[], speaker = 'The Storyteller'): Promise<void> {
    if (paragraphs.length === 0) return;
    this.setSpeaker(speaker);
    await this.open();
    for (const p of paragraphs.flatMap((paragraph) => this.paginate(paragraph))) {
      this.full = p;
      this.shown = 0;
      this.typing = true;
      this.narrator.speak(p);
      await this.waitConfirm();
      if (this.typing) {
        this.typing = false;
        this.body.text = this.full;
        await this.waitConfirm();
      }
    }
    this.narrator.stop();
  }

  /** Show a single line without waiting (used during challenges). */
  async caption(text: string, speaker = 'The Storyteller'): Promise<void> {
    this.setSpeaker(speaker);
    this.full = text;
    this.shown = 0;
    this.typing = true;
    this.narrator.speak(text);
    await this.open();
  }

  async open(): Promise<void> {
    if (this.visible && this.alpha >= 1) return;
    this.visible = true;
    this.y = 30;
    void tween(this, { y: 0 }, 0.35, ease.outCubic);
    await tween(this, { alpha: 1 }, 0.3);
  }

  async close(): Promise<void> {
    if (!this.visible) return;
    await tween(this, { alpha: 0 }, 0.25);
    this.visible = false;
    this.body.text = '';
    this.typing = false;
    this.narrator.stop();
  }

  private setSpeaker(name: string): void {
    this.speakerText.text = name;
    const w = this.speakerText.width + 34;
    const bg = this.speakerTag.children[0] as Graphics;
    bg.clear().roundRect(-w / 2, -13, w, 26, 2).fill(0x183b2c).stroke({ width: 1, color: palette.gold, alpha: 0.7 });
  }

  /** Keep long provider narration inside the panel without clipping. */
  private paginate(paragraph: string): string[] {
    const pages: string[] = [];
    let page = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = page ? `${page} ${word}` : word;
      this.body.text = next;
      if (this.body.height > 86 && page) { pages.push(page); page = word; }
      else page = next;
    }
    if (page) pages.push(page);
    this.body.text = '';
    return pages;
  }

  private waitConfirm(): Promise<void> {
    return new Promise((resolve) => {
      const off = this.input.subscribe((e) => {
        if (e.kind !== 'confirm') return;
        off();
        resolve();
      });
    });
  }
}

