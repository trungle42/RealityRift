import type { PlayerIndex } from '../contracts';
import { NO_STICK, type StickMove } from './phoneMath';

/**
 * Adapter between PhoneInput and the player slots: slot 0 = hero one, slot 1 = hero two, slot 2 = Pip the fairy. The
 * per-player PhoneInput (relay stamps `player` by join order) has `on(event, handler(player))`, `connected(player)` and
 * `read(player)`; the single-phone one has none of them, so everything here is feature-detected and the game behaves as
 * before until the per-player PhoneInput is on main.
 */
export type PhoneButton = 'action' | 'scan' | 'roll' | 'slash';
export type PlayerSlot = 0 | 1 | 2;
export interface PlayerPhoneHandlers {
  joined(slot: PlayerSlot): void;
  left(slot: PlayerSlot): void;
  button(kind: PhoneButton, slot: PlayerSlot): void;
}
interface PerPlayerPhone {
  on?(event: string, handler: (player: number) => void): () => void;
  connected?(player: number): boolean;
  read(player?: number): StickMove;
}

const asSlot = (player: number): PlayerSlot | undefined => (player === 0 || player === 1 || player === 2 ? player : undefined);

/**
 * Subscribe to every phone slot. Player 0's action / scan / roll also arrive on PhoneInput's own onCommand (which the game
 * already handles), so they are skipped here to avoid acting twice; player 0's slash comes only from here.
 */
export function listenPlayers(phone: PerPlayerPhone | undefined, handlers: PlayerPhoneHandlers): () => void {
  if (!phone?.on) return () => {};
  const on = phone.on.bind(phone);
  const offs = [
    on('joined', (p) => { const slot = asSlot(p); if (slot !== undefined) handlers.joined(slot); }),
    on('left', (p) => { const slot = asSlot(p); if (slot !== undefined) handlers.left(slot); }),
    ...(['action', 'scan', 'roll', 'slash'] as const).map((kind) => on(kind, (p) => {
      const slot = asSlot(p);
      if (slot !== undefined && (slot > 0 || kind === 'slash')) handlers.button(kind, slot);
    })),
  ];
  return () => offs.forEach((off) => off());
}

/** Is a phone in this slot? (The single-phone PhoneInput only knows slot 0.) */
export function slotConnected(phone: (PerPlayerPhone & { phoneConnected?: boolean }) | undefined, slot: PlayerSlot): boolean {
  if (!phone) return false;
  return phone.connected ? phone.connected(slot) : slot === 0 && !!phone.phoneConnected;
}

/** A hero's stick: slot 1 is only read while a slot-1 phone is connected, so the single-phone PhoneInput never mixes them. */
export function stickOf(phone: PerPlayerPhone | undefined, hero: PlayerIndex): StickMove {
  if (!phone || (hero === 1 && !slotConnected(phone, 1))) return NO_STICK;
  return phone.read(hero);
}
