import { addToArmory, browserStore, readArmory, weaponOf, writeArmory, type ArmoryEntry } from './armory';
import type { PlayerIndex } from '../contracts';
import { parseVerifyResponse } from './quest';
import { fitWithin, relicTier, makeWeapon, parseArtifactResponse, type Weapon } from './weapon';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';
const REQUEST_SECONDS = 25;
const THINKING = ['The rift is opening…', 'The storyteller is studying your object…', 'Something old is answering…', 'A relic is taking shape…'];

type Phase = 'live' | 'thinking' | 'result' | 'error' | 'matched' | 'nomatch';
/**
 * Pictures from a program that already owns the webcam (the cv_2 tracker, through CvInput). While it is `live` the scanner shows
 * its preview and scans from its snapshot, so only one program ever opens the camera; otherwise it opens the camera itself.
 */
export interface FrameSource {
  readonly live: boolean;
  /** The latest small picture, already mirrored like a selfie, as a URL for an <img>. */
  preview(): string | undefined;
  /** One full-size, unmirrored picture as base64 JPEG. */
  snapshot(): Promise<{ jpeg: string; w: number; h: number }>;
}
interface Quest { object: string; prompt: string; resolve: (ok: boolean) => void }
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Reality Rift scan screen: hold a real object up to the webcam, Gemini turns it into a weapon.
 * Self-contained overlay; the game only needs `show()` and the equip callback. Camera trouble never
 * blocks play: a photo can be chosen instead, and Escape always closes it.
 */
export class Scanner {
  open = false;
  private readonly root = document.createElement('div');
  private readonly video = document.createElement('video');
  private readonly panel = document.createElement('div');
  private stream?: MediaStream;
  private cameraRequest = 0;
  private source?: FrameSource;
  /** The tracker's live picture, shown where the video would be while `tracking`. */
  private readonly feed = document.createElement('img');
  private feedTimer = 0;
  private tracking = false;
  private phase: Phase = 'live';
  private weapon?: Weapon;
  private abort?: AbortController;
  /** Thumbnail of the scanned object for the relic card and the armory. */
  private photo = '';
  private armory: ArmoryEntry[] = readArmory(browserStore());
  private quest?: Quest;
  private seen = '';
  private ticker = 0;
  /** Hero names when two play: the result card then lets either hero take the weapon. */
  private heroes: string[] = [];
  /** Which hero the relic on the card is for. */
  private claim: PlayerIndex = 0;

  constructor(private readonly onEquip: (weapon: Weapon, hero: PlayerIndex) => void, private readonly onClose: () => void = () => {}) {
    this.root.className = 'rift-scan'; this.root.hidden = true; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-label', 'Scan an object');
    this.video.playsInline = true; this.video.muted = true; this.video.autoplay = true; this.video.className = 'rift-video';
    this.feed.className = 'rift-video'; this.feed.alt = ''; this.feed.style.display = 'none'; this.feed.style.transform = 'none';   // the tracker mirrors it already
    this.panel.className = 'rift-panel';
    this.root.append(this.video, this.feed, this.panel);
    document.body.append(this.root);
    window.addEventListener('keydown', this.onKey, true);
  }

  setHeroes(names: string[]): void { this.heroes = names.slice(0, 2); }

  /** Use another program's camera pictures whenever it is live (see FrameSource). */
  setFrameSource(source: FrameSource): void { this.source = source; }

  /**
   * "Show me X" quest: same camera and photo-upload path, but the photo goes to /api/verify and the
   * result is only whether the object matched. Resolves true on a match; Skip or Escape resolves false.
   */
  ask(object: string, prompt: string): Promise<boolean> {
    if (this.open) return Promise.resolve(false);
    return new Promise((resolve) => { this.quest = { object, prompt, resolve }; this.seen = ''; void this.show(); });
  }

  private settle(ok: boolean): void { const quest = this.quest; this.quest = undefined; quest?.resolve(ok); }

  /** Open the scanner; the relic it makes is offered to `hero` first (a scan from player two's phone). */
  async show(hero: PlayerIndex = 0): Promise<void> {
    if (this.open) return;
    this.open = true; this.root.hidden = false; this.weapon = undefined; this.claim = this.heroes.length > 1 ? hero : 0;
    await this.startCamera();
  }

  close(): void {
    if (!this.open) return;
    this.open = false; this.root.hidden = true; this.abort?.abort(); clearInterval(this.ticker); this.stopCamera(); this.onClose(); this.settle(false);
  }

  dispose(): void { window.removeEventListener('keydown', this.onKey, true); this.close(); this.root.remove(); }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.open) return;
    event.stopPropagation();
    if (event.code === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.repeat || !['Enter', 'Space'].includes(event.code)) return;
    event.preventDefault();
    if (this.phase === 'live') void this.captureFromCamera();
    else if (this.phase === 'result') this.equip();
    else if (this.phase === 'matched') this.finishQuest();
    else if (this.phase === 'error' || this.phase === 'nomatch') void this.startCamera();
  };

  // ---- camera ----
  private async startCamera(): Promise<void> {
    this.stopCamera(); this.render('live');
    if (this.source?.live) { this.startFeed(); return; }
    const request = this.cameraRequest;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      // Closed, restarted or already scanning a photo while the browser asked for the camera: let it go.
      if (request !== this.cameraRequest || !this.open || this.phase !== 'live') { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream; this.video.srcObject = stream; await this.video.play().catch(() => undefined);
      this.root.classList.add('has-camera');
      this.render('live');   // the first render ran before the camera existed, so it had no Scan button
    } catch {
      if (request !== this.cameraRequest || !this.open) return;
      this.root.classList.remove('has-camera');
      this.render('live', 'The camera is busy or blocked (the wand tracker may be using it). Choose a photo of the object instead.');
    }
  }

  private stopCamera(): void {
    this.cameraRequest++; this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; this.video.srcObject = null;
    clearInterval(this.feedTimer); this.tracking = false; this.feed.style.display = 'none'; this.video.style.display = '';
  }

  /** The tracker owns the webcam: show its live picture where the video would be, and scan from its snapshot. */
  private startFeed(): void {
    this.tracking = true; this.video.style.display = 'none'; this.feed.style.display = '';
    const show = () => { const url = this.source?.preview(); if (url && url !== this.feed.src) this.feed.src = url; };
    show(); this.feedTimer = window.setInterval(show, 100);
    this.root.classList.add('has-camera');
    this.render('live');
  }

  private async captureFromCamera(): Promise<void> {
    if (this.tracking) { await this.captureFromTracker(); return; }
    if (!this.stream || !this.video.videoWidth) return;
    await this.scan(this.video, this.video.videoWidth, this.video.videoHeight);
  }

  private async captureFromTracker(): Promise<void> {
    const request = this.cameraRequest;
    this.render('thinking');
    try {
      const shot = await this.source!.snapshot();
      if (request !== this.cameraRequest || !this.open || this.phase !== 'thinking') return;
      const image = new Image(); image.src = `data:image/jpeg;base64,${shot.jpeg}`; await image.decode();
      await this.scan(image, shot.w, shot.h, true);
    } catch {
      if (request === this.cameraRequest && this.open) this.render('error', 'The wand tracker did not send a picture. Try again, or choose a photo of the object.');
    }
  }

  private async captureFromFile(file: File): Promise<void> {
    try {
      const bitmap = await createImageBitmap(file); await this.scan(bitmap, bitmap.width, bitmap.height); bitmap.close();
    } catch { this.render('error', 'That file could not be read as an image.'); }
  }

  // ---- Gemini ----
  private async scan(source: CanvasImageSource, width: number, height: number, camera = source instanceof HTMLVideoElement): Promise<void> {
    const size = fitWithin(width, height), canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    canvas.getContext('2d')!.drawImage(source, 0, 0, size.width, size.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '';
    if (!this.quest) this.photo = thumbnail(canvas, camera);
    this.render('thinking');
    this.abort = new AbortController(); const timeout = window.setTimeout(() => this.abort?.abort(), REQUEST_SECONDS * 1000);
    try {
      const quest = this.quest;
      const res = await fetch(`${API}${quest ? '/api/verify' : '/api/artifact'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg', ...(quest ? { object: quest.object } : {}) }), signal: this.abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (quest) {
        const verdict = parseVerifyResponse(await res.json());
        if (!verdict) throw new Error('unexpected response');
        if (!this.open) return;
        this.seen = verdict.seen; this.stopCamera(); this.render(verdict.match ? 'matched' : 'nomatch'); return;
      }
      const parsed = parseArtifactResponse(await res.json());
      if (!parsed) throw new Error('unexpected response');
      if (!this.open) return;
      this.weapon = makeWeapon(parsed); this.stopCamera();
      this.armory = writeArmory(browserStore(), addToArmory(this.armory, { response: parsed, photo: this.photo, savedAt: Date.now() }));
      this.render('result');
    } catch (error) {
      if (!this.open) return;
      const aborted = (error as { name?: string }).name === 'AbortError';
      this.render('error', aborted ? 'The rift took too long to answer. Check the backend, then try again.' : this.quest ? 'The door could not look. Is the backend running? You can skip.' : 'The rift could not be opened. Is the backend running?');
    } finally { window.clearTimeout(timeout); }
  }

  private finishQuest(): void { this.stopCamera(); this.open = false; this.root.hidden = true; clearInterval(this.ticker); this.onClose(); this.settle(true); }

  private equip(): void {
    if (!this.weapon) return;
    const weapon = this.weapon, hero = this.claim; this.close(); this.onEquip(weapon, hero);
  }

  // ---- view ----
  private render(phase: Phase, note = ''): void {
    this.phase = phase; clearInterval(this.ticker); this.panel.textContent = ''; this.root.dataset.phase = phase;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
    const button = (label: string, hint: string, onClick: () => void, primary = false) => { const b = el('button', primary ? 'primary' : '', label); b.type = 'button'; if (hint) { const k = el('kbd', '', hint); b.append(k); } b.onclick = onClick; return b; };

    if (phase === 'live') {
      const quest = this.quest;
      this.panel.append(el('h2', '', quest ? 'The door is listening' : 'Open a rift'), el('p', 'lede', quest ? `${quest.prompt} Hold ${quest.object} up to the camera.` : 'Hold a real object up to the camera: a bottle, a phone, a pen, a shoe. Gemini turns it into a relic that infuses your wand and sword.'));
      if (note) this.panel.append(el('p', 'note', note));
      const actions = el('div', 'actions');
      const camera = !!this.stream || this.tracking;
      if (camera) actions.append(button(quest ? 'Show it' : 'Scan the object', 'Enter', () => void this.captureFromCamera(), true));
      const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; file.onchange = () => { const f = file.files?.[0]; if (f) void this.captureFromFile(f); };
      actions.append(button('Choose a photo', '', () => file.click(), !camera), file, button(quest ? 'Skip' : 'Close', 'Esc', () => this.close()));
      this.panel.append(actions);
      if (!quest && this.armory.length) {
        const shelf = el('div', 'armory'); shelf.setAttribute('aria-label', 'Your armory');
        for (const entry of this.armory) {
          const w = weaponOf(entry), pick = el('button', 'armory-item'); pick.type = 'button'; pick.style.setProperty('--rift', hex(w.spell.color)); pick.title = `${w.artifactName}: ${w.element} ${w.ability}, from your ${w.object}`;
          if (entry.photo) { const img = el('img'); img.src = entry.photo; img.alt = ''; pick.append(img); }
          pick.append(el('span', '', w.artifactName));
          pick.onclick = () => { this.stopCamera(); this.weapon = w; this.photo = entry.photo; this.render('result'); };
          shelf.append(pick);
        }
        this.panel.append(el('p', 'armory-label', 'Your armory'), shelf);
      }
    } else if (phase === 'thinking') {
      const ring = el('div', 'ring'); let i = 0; const line = el('p', 'lede', THINKING[0]);
      this.ticker = window.setInterval(() => { i = (i + 1) % THINKING.length; line.textContent = THINKING[i]; }, 1600);
      this.panel.append(ring, el('h2', '', this.quest ? 'The door is looking' : 'Reading your object'), line);
    } else if (phase === 'result' && this.weapon) {
      const w = this.weapon, color = hex(w.spell.color); this.panel.style.setProperty('--rift', color);
      const card = el('article', `relic-card ${w.rarity}`); card.setAttribute('aria-label', `Relic card: ${w.artifactName}`);
      const frame = el('div', 'relic-photo');
      if (this.photo) { const img = el('img'); img.src = this.photo; img.alt = `Your ${w.object}`; frame.append(img); } else frame.append(el('span', '', w.object));
      const damage = el('div', 'meter'); const fill = el('i'); fill.style.width = `${w.damage}%`; damage.append(fill);
      card.append(el('span', `rarity ${w.rarity}`, w.rarity), frame, el('h2', 'weapon-name', w.artifactName), el('p', 'from', `from your ${w.object}`),
        el('p', 'chips', `Relic: infuses your wand and sword with ${w.element}`), el('p', 'ability', `Power ${'●'.repeat(relicTier(w))}${'○'.repeat(3 - relicTier(w))}`), damage, el('p', 'desc', w.description));
      this.panel.append(card);
      if (this.armory.some((e) => e.response.artifact.artifactName === w.artifactName)) this.panel.append(el('p', 'saved', 'Kept in your armory'));
      if (w.source === 'fallback') this.panel.append(el('p', 'note', 'Gemini was unavailable, so the rift conjured a stand-in relic.'));
      const actions = el('div', 'actions'), other = (1 - this.claim) as PlayerIndex;
      actions.append(button(this.heroes.length > 1 ? `Give to ${this.heroes[this.claim]}` : 'Take it', 'Enter', () => this.equip(), true));
      if (this.heroes.length > 1) actions.append(button(`Give to ${this.heroes[other]}`, '', () => { this.claim = other; this.equip(); }));
      actions.append(button('Scan something else', '', () => void this.startCamera()));
      this.panel.append(actions);
    } else if (phase === 'matched' && this.quest) {
      this.panel.append(el('h2', '', 'The door accepts'), el('p', 'lede', this.seen ? `It sees ${this.seen}, and that is just what it wanted.` : 'It is just what the door wanted.'));
      const actions = el('div', 'actions'); actions.append(button('Go through', 'Enter', () => this.finishQuest(), true)); this.panel.append(actions);
    } else if (phase === 'nomatch' && this.quest) {
      this.panel.append(el('h2', '', 'Not quite'), el('p', 'lede', this.seen ? `The door sees ${this.seen}, but it asked for ${this.quest.object}.` : `The door does not see ${this.quest.object}.`));
      const actions = el('div', 'actions'); actions.append(button('Try again', 'Enter', () => void this.startCamera(), true), button('Skip', 'Esc', () => this.close())); this.panel.append(actions);
    } else {
      this.panel.append(el('h2', '', 'The rift slipped'), el('p', 'note', note));
      const actions = el('div', 'actions'); actions.append(button('Try again', 'Enter', () => void this.startCamera(), true), button(this.quest ? 'Skip' : 'Close', 'Esc', () => this.close())); this.panel.append(actions);
    }
  }
}

/** A small JPEG of the scan for the relic card and the armory (the 512px upload is too big to keep). Camera frames are mirrored to match the selfie view. */
function thumbnail(source: HTMLCanvasElement, mirror: boolean, max = 200): string {
  const scale = Math.min(1, max / Math.max(source.width, source.height, 1)), canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d')!; if (mirror) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78);
}
