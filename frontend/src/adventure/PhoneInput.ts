import { currentStick, parseCommand, parseStick, type PhoneCommand, type StickMove } from './phoneMath';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

/**
 * Listens for the phone joystick through the backend relay (/ws/joystick/{room}). The phone page is served
 * by the same backend at /joystick. Besides the stick it sends `action` (a quick tap), `scan` and `roll`, handed to
 * onCommand. Never throws: no backend or no phone just means no stick input.
 */
export class PhoneInput {
  readonly room: string;
  phoneConnected = false;
  private socket?: WebSocket;
  private latest?: StickMove;
  private receivedAt = -Infinity;
  private retry = 0;
  private timer = 0;
  private closed = false;

  constructor(private readonly onStatus: (connected: boolean) => void, private readonly clock: () => number = () => performance.now() / 1000,
    private readonly onCommand: (command: PhoneCommand) => void = () => {}) {
    this.room = (new URLSearchParams(location.search).get('room') ?? 'storybound').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'storybound';
    this.connect();
  }

  /** Where a phone on the same network should go. */
  async phoneUrl(): Promise<string> {
    try {
      const info = (await (await fetch(`${API}/joystick/info`)).json()) as { lan_ip?: string | null };
      const url = new URL(API); if (info.lan_ip) url.hostname = info.lan_ip;
      return `${url.origin}/joystick${this.room === 'storybound' ? '' : `?room=${this.room}`}`;
    } catch { return `${API}/joystick`; }
  }

  read(): StickMove { return currentStick(this.latest, this.receivedAt, this.clock()); }

  dispose(): void { this.closed = true; clearTimeout(this.timer); this.socket?.close(); }

  /** One message from the relay. */
  private handle(message: unknown): void {
    const peer = message as { type?: string; role?: string; state?: string };
    if (peer.type === 'peer' && peer.role === 'phone') {
      this.phoneConnected = peer.state === 'joined';
      if (!this.phoneConnected) this.latest = undefined;
      this.onStatus(this.phoneConnected);
      return;
    }
    const command = parseCommand(message);
    if (command) { this.onCommand(command); return; }
    const stick = parseStick(message);
    if (stick) { this.latest = stick; this.receivedAt = this.clock(); }
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
        this.latest = undefined; if (this.phoneConnected) { this.phoneConnected = false; this.onStatus(false); }
        if (!this.closed) this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 600 + this.retry++ * 600));
      };
      socket.onerror = () => socket.close();
    } catch { if (!this.closed) this.timer = window.setTimeout(() => this.connect(), 3000); }
  }
}
