import type { PlayerIndex } from '../contracts';
import { SHAPE_ABILITY, type WandShape } from './forge';
import { ARCANE_COLOR, ELEMENT_COLOR, type Weapon } from './weapon';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SHAPE_ICON: Record<WandShape, string> = { circle: '○', triangle: '△', square: '□', star: '☆' };

/**
 * Both of each hero's weapons at a glance: the sword (phone slash or J) and the wand (drawn shapes or F), the relic
 * element infusing both, and the wand's last shape with its cooldown. Event-driven (no per-frame work); all text
 * goes through textContent.
 */
export class WeaponsHud {
  readonly root = document.createElement('aside');
  private names: string[] = [''];
  private readonly relics: (Weapon | undefined)[] = [];
  private readonly last: (WandShape | undefined)[] = [];

  constructor(parent: HTMLElement = document.body) {
    this.root.className = 'weapons-hud'; this.root.setAttribute('aria-label', 'Weapons'); this.root.hidden = true;
    parent.append(this.root);
  }

  setHeroes(names: string[]): void { this.names = names.length ? names.slice(0, 2) : ['']; this.root.hidden = false; this.render(); }
  setRelic(hero: PlayerIndex, relic: Weapon | undefined): void { this.relics[hero] = relic; this.render(); }

  /** A drawn shape was cast: show it and run its cooldown bar. */
  cast(hero: PlayerIndex, shape: WandShape, cooldown: number): void {
    this.last[hero] = shape; this.render();
    const bar = this.root.querySelector<HTMLElement>(`[data-hero="${hero}"] .wand-cool`);
    if (bar) bar.style.animation = `wand-cool ${cooldown}s linear forwards`;
  }

  dispose(): void { this.root.remove(); }

  private render(): void {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
    this.root.replaceChildren(...this.names.map((name, hero) => {
      const relic = this.relics[hero], shape = this.last[hero], element = relic?.element;
      const row = el('div', 'weapons-row'); row.dataset.hero = String(hero); row.style.setProperty('--rift', hex(element ? ELEMENT_COLOR[element] : ARCANE_COLOR));
      if (this.names.length > 1) row.append(el('b', 'weapons-name', name));
      const sword = el('span', 'weapon-slot'); sword.append(el('i', 'icon', '⚔'), el('span', '', `Sword · ${element ?? 'steel'}`));
      const wand = el('span', 'weapon-slot wand'); wand.append(el('i', 'icon', '✦'), el('span', '', `Wand · ${element ?? 'arcane'}${shape ? ` · ${SHAPE_ICON[shape]} ${SHAPE_ABILITY[shape]}` : ''}`), el('i', 'wand-cool'));
      row.append(sword, wand, el('span', 'weapon-relic', relic ? `Relic: ${relic.artifactName}` : 'No relic · X to scan'));
      return row;
    }));
  }
}
