import { parseVerifyResponse } from './quest';
import { ABILITY_LABEL, fitWithin, makeWeapon, parseArtifactResponse, type Weapon } from './weapon';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';
const REQUEST_SECONDS = 25;
const THINKING = ['The rift is opening…', 'The storyteller is studying your object…', 'Something old is answering…', 'A weapon is taking shape…'];

type Phase = 'live' | 'thinking' | 'result' | 'error' | 'matched' | 'nomatch';
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
  private phase: Phase = 'live';
  private weapon?: Weapon;
  private abort?: AbortController;
  private quest?: Quest;
  private seen = '';
  private ticker = 0;
  private readonly badge = document.createElement('div');

  constructor(private readonly onEquip: (weapon: Weapon) => void, private readonly onClose: () => void = () => {}) {
    this.root.className = 'rift-scan'; this.root.hidden = true; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-label', 'Scan an object');
    this.video.playsInline = true; this.video.muted = true; this.video.autoplay = true; this.video.className = 'rift-video';
    this.panel.className = 'rift-panel';
    this.root.append(this.video, this.panel);
    this.badge.className = 'weapon-badge'; this.badge.hidden = true;
    document.body.append(this.root, this.badge);
    window.addEventListener('keydown', this.onKey, true);
  }

  /** Small HUD pill showing the equipped weapon. */
  showBadge(weapon: Weapon): void {
    this.badge.hidden = false; this.badge.style.setProperty('--rift', hex(weapon.spell.color));
    this.badge.textContent = ''; const name = document.createElement('b'); name.textContent = weapon.artifactName;
    const meta = document.createElement('span'); meta.textContent = `${weapon.element} · ${weapon.ability}`;
    this.badge.append(name, meta);
  }

  /**
   * "Show me X" quest: same camera and photo-upload path, but the photo goes to /api/verify and the
   * result is only whether the object matched. Resolves true on a match; Skip or Escape resolves false.
   */
  ask(object: string, prompt: string): Promise<boolean> {
    if (this.open) return Promise.resolve(false);
    return new Promise((resolve) => { this.quest = { object, prompt, resolve }; this.seen = ''; void this.show(); });
  }

  private settle(ok: boolean): void { const quest = this.quest; this.quest = undefined; quest?.resolve(ok); }

  async show(): Promise<void> {
    if (this.open) return;
    this.open = true; this.root.hidden = false; this.weapon = undefined;
    await this.startCamera();
  }

  close(): void {
    if (!this.open) return;
    this.open = false; this.root.hidden = true; this.abort?.abort(); clearInterval(this.ticker); this.stopCamera(); this.onClose(); this.settle(false);
  }

  dispose(): void { window.removeEventListener('keydown', this.onKey, true); this.close(); this.root.remove(); this.badge.remove(); }

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
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      this.video.srcObject = this.stream; await this.video.play().catch(() => undefined);
      this.root.classList.add('has-camera');
    } catch {
      this.root.classList.remove('has-camera');
      this.render('live', 'No camera available. You can choose a photo of an object instead.');
    }
  }

  private stopCamera(): void { this.stream?.getTracks().forEach((track) => track.stop()); this.stream = undefined; this.video.srcObject = null; }

  private async captureFromCamera(): Promise<void> {
    if (!this.stream || !this.video.videoWidth) return;
    await this.scan(this.video, this.video.videoWidth, this.video.videoHeight);
  }

  private async captureFromFile(file: File): Promise<void> {
    try {
      const bitmap = await createImageBitmap(file); await this.scan(bitmap, bitmap.width, bitmap.height); bitmap.close();
    } catch { this.render('error', 'That file could not be read as an image.'); }
  }

  // ---- Gemini ----
  private async scan(source: CanvasImageSource, width: number, height: number): Promise<void> {
    const size = fitWithin(width, height), canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    canvas.getContext('2d')!.drawImage(source, 0, 0, size.width, size.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '';
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
      this.weapon = makeWeapon(parsed); this.stopCamera(); this.render('result');
    } catch (error) {
      if (!this.open) return;
      const aborted = (error as { name?: string }).name === 'AbortError';
      this.render('error', aborted ? 'The rift took too long to answer. Check the backend, then try again.' : this.quest ? 'The door could not look. Is the backend running? You can skip.' : 'The rift could not be opened. Is the backend running?');
    } finally { window.clearTimeout(timeout); }
  }

  private finishQuest(): void { this.stopCamera(); this.open = false; this.root.hidden = true; clearInterval(this.ticker); this.onClose(); this.settle(true); }

  private equip(): void {
    if (!this.weapon) return;
    const weapon = this.weapon; this.close(); this.onEquip(weapon); this.showBadge(weapon);
  }

  // ---- view ----
  private render(phase: Phase, note = ''): void {
    this.phase = phase; clearInterval(this.ticker); this.panel.textContent = ''; this.root.dataset.phase = phase;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
    const button = (label: string, hint: string, onClick: () => void, primary = false) => { const b = el('button', primary ? 'primary' : '', label); b.type = 'button'; if (hint) { const k = el('kbd', '', hint); b.append(k); } b.onclick = onClick; return b; };

    if (phase === 'live') {
      const quest = this.quest;
      this.panel.append(el('h2', '', quest ? 'The door is listening' : 'Open a rift'), el('p', 'lede', quest ? `${quest.prompt} Hold ${quest.object} up to the camera.` : 'Hold a real object up to the camera: a bottle, a phone, a pen, a shoe. Gemini will turn it into a weapon.'));
      if (note) this.panel.append(el('p', 'note', note));
      const actions = el('div', 'actions');
      if (this.stream) actions.append(button(quest ? 'Show it' : 'Scan the object', 'Enter', () => void this.captureFromCamera(), true));
      const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true; file.onchange = () => { const f = file.files?.[0]; if (f) void this.captureFromFile(f); };
      actions.append(button('Choose a photo', '', () => file.click(), !this.stream), file, button(quest ? 'Skip' : 'Close', 'Esc', () => this.close()));
      this.panel.append(actions);
    } else if (phase === 'thinking') {
      const ring = el('div', 'ring'); let i = 0; const line = el('p', 'lede', THINKING[0]);
      this.ticker = window.setInterval(() => { i = (i + 1) % THINKING.length; line.textContent = THINKING[i]; }, 1600);
      this.panel.append(ring, el('h2', '', this.quest ? 'The door is looking' : 'Reading your object'), line);
    } else if (phase === 'result' && this.weapon) {
      const w = this.weapon, color = hex(w.spell.color); this.panel.style.setProperty('--rift', color);
      const rarity = el('span', `rarity ${w.rarity}`, w.rarity);
      const damage = el('div', 'meter'); const fill = el('i'); fill.style.width = `${w.damage}%`; damage.append(fill);
      this.panel.append(rarity, el('h2', 'weapon-name', w.artifactName), el('p', 'from', `from your ${w.object}`),
        el('p', 'chips', `${w.element} · ${w.artifactType}`), el('p', 'ability', ABILITY_LABEL[w.ability]), damage, el('p', 'desc', w.description));
      if (w.source === 'fallback') this.panel.append(el('p', 'note', 'Gemini was unavailable, so the rift conjured a stand-in weapon.'));
      const actions = el('div', 'actions'); actions.append(button('Take it', 'Enter', () => this.equip(), true), button('Scan something else', '', () => void this.startCamera()));
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
