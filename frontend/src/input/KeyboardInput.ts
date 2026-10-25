import type { InputEvent, InputSource, PlayerFrame, PlayerIndex, PoseId } from '../contracts';

interface KeyMap {
  left: string;
  right: string;
  cast: string;
  poses: Record<string, PoseId>;
}

/**
 * Keyboard fallback controls (MVP item 8). Any key a player holds counts as
 * motion, so tapping keys during a freeze spell gets you caught.
 */
export const KEYMAPS: [KeyMap, KeyMap] = [
  { left: 'KeyA', right: 'KeyD', cast: 'KeyW', poses: { Digit1: 'arms-up', Digit2: 't-pose', Digit3: 'crouch', KeyS: 'crouch' } },
  { left: 'ArrowLeft', right: 'ArrowRight', cast: 'ArrowUp', poses: { KeyI: 'arms-up', KeyO: 't-pose', KeyP: 'crouch', ArrowDown: 'crouch' } },
];

const MOTION_LINGER_SEC = 0.35;

export class KeyboardInput implements InputSource {
  private readonly held = new Set<string>();
  private readonly lastActive: [number, number] = [-Infinity, -Infinity];
  private readonly poseOrder: [string[], string[]] = [[], []];
  private readonly listeners = new Set<(e: InputEvent) => void>();

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  read(player: PlayerIndex): PlayerFrame {
    const map = KEYMAPS[player];
    const owned = [map.left, map.right, map.cast, ...Object.keys(map.poses)];
    const holding = owned.some((k) => this.held.has(k));
    const since = performance.now() / 1000 - this.lastActive[player];
    const motion = holding ? 1 : Math.max(0, 1 - since / MOTION_LINGER_SEC);
    const order = this.poseOrder[player];
    const poseKey = order[order.length - 1];
    return { present: true, motion, pose: poseKey ? map.poses[poseKey] : null };
  }

  subscribe(listener: (e: InputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    this.listeners.clear();
  }

  private readonly onDown = (e: KeyboardEvent) => {
    if (e.target instanceof Element && e.target.closest('dialog')) return;
    if (e.target instanceof Element && e.target.closest('button') && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    this.held.add(e.code);

    if (e.code === 'Space' || e.code === 'Enter') {
      if (!e.repeat) this.emit({ player: null, kind: 'confirm' });
      return;
    }
    KEYMAPS.forEach((map, i) => {
      const player = i as PlayerIndex;
      const isPose = e.code in map.poses;
      if (![map.left, map.right, map.cast].includes(e.code) && !isPose) return;
      this.lastActive[player] = performance.now() / 1000;
      if (isPose && !this.poseOrder[player].includes(e.code)) this.poseOrder[player].push(e.code);
      if (e.repeat) return;
      if (e.code === map.left) this.emit({ player, kind: 'left' });
      if (e.code === map.right) this.emit({ player, kind: 'right' });
      if (e.code === map.cast) this.emit({ player, kind: 'cast' });
    });
  };

  private readonly onUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
    KEYMAPS.forEach((map, i) => {
      const player = i as PlayerIndex;
      if (e.code in map.poses || [map.left, map.right, map.cast].includes(e.code)) this.lastActive[player] = performance.now() / 1000;
      this.poseOrder[player] = this.poseOrder[player].filter((k) => k !== e.code);
    });
  };

  private readonly onBlur = () => {
    this.held.clear();
    this.poseOrder[0] = [];
    this.poseOrder[1] = [];
  };

  private emit(e: InputEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
}
