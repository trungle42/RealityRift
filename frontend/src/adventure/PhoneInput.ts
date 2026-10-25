import { MAX_PLAYERS, currentStick, parseButton, parsePlayer, parseStick, type PhoneButton, type PhoneCommand, type StickMove } from './phoneMath';

export { MAX_PLAYERS, type PhoneButton };
/** What on() can listen for: a button press, or a player slot filling ('joined') or freeing ('left'). */
export type PhoneEvent = PhoneButton | 'joined' | 'left';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

/**
 * Listens for the phone joysticks through the backend relay (/ws/joystick/{room}). The phone page is served by the same
 * backend at /joystick. Up to MAX_PLAYERS phones play at once; the relay stamps each message with its sender's slot
 * (`player`, 0-2, the lowest free one when it joined). Each phone sends a stick, `action` (a quick tap), `scan`, `roll` and
 * `slash`. read(player) is that player's stick; on(event, handler) hears every player's buttons and joins / leaves.
 * The original single-phone API is unchanged: read() and onCommand are player 0, and onStatus says whether any phone is here.
 * Never throws: no backend or no phone just means no stick input.
 */
export class PhoneInput {
  readonly room: string;
  /** Any phone connected. */
  phoneConnected = false;
  private socket?: WebSocket;
  private sticks: ({ move: StickMove; at: number } | undefined)[] = [];
  private present = new Set<number>();
  private listeners = new Map<PhoneEvent, Set<(player: number) => void>>();
  private retry = 0;
  private timer = 0;
  private closed = false;

  constructor(private readonly onStatus: (connected: boolean) => void, private readonly clock: () => number = () => performance.now() / 1000,
    private readonly onCommand: (command: PhoneCommand) => void = () => {}) {
    this.room = (new URLSearchParams(location.search).get('room') ?? 'storybound').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'storybound';
    this.connect();
  }

  /** Where a phone should go: the internet tunnel's URL when the launcher started one (`demo.sh --tunnel`), else this
   * laptop's Wi-Fi address. It carries the room and the game's ?wand= order, so the phone page can name the player's colour. */
  async phoneUrl(): Promise<string> {
    const query = new URLSearchParams();
    if (this.room !== 'storybound') query.set('room', this.room);
    const wand = new URLSearchParams(location.search).get('wand')?.replace(/[^a-z,]/gi, '');
    if (wand) query.set('wand', wand);
    const search = query.toString().replace(/%2C/gi, ','), tail = `/joystick${search ? `?${search}` : ''}`;
    try {
      const info = (await (await fetch(`${API}/joystick/info`)).json()) as { lan_ip?: string | null; public_url?: string | null };
      if (info.public_url && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(info.public_url)) return `${info.public_url}${tail}`;
      const url = new URL(API); if (info.lan_ip) url.hostname = info.lan_ip;
      return `${url.origin}${tail}`;
    } catch { return `${API}${tail}`; }
  }

  /** That player's stick right now (none if that phone is gone or has gone quiet). */
  read(player = 0): StickMove { const s = this.sticks[player]; return currentStick(s?.move, s?.at ?? -Infinity, this.clock()); }

  connected(player: number): boolean { return this.present.has(player); }

  /** Connected player slots, lowest first. */
  players(): number[] { return [...this.present].sort((a, b) => a - b); }

  /** Hear a button from any player, or a player joining / leaving. Returns the way to stop listening. */
  on(event: PhoneEvent, handler: (player: number) => void): () => void {
    const set = this.listeners.get(event) ?? new Set(); set.add(handler); this.listeners.set(event, set);
    return () => { set.delete(handler); };
  }

  dispose(): void { this.closed = true; clearTimeout(this.timer); this.socket?.close(); this.listeners.clear(); }

  private emit(event: PhoneEvent, player: number): void {
    for (const handler of [...(this.listeners.get(event) ?? [])]) { try { handler(player); } catch (error) { console.error(error); } }
  }

  private setPresent(player: number, here: boolean): void {
    if (this.present.has(player) === here) return;
    if (here) this.present.add(player); else { this.present.delete(player); this.sticks[player] = undefined; }
    this.emit(here ? 'joined' : 'left', player);
    if (this.phoneConnected !== this.present.size > 0) { this.phoneConnected = this.present.size > 0; this.onStatus(this.phoneConnected); }
  }

  /** One message from the relay. */
  private handle(message: unknown): void {
    const player = parsePlayer(message);
    if (player === undefined) return;
    const peer = message as { type?: string; role?: string; state?: string };
    if (peer.type === 'peer' && peer.role === 'phone') { this.setPresent(player, peer.state === 'joined'); return; }
    const button = parseButton(message);
    if (button) {
      if (player === 0 && button !== 'slash') this.onCommand(button);
      this.emit(button, player);
      return;
    }
    const stick = parseStick(message);
    if (stick) this.sticks[player] = { move: stick, at: this.clock() };
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/joystick/${this.room}?role=game`);
      this.socket = socket;
      socket.onopen = () => { this.retry = 0; };
      socket.onmessage = (event) => {
        let message: unknown; try { message = JSON.parse(String(event.data)); } catch { return; }
        this.handle(message);
      };
      socket.onclose = () => {
        for (const player of this.players()) this.setPresent(player, false);
        if (!this.closed) this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 600 + this.retry++ * 600));
      };
      socket.onerror = () => socket.close();
    } catch { if (!this.closed) this.timer = window.setTimeout(() => this.connect(), 3000); }
  }
}
