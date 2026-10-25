import type { CvInput } from './CvInput';
import { completedShape, newlyComplete, setupHint, wandPrompt } from './cvMath';

const COLOURS: Record<string, string> = { yellow: '#ffd54a', blue: '#62b0ff', red: '#ff6b6b' };
const WIDTH = 240, HEIGHT = 180;   // a 4:3 window onto the camera picture, mirrored like a selfie (the tracker mirrors x)
const PHONE = '#9be15d';
/** Above the weapons HUD (bottom centre, its top ~182 px up), so the two never overlap however narrow the window is. */
const BOTTOM = 196;
const FLASH_SECONDS = 1.2;
/** A setup hint ("wand not seen") shows only after it has held this long, so a dropped frame does not flash a warning. */
const HINT_SECONDS = 0.8;

/**
 * The wand panel: the tracker's camera picture (you, holding the wand and the phone) with each wand's trail in its colour, the
 * phone's marker, what to draw, and a flash naming each shape the moment it completes. Shown only while a tracker is connected;
 * it redraws itself every animation frame from CvInput, so the game only creates and disposes it. Inline styles keep it
 * self-contained.
 */
export class WandHud {
  private readonly root = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private last?: Record<string, boolean>;
  private flash?: { text: string; colour: string; until: number };
  private frame = 0;
  private readonly picture = new Image();
  private pictureSeq = 0;
  private readonly hint = document.createElement('div');
  private hintText = '';
  private hintSince = 0;

  constructor(private readonly cv: CvInput, parent: HTMLElement) {
    Object.assign(this.root.style, {
      position: 'fixed', left: '16px', bottom: `${BOTTOM}px`, width: `${WIDTH}px`, padding: '8px', display: 'none', pointerEvents: 'none',
      background: 'var(--game-panel, #19372ff2)', border: '1px solid var(--game-line, #c5d3bd55)', borderRadius: '4px',
      color: 'var(--game-text, #faf5e1)', font: '13px Georgia, serif', zIndex: '15',
    });
    this.root.setAttribute('aria-live', 'polite');
    Object.assign(this.prompt.style, { color: 'var(--game-gold, #f0d48e)', marginBottom: '6px', textAlign: 'center' });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = WIDTH * dpr; this.canvas.height = HEIGHT * dpr;
    Object.assign(this.canvas.style, { width: `${WIDTH}px`, height: `${HEIGHT}px`, display: 'block', borderRadius: '3px', background: '#0b1813' });
    this.ctx = this.canvas.getContext('2d'); this.ctx?.scale(dpr, dpr);
    Object.assign(this.hint.style, { color: 'var(--game-muted, #cbd6c5)', fontSize: '12px', marginTop: '6px', textAlign: 'center', minHeight: '15px' });
    this.root.append(this.prompt, this.canvas, this.hint); parent.append(this.root);
    this.frame = requestAnimationFrame(this.tick);
  }

  dispose(): void { cancelAnimationFrame(this.frame); this.root.remove(); }

  private readonly tick = (): void => { this.draw(performance.now() / 1000); this.frame = requestAnimationFrame(this.tick); };

  private draw(now: number): void {
    const connected = this.cv.trackerConnected, ctx = this.ctx;
    const wand = connected ? this.cv.wand() : undefined, camera = connected ? this.cv.camera() : undefined;
    this.root.style.display = wand || camera ? 'block' : 'none';
    if ((!wand && !camera) || !ctx) { this.last = undefined; return; }
    if (wand) {
      for (const colour of newlyComplete(this.last, wand.complete)) {
        const shape = completedShape(wand, colour);
        if (shape) this.flash = { text: `${shape[0].toUpperCase()}${shape.slice(1)}!`, colour: COLOURS[colour] ?? '#fff', until: now + FLASH_SECONDS };
      }
      this.last = { ...wand.complete };
    }
    this.prompt.textContent = wandPrompt(wand) || 'Wand resting';
    const hint = setupHint(this.cv.seen());
    if (hint !== this.hintText) { this.hintText = hint; this.hintSince = now; }
    this.hint.textContent = hint && now - this.hintSince >= HINT_SECONDS ? hint : '';
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (camera && camera.seq !== this.pictureSeq) { this.pictureSeq = camera.seq; this.picture.src = camera.url; }
    if (camera && this.picture.complete && this.picture.naturalWidth) {
      ctx.drawImage(this.picture, 0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = 'rgba(11, 24, 19, 0.22)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);   // keeps the trails readable on a bright room
    }
    const phone = this.cv.phone();
    if (phone) {
      ctx.strokeStyle = PHONE; ctx.lineWidth = 3; ctx.beginPath();
      ctx.arc(phone.x * WIDTH, phone.y * HEIGHT, Math.max(7, phone.radius * WIDTH), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [colour, segments] of Object.entries(wand?.traces ?? {})) {
      const stroke = COLOURS[colour] ?? '#fff', done = wand?.complete[colour];
      ctx.strokeStyle = stroke; ctx.fillStyle = stroke; ctx.lineWidth = done ? 5 : 3; ctx.shadowColor = stroke; ctx.shadowBlur = done ? 12 : 0;
      for (const segment of segments) {
        ctx.beginPath();
        segment.forEach(([x, y], i) => (i ? ctx.lineTo(x * WIDTH, y * HEIGHT) : ctx.moveTo(x * WIDTH, y * HEIGHT)));
        ctx.stroke();
      }
      const tip = segments.at(-1)?.at(-1);
      if (tip) { ctx.beginPath(); ctx.arc(tip[0] * WIDTH, tip[1] * HEIGHT, 4, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.shadowBlur = 0;
    if (this.flash && now < this.flash.until) {
      ctx.globalAlpha = Math.min(1, (this.flash.until - now) / 0.4);
      ctx.font = 'bold 30px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = '#0b1813'; ctx.strokeText(this.flash.text, WIDTH / 2, HEIGHT / 2);
      ctx.fillStyle = this.flash.colour; ctx.fillText(this.flash.text, WIDTH / 2, HEIGHT / 2);
      ctx.globalAlpha = 1;
    }
  }
}
