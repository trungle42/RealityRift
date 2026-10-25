import type { GameState } from '../game/GameState';
import type { Player, Storybook } from '../contracts';
import { REGIONS } from '../campaign/locations';
import { CENTERS, PATHS, type Position } from './terrain';
import type { WorldObject } from './World';

const icons = {
  sword: '<svg viewBox="0 0 24 24"><path d="m5 19 3-3m-2-3 5 5M9 14 18 3l3 0 0 3-11 9M3 21l3-3"/></svg>',
  spell: '<svg viewBox="0 0 24 24"><path d="m12 2 2.8 6.6L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-3.4Z"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="m3 5 6-2 6 3 6-2v16l-6 2-6-3-6 2Zm6-2v16m6-13v16"/></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M5 19c-7-13 7-12 15-16 0 13-3 19-12 15m-5 4L16 9"/></svg>',
};

export class Interface {
  readonly root = document.createElement('div');
  readonly modal = document.createElement('dialog');
  readonly map: HTMLCanvasElement;
  private readonly bar: HTMLElement;
  private readonly dialogue: HTMLElement;
  private readonly text: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly prompt: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private resolveLine?: () => void;
  private toastTimer = 0;
  private lastHearts = -1;
  private lastStars = -1;
  private mapOpen = false;
  onInteract = () => {};
  onAttack = () => {};
  onSpell = () => {};
  onDodge = () => {};
  onMap = () => {};
  onSound = () => {};
  onNarrate = (_text: string) => {};
  onSilence = () => {};

  constructor() {
    this.root.className = 'adventure-ui';
    this.root.innerHTML = `<div class="game-topshade"></div>
      <header class="game-status"><div class="game-brand">${icons.leaf}<span>STORYBOUND</span></div>
        <div class="game-vitals"><span class="game-hearts" aria-label="Shared health"></span><span class="game-stars">✧ 0</span></div>
        <div class="game-stamina" aria-label="Stamina"><i></i></div><span class="game-party"></span></header>
      <div class="game-compass"><span>W</span><i></i><span class="compass-north">N</span><i></i><span>E</span><b>◇</b></div>
      <aside class="game-location"><button class="game-map-button" aria-label="Open world map and journal"><canvas width="210" height="210" aria-label="Local map"></canvas><span class="map-key">M</span></button><p>Thistlewick Hollow</p><small>The kingdom of Evermere</small></aside>
      <section class="game-quest"><span class="quest-category">The stolen spring</span><h2>Find the old magic</h2><p>Follow the golden beacon</p></section>
      <div class="game-discovery" role="status"><span>Discovered</span><h2></h2></div>
      <div class="game-challenge" hidden><span></span><h2></h2><p></p><progress max="1" value="0"></progress></div>
      <div class="game-boss" hidden><span></span><div><i></i></div><small></small></div>
      <div class="game-context"><button class="game-interact" hidden><kbd>E</kbd><span>Interact</span></button></div>
      <section class="game-dialogue" hidden aria-live="polite"><span class="dialogue-speaker"></span><p></p><button>Continue <kbd>↵</kbd></button></section>
      <footer class="game-footer"><div class="game-move-hint"><kbd>W A S D</kbd><span>Move</span><span class="hint-divider">·</span><span>Drag to look</span></div>
        <div class="game-actions"><button data-action="attack" aria-label="Sword strike, J">${icons.sword}<kbd>J</kbd><span>Strike</span></button><button data-action="spell" aria-label="Cast spell, F">${icons.spell}<kbd>F</kbd><span>Spell</span></button><button data-action="dodge" aria-label="Dodge, Q"><span class="dodge-icon">↝</span><kbd>Q</kbd><span>Dodge</span></button></div>
        <div class="game-tools"><button class="sound-button" aria-label="Toggle sound" aria-pressed="true">♪</button><button class="journal-button" aria-label="Journal and controls">${icons.map}<kbd>M</kbd></button></div></footer>
      <div class="game-toast" role="status" aria-live="polite"></div>
      <div class="game-touch"><button data-key="KeyW" aria-label="Move forward">↑</button><div><button data-key="KeyA" aria-label="Move left">←</button><button data-key="KeyS" aria-label="Move back">↓</button><button data-key="KeyD" aria-label="Move right">→</button></div></div>
      <div class="game-vignette"></div><div class="game-damage"></div>`;
    document.body.append(this.root);
    this.modal.className = 'adventure-modal'; this.modal.setAttribute('aria-label', 'Adventure journal'); document.body.append(this.modal);
    this.modal.addEventListener('close', () => { this.mapOpen = false; });
    this.map = this.root.querySelector('canvas')!;
    this.bar = this.root.querySelector('.game-stamina i')!;
    this.dialogue = this.root.querySelector('.game-dialogue')!;
    this.text = this.dialogue.querySelector('p')!; this.speaker = this.root.querySelector('.dialogue-speaker')!;
    this.prompt = this.root.querySelector('.game-interact')!; this.notice = this.root.querySelector('.game-toast')!;
    this.prompt.onclick = () => this.onInteract();
    this.dialogue.querySelector('button')!.onclick = () => this.advance();
    this.root.querySelector<HTMLButtonElement>('[data-action="attack"]')!.onclick = () => this.onAttack();
    this.root.querySelector<HTMLButtonElement>('[data-action="spell"]')!.onclick = () => this.onSpell();
    this.root.querySelector<HTMLButtonElement>('[data-action="dodge"]')!.onclick = () => this.onDodge();
    this.root.querySelector<HTMLButtonElement>('.journal-button')!.onclick = () => this.onMap();
    this.root.querySelector<HTMLButtonElement>('.game-map-button')!.onclick = () => this.onMap();
    this.root.querySelector<HTMLButtonElement>('.sound-button')!.onclick = () => this.onSound();
  }

  get blocked(): boolean { return this.modal.open || !this.dialogue.hidden; }
  get journalOpen(): boolean { return this.mapOpen && this.modal.open; }
  get speaking(): boolean { return !this.dialogue.hidden; }
  advance(): void { this.resolveLine?.(); this.resolveLine = undefined; }

  async start(): Promise<[Player, Player]> {
    const overlay = document.createElement('section'); overlay.className = 'adventure-start';
    overlay.innerHTML = `<div class="start-content"><div class="start-flourish">✧</div><p class="start-subtitle">An Evermere adventure</p><h1>Storybound</h1><p class="start-tale">The last warm spring</p><p class="start-description">Beyond the familiar path, a kingdom waits.<br>Step into the tale. Make it your own.</p><form><div class="start-names"><label>Your hero<input name="hero" value="Rowan" maxlength="24" required autocomplete="off" aria-label="Your hero's name"></label><label>Your companion<input name="companion" value="Wren" maxlength="24" required autocomplete="off" aria-label="Companion's name"></label></div><button class="adventure-primary" type="submit">Begin your tale <span>↗</span></button></form><div class="start-controls"><span><kbd>W A S D</kbd> explore</span><span><kbd>Space</kbd> jump</span><span><kbd>E</kbd> interact</span></div><p class="start-footnote">An original fairy-tale world · Play solo or together</p></div>`;
    document.body.append(overlay); this.root.classList.add('before-start');
    return new Promise((resolve) => {
      const form = overlay.querySelector('form')!;
      form.onsubmit = (event) => {
        event.preventDefault(); const data = new FormData(form);
        const name = String(data.get('hero')).trim(), companion = String(data.get('companion')).trim();
        if (!name || !companion) return;
        overlay.remove(); this.root.classList.remove('before-start');
        resolve([{ index: 0, name }, { index: 1, name: companion }]);
      };
    });
  }

  update(state: GameState, stamina: number): void {
    if (state.hearts !== this.lastHearts) {
      const hearts = this.root.querySelector<HTMLElement>('.game-hearts')!;
      hearts.replaceChildren();
      for (let i = 0; i < 3; i++) { const heart = document.createElement('span'); heart.textContent = '♥'; heart.className = i < state.hearts ? 'full' : 'empty'; hearts.append(heart); }
      hearts.setAttribute('aria-label', `${state.hearts} of 3 shared hearts`); this.lastHearts = state.hearts;
    }
    const stars = state.stars[0] + state.stars[1];
    if (stars !== this.lastStars) { this.root.querySelector('.game-stars')!.textContent = `✧ ${stars}`; this.lastStars = stars; }
    this.bar.style.transform = `scaleX(${stamina})`;
    this.root.querySelector('.game-party')!.textContent = `${state.party[0].name} & ${state.party[1].name}`;
  }

  quest(name: string, detail: string): void { this.root.querySelector('.game-quest h2')!.textContent = name; this.root.querySelector('.game-quest p')!.textContent = detail; }
  context(name?: string): void { this.prompt.hidden = !name; if (name) this.prompt.querySelector('span')!.textContent = name; }
  toast(text: string): void { this.notice.textContent = text; this.notice.classList.add('visible'); clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => this.notice.classList.remove('visible'), 4000); }
  damage(): void { const node = this.root.querySelector('.game-damage')!; node.classList.remove('hurt'); void node.getBoundingClientRect(); node.classList.add('hurt'); }
  sound(enabled: boolean): void { const button = this.root.querySelector('.sound-button')!; button.setAttribute('aria-pressed', String(enabled)); button.textContent = enabled ? '♪' : '♫̸'; }

  discover(name: string): void {
    this.root.querySelector('.game-location p')!.textContent = name;
    const node = this.root.querySelector<HTMLElement>('.game-discovery')!; node.querySelector('h2')!.textContent = name;
    node.classList.remove('visible'); void node.getBoundingClientRect(); node.classList.add('visible');
  }

  async say(lines: string[], speaker = 'The storyteller'): Promise<void> {
    this.dialogue.hidden = false; this.context(); this.speaker.textContent = speaker;
    try { for (const line of lines) { this.text.textContent = line; this.onNarrate(line); await new Promise<void>((resolve) => { this.resolveLine = resolve; }); } }
    finally { this.resolveLine = undefined; this.dialogue.hidden = true; this.onSilence(); }
  }

  async choose(title: string, choices: { id: string; label: string }[]): Promise<string> {
    this.mapOpen = false;
    this.modal.replaceChildren(); const h = document.createElement('h2'); h.textContent = title; this.modal.append(h);
    const hint = document.createElement('p'); hint.textContent = 'A small choice can change a whole fairy tale.'; this.modal.append(hint);
    this.modal.showModal();
    return new Promise((resolve) => {
      const onCancel = (event: Event) => event.preventDefault(); this.modal.addEventListener('cancel', onCancel);
      choices.forEach((choice) => { const button = document.createElement('button'); button.className = 'adventure-choice'; button.textContent = choice.label; button.onclick = () => { this.modal.removeEventListener('cancel', onCancel); this.modal.close(); resolve(choice.id); }; this.modal.append(button); });
      this.modal.querySelector('button')?.focus();
    });
  }

  challenge(title?: string, detail = '', progress = 0): void {
    const node = this.root.querySelector<HTMLElement>('.game-challenge')!; node.hidden = !title;
    node.querySelector('span')!.textContent = 'Ancient magic'; node.querySelector('h2')!.textContent = title ?? '';
    node.querySelector('p')!.textContent = detail; node.querySelector('progress')!.value = progress;
  }

  boss(name?: string, fraction = 1, detail = ''): void {
    const node = this.root.querySelector<HTMLElement>('.game-boss')!; node.hidden = !name;
    node.querySelector('span')!.textContent = name ?? ''; node.querySelector('i')!.style.transform = `scaleX(${Math.max(0, fraction)})`; node.querySelector('small')!.textContent = detail;
  }

  journal(state: GameState): void {
    if (this.modal.open) { this.modal.close(); this.mapOpen = false; return; }
    if (this.speaking) return;
    this.modal.replaceChildren(); this.modal.setAttribute('aria-label', 'World map and journal');
    const label = document.createElement('p'); label.className = 'journal-kicker'; label.textContent = 'Your adventure';
    const title = document.createElement('h2'); title.textContent = 'The kingdom of Evermere';
    const map = document.createElement('canvas'); map.width = 660; map.height = 460; map.className = 'journal-worldmap';
    const current = document.createElement('p'); current.textContent = this.root.querySelector('.game-quest h2')!.textContent;
    const controls = document.createElement('p'); controls.className = 'journal-controls'; controls.textContent = 'WASD move · Shift sprint · Space jump · Drag / C,V look · Scroll zoom · E interact · J strike · F spell · Q dodge · M journal. Rune poses: hold 1 to raise your arms, 2 to spread your arms, 3 to crouch. Player two: arrows move, / spell, I/O/P poses. Your companion follows and assists when not controlled.';
    const rewards = document.createElement('p'); rewards.textContent = `Relics: ${state.rewards.map((r) => r.name).join(', ') || 'Your story is still unfolding.'}`;
    const close = document.createElement('button'); close.className = 'adventure-primary'; close.textContent = 'Return to the world'; close.onclick = () => { this.modal.close(); this.mapOpen = false; };
    this.modal.append(label, title, map, current, rewards, controls, close); this.mapOpen = true; this.modal.showModal();
  }

  drawMap(player: Position, companion: Position, target: Position | undefined, objects: WorldObject[], yaw: number): void {
    this.paintMap(this.map, player, companion, target, objects, false, yaw);
    const large = this.mapOpen ? this.modal.querySelector('canvas') : null;
    if (large) this.paintMap(large, player, companion, target, objects, true, yaw);
    const compass = this.root.querySelector<HTMLElement>('.game-compass')!;
    const angle = target ? Math.atan2(target.x - player.x, -(target.z - player.z)) + yaw : 0;
    const bearing = Math.atan2(Math.sin(angle), Math.cos(angle));
    compass.querySelector('b')!.style.transform = `translateX(${Math.max(-95, Math.min(95, bearing * 50))}px)`;
  }

  private paintMap(canvas: HTMLCanvasElement, player: Position, companion: Position, target: Position | undefined, objects: WorldObject[], full: boolean, yaw: number): void {
    const ctx = canvas.getContext('2d')!, w = canvas.width, h = canvas.height;
    const scale = full ? w / 145 : 2.8;
    const x = (v: number) => w / 2 + (v - (full ? 0 : player.x)) * scale;
    const z = (v: number) => h / 2 + (v - (full ? -5 : player.z)) * scale;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#324d40'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#365e50'; ctx.beginPath(); ctx.ellipse(x(30), z(24), 17 * scale, 17 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b4b28a'; ctx.globalAlpha = 0.6; ctx.lineWidth = full ? 5 : 4;
    for (const path of PATHS) { ctx.beginPath(); path.forEach((p, i) => i ? ctx.lineTo(x(p.x), z(p.z)) : ctx.moveTo(x(p.x), z(p.z))); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (const env of ['forest', 'castle', 'cave'] as const) {
      const c = CENTERS[env]; ctx.fillStyle = '#b3c1a3'; ctx.strokeStyle = '#b3c1a3'; ctx.strokeRect(x(c.x) - 6, z(c.z) - 6, 12, 12);
      if (full) { ctx.font = '15px Georgia'; ctx.textAlign = 'center'; ctx.fillText(REGIONS[env].name, x(c.x), z(c.z) + 27); }
    }
    if (full) { ctx.fillStyle = '#b3c1a3'; ctx.textAlign = 'center'; ctx.fillText('Thistlewick', x(0), z(35) + 16); }
    for (const object of objects.filter((o) => !o.used)) { ctx.fillStyle = object.kind === 'shrine' ? '#9fdacc' : '#d6bd80'; ctx.fillRect(x(object.x) - 2, z(object.z) - 2, 4, 4); }
    if (target) { ctx.fillStyle = '#f5d58a'; ctx.save(); ctx.translate(x(target.x), z(target.z)); ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); ctx.restore(); }
    ctx.fillStyle = '#dfb88b'; ctx.beginPath(); ctx.arc(x(companion.x), z(companion.z), 3, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x(player.x), z(player.z)); ctx.rotate(-yaw); ctx.fillStyle = '#fcf8dc'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.restore();
    canvas.setAttribute('aria-label', `World map. Your position ${player.x.toFixed(1)}, ${player.z.toFixed(1)}. Gold diamond: current quest.`);
  }

  async ending(book: Storybook): Promise<void> {
    this.mapOpen = false;
    this.modal.addEventListener('cancel', (event) => event.preventDefault());
    this.modal.replaceChildren(); this.modal.setAttribute('aria-label', 'Your storybook');
    const title = document.createElement('h2'); title.textContent = book.title; this.modal.append(title);
    for (const page of book.pages) { const h = document.createElement('h3'), p = document.createElement('p'); h.textContent = page.heading; p.textContent = page.text; this.modal.append(h, p); }
    const again = document.createElement('button'); again.className = 'adventure-primary'; again.textContent = 'Write a new tale'; again.onclick = () => location.reload(); this.modal.append(again); this.modal.showModal();
  }
}
