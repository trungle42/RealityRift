/**
 * Story screens for the short demo run: an RPG-style NPC briefing that ends in a quest card, a boss title card,
 * and the quest-complete (or fallen) result. DOM overlays above the 3D world, styled in adventure.css.
 */
export interface Quest { title: string; summary: string; objectives: string[] }
export interface Speaker { name: string; title: string; portrait: string }
export interface RunResult { victory: boolean; seconds: number; foes: number; hearts: number; stars: number; hero: string; closing: string }

const CHARS_PER_SEC = 55;

export class Cinematics {
  onNarrate = (_text: string) => {};
  onSilence = () => {};
  private active = false;

  /** True while a briefing or result screen owns the keyboard. */
  get open(): boolean { return this.active; }

  /** Typewriter dialogue with a portrait; Space / Enter / E (or a click) finishes a line, then advances. Ends on a quest card to accept. */
  async briefing(speaker: Speaker, lines: string[], quest: Quest): Promise<void> {
    this.active = true;
    const root = element('section', 'npc-briefing');
    root.innerHTML = `<div class="npc-panel"><div class="npc-portrait"><img alt=""></div><div class="npc-body"><div class="npc-name"><strong></strong><span></span></div><p class="npc-line"></p><div class="npc-next"><span class="npc-step"></span><kbd>Space</kbd> continue</div></div></div>`;
    root.querySelector('img')!.src = speaker.portrait;
    root.querySelector('img')!.alt = speaker.name;
    root.querySelector('.npc-name strong')!.textContent = speaker.name;
    root.querySelector('.npc-name span')!.textContent = speaker.title;
    document.body.append(root);
    requestAnimationFrame(() => root.classList.add('visible'));
    const text = root.querySelector<HTMLElement>('.npc-line')!, step = root.querySelector<HTMLElement>('.npc-step')!;
    try {
      for (let i = 0; i < lines.length; i++) {
        step.textContent = `${i + 1} / ${lines.length}`;
        this.onNarrate(lines[i]);
        await this.typeLine(text, lines[i], root);
        await this.waitForAdvance(root);
      }
      this.onSilence();
      await this.questCard(root, quest);
    } finally {
      root.classList.remove('visible');
      window.setTimeout(() => root.remove(), 350);
      this.active = false;
    }
  }

  /** A sweeping title card as the boss arrives; it fades by itself. */
  bossIntro(name: string, epithet: string): void {
    const card = element('div', 'boss-intro');
    card.innerHTML = '<span></span><h1></h1><i></i>';
    card.querySelector('span')!.textContent = epithet;
    card.querySelector('h1')!.textContent = name;
    document.body.append(card);
    requestAnimationFrame(() => card.classList.add('visible'));
    window.setTimeout(() => card.classList.remove('visible'), 2600);
    window.setTimeout(() => card.remove(), 3300);
  }

  /** The closing screen: quest complete (or the hero fell), with the run's numbers and a replay button. */
  async result(run: RunResult): Promise<void> {
    this.active = true;
    const root = element('section', `run-result ${run.victory ? 'won' : 'lost'}`);
    const time = `${Math.floor(run.seconds / 60)}:${String(Math.round(run.seconds % 60)).padStart(2, '0')}`;
    root.innerHTML = `<div class="result-card"><span class="result-kicker"></span><h1></h1><p class="result-line"></p>
      <dl><div><dt>Time</dt><dd>${time}</dd></div><div><dt>Foes defeated</dt><dd>${run.foes}</dd></div><div><dt>Hearts left</dt><dd>${'♥'.repeat(run.hearts) || '—'}</dd></div><div><dt>Starlight</dt><dd>✧ ${run.stars}</dd></div></dl>
      <blockquote></blockquote><button class="adventure-primary" type="button"></button></div>`;
    root.querySelector('.result-kicker')!.textContent = run.victory ? 'Quest complete' : 'The tale is unfinished';
    root.querySelector('h1')!.textContent = run.victory ? 'The Last Warm Spring' : 'The Frost Holds';
    root.querySelector('.result-line')!.textContent = run.victory
      ? `${run.hero} broke Morwen's ward and the spring flows again. Evermere is warm once more.`
      : `${run.hero} fell to the frost — but every legend gets a second chapter.`;
    root.querySelector('blockquote')!.textContent = run.closing;
    const again = root.querySelector('button')!;
    again.textContent = run.victory ? 'Play again' : 'Try again';
    document.body.append(root);
    requestAnimationFrame(() => root.classList.add('visible'));
    again.focus();
    await new Promise<void>((resolve) => { again.onclick = () => resolve(); });
    location.reload();
  }

  private typeLine(target: HTMLElement, line: string, root: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      let shown = 0, last = performance.now(), done = false;
      const finish = () => { if (done) return; done = true; target.textContent = line; root.classList.remove('typing'); cleanup(); resolve(); };
      const tick = (now: number) => {
        if (done) return;
        shown = Math.min(line.length, shown + (now - last) / 1000 * CHARS_PER_SEC); last = now;
        target.textContent = line.slice(0, Math.floor(shown));
        if (shown >= line.length) finish(); else requestAnimationFrame(tick);
      };
      const cleanup = this.listen(root, finish);
      root.classList.add('typing'); requestAnimationFrame(tick);
    });
  }

  private waitForAdvance(root: HTMLElement): Promise<void> {
    return new Promise((resolve) => { const cleanup = this.listen(root, () => { cleanup(); resolve(); }); });
  }

  private questCard(root: HTMLElement, quest: Quest): Promise<void> {
    const card = element('div', 'quest-card');
    card.innerHTML = '<span class="quest-new">New quest</span><h2></h2><p></p><ul></ul><button class="adventure-primary" type="button">Accept quest <kbd>Enter</kbd></button>';
    card.querySelector('h2')!.textContent = quest.title;
    card.querySelector('p')!.textContent = quest.summary;
    for (const objective of quest.objectives) { const li = document.createElement('li'); li.textContent = objective; card.querySelector('ul')!.append(li); }
    root.append(card); root.classList.add('accepting');
    requestAnimationFrame(() => card.classList.add('visible'));
    return new Promise((resolve) => {
      const accept = () => { cleanup(); resolve(); };
      card.querySelector('button')!.onclick = accept;
      const cleanup = this.listen(root, accept, ['Enter', 'Space', 'KeyE']);
    });
  }

  /**
   * Advance on Space / Enter / E or a click on the panel. Keys are captured so the game underneath doesn't also
   * jump or interact; returns a remover.
   */
  private listen(root: HTMLElement, action: () => void, codes = ['Enter', 'Space', 'KeyE']): () => void {
    const key = (event: KeyboardEvent) => {
      if (!codes.includes(event.code)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) action();
    };
    const click = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('.quest-card')) action(); };
    window.addEventListener('keydown', key, true); root.addEventListener('click', click);
    return () => { window.removeEventListener('keydown', key, true); root.removeEventListener('click', click); };
  }
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag); node.className = className; return node;
}
