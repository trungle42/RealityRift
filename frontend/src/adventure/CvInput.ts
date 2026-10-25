import { bodyMoving, CV_STALE_SECONDS, newEvents, newlyComplete, parseCv, type CvFrame, type WandState } from './cvMath';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

export interface CvHandlers {
  status(connected: boolean): void;
  slash(): void;
  jump(): void;
  /** A wand colour's drawing just matched the round's target shape. */
  complete?(colour: string, wand: WandState): void;
}

/**
 * Listens for the body tracker (cv_2, `python -m tools.publish`) through the backend relay (/ws/cv/{room}, the same room code as
 * the phone joystick). Slash and jump arrive as running counts and fire their handler when the count goes up; motion and the
 * wand round are read when needed. Never throws: no backend or no tracker just means no body input.
 */
export class CvInput {
  readonly room: string;
  trackerConnected = false;
  private socket?: WebSocket;
  private latest?: CvFrame;
  private receivedAt = -Infinity;
  private retry = 0;
  private timer = 0;
  private closed = false;

  constructor(private readonly handlers: CvHandlers, private readonly clock: () => number = () => performance.now() / 1000) {
    this.room = (new URLSearchParams(location.search).get('room') ?? 'storybound').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'storybound';
    this.connect();
  }

  /** The tracker sees the player moving (for the freeze trial). */
  moving(): boolean { return bodyMoving(this.latest?.motion, this.receivedAt, this.clock()); }

  /** The tracker's latest wand round, or undefined while it is silent. */
  wand(): WandState | undefined { return this.clock() - this.receivedAt <= CV_STALE_SECONDS ? this.latest?.wand ?? undefined : undefined; }

  /** Ask the tracker to start or stop the wand round. Relayed, but the tracker does not act on it yet (its round runs on a timer). */
  gate(on: boolean, target?: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'gate', on, target }));
  }

  dispose(): void { this.closed = true; clearTimeout(this.timer); this.socket?.close(); }

  private receive(frame: CvFrame): void {
    const last = this.latest;
    this.latest = frame; this.receivedAt = this.clock();
    if (newEvents(last?.slash, frame.slash)) this.handlers.slash();
    if (newEvents(last?.jump, frame.jump)) this.handlers.jump();
    if (frame.wand) for (const colour of newlyComplete(last?.wand?.complete, frame.wand.complete)) this.handlers.complete?.(colour, frame.wand);
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/cv/${this.room}?role=game`);
      this.socket = socket;
      socket.onopen = () => { this.retry = 0; };
      socket.onmessage = (event) => {
        let message: unknown; try { message = JSON.parse(String(event.data)); } catch { return; }
        const peer = message as { type?: string; role?: string; state?: string };
        if (peer.type === 'peer' && peer.role === 'tracker') {
          this.trackerConnected = peer.state === 'joined';
          // A tracker that comes back starts its counts again: forget the old ones so they are a fresh baseline.
          if (!this.trackerConnected) this.latest = undefined;
          this.handlers.status(this.trackerConnected);
          return;
        }
        const frame = parseCv(message);
        if (frame) this.receive(frame);
      };
      socket.onclose = () => {
        this.latest = undefined; if (this.trackerConnected) { this.trackerConnected = false; this.handlers.status(false); }
        if (!this.closed) this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 600 + this.retry++ * 600));
      };
      socket.onerror = () => socket.close();
    } catch { if (!this.closed) this.timer = window.setTimeout(() => this.connect(), 3000); }
  }
}
