import { bodyMoving, completedShape, CV_STALE_SECONDS, newEvents, newlyComplete, parseCv, parsePicture, PICTURE_STALE_SECONDS, type CameraPicture, type CvFrame, type CvPoint, type WandState } from './cvMath';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

export interface CvHandlers {
  status(connected: boolean): void;
  slash(): void;
  jump(): void;
  /** A wand colour just completed a shape: the one the game asked for, or any preset when it asked for none. */
  complete?(colour: string, wand: WandState): void;
}

/**
 * Listens for the body tracker (cv_2, `python -m tools.publish`) through the backend relay (/ws/cv/{room}, the same room code as
 * the phone joystick). Slash and jump arrive as running counts and fire their handler when the count goes up; motion and the
 * wand round are read when needed. The game drives the wand: it is on, for any shape, from the moment a tracker joins, and
 * gate() asks for a particular shape or switches it off. The tracker is the only program that opens the webcam, so its camera
 * picture comes through here too (camera(), for the wand panel), and the scanner uses this as its frame source (live, preview,
 * snapshot) instead of opening the camera itself. Never throws: no backend or no tracker just means no body input.
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
  private wanted: { on: boolean; target: string | null } = { on: true, target: null };
  /** Shapes completed since the wand was last re-aimed, for takeShape(). */
  private readonly drawn = new Set<string>();
  private picture?: { url: string; w: number; h: number; seq: number; at: number };
  private pictures = 0;
  private snapshots = 0;
  private readonly waiting = new Map<number, (picture: CameraPicture) => void>();

  constructor(private readonly handlers: CvHandlers, private readonly clock: () => number = () => performance.now() / 1000) {
    this.room = (new URLSearchParams(location.search).get('room') ?? 'storybound').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'storybound';
    this.connect();
  }

  /** The tracker sees the player moving (for the freeze trial). */
  moving(): boolean { return bodyMoving(this.latest?.motion, this.receivedAt, this.clock()); }

  /** The tracker's latest wand round, or undefined while it is silent. */
  wand(): WandState | undefined { return this.clock() - this.receivedAt <= CV_STALE_SECONDS ? this.latest?.wand ?? undefined : undefined; }

  /**
   * Switch the wand on or off and name the shape to draw (none: any preset, the player's choice). Safe to call every frame:
   * only a change is sent, and a change starts a fresh round in the tracker and forgets shapes drawn before it.
   */
  gate(on: boolean, target: string | null = null): void {
    if (this.wanted.on === on && this.wanted.target === target) return;
    this.wanted = { on, target }; this.drawn.clear(); this.sendGate();
  }

  /** Whether a wand completed `shape` since the last call (or since the wand was re-aimed); consumes it. */
  takeShape(shape: string): boolean { return this.drawn.delete(shape); }

  /** The tracker's latest camera picture (small, mirrored like a selfie) as a data URL, or undefined when none is fresh. */
  camera(): { url: string; w: number; h: number; seq: number } | undefined {
    return this.picture && this.clock() - this.picture.at <= PICTURE_STALE_SECONDS ? this.picture : undefined;
  }

  /** Where the tracker sees the phone's marker, or undefined. */
  phone(): CvPoint | undefined { return this.clock() - this.receivedAt <= CV_STALE_SECONDS ? this.latest?.phone ?? undefined : undefined; }

  /** What the tracker sees right now (each wand ball and the phone marker), for setup hints; undefined while it is silent. */
  seen(): Pick<CvFrame, 'wands' | 'phone'> | undefined { return this.clock() - this.receivedAt <= CV_STALE_SECONDS ? this.latest : undefined; }

  // The scanner's frame source: while a tracker sends pictures, the scan uses them instead of opening the webcam.
  get live(): boolean { return this.trackerConnected && !!this.camera(); }
  preview(): string | undefined { return this.camera()?.url; }

  /** One full-size, unmirrored picture from the tracker (for a scan); rejects if none arrives in time. */
  snapshot(timeoutMs = 4000): Promise<CameraPicture> {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN || !this.trackerConnected) { reject(new Error('no tracker')); return; }
      const id = ++this.snapshots;
      const timer = window.setTimeout(() => { this.waiting.delete(id); reject(new Error('the tracker sent no picture')); }, timeoutMs);
      this.waiting.set(id, (picture) => { window.clearTimeout(timer); resolve(picture); });
      this.socket.send(JSON.stringify({ type: 'snapshot', id }));
    });
  }

  dispose(): void { this.closed = true; clearTimeout(this.timer); this.socket?.close(); }

  /** One message from the relay. */
  private handle(message: unknown): void {
    const peer = message as { type?: string; role?: string; state?: string };
    if (peer.type === 'peer' && peer.role === 'tracker') {
      this.trackerConnected = peer.state === 'joined';
      // A tracker that comes back starts its counts again: forget the old ones so they are a fresh baseline. A tracker that
      // joins runs its own timer until told otherwise, so hand it the wand as the game wants it.
      if (!this.trackerConnected) { this.latest = undefined; this.picture = undefined; }
      else this.sendGate();
      this.handlers.status(this.trackerConnected);
      return;
    }
    const frame = parsePicture(message, 'frame');
    if (frame) { this.picture = { url: `data:image/jpeg;base64,${frame.jpeg}`, w: frame.w, h: frame.h, seq: ++this.pictures, at: this.clock() }; return; }
    const snapshot = parsePicture(message, 'snapshot');
    if (snapshot) { this.waiting.get(snapshot.id!)?.(snapshot); this.waiting.delete(snapshot.id!); return; }
    const cv = parseCv(message);
    if (cv) this.receive(cv);
  }

  private sendGate(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'gate', ...this.wanted }));
  }

  private receive(frame: CvFrame): void {
    const last = this.latest;
    this.latest = frame; this.receivedAt = this.clock();
    if (newEvents(last?.slash, frame.slash)) this.handlers.slash();
    if (newEvents(last?.jump, frame.jump)) this.handlers.jump();
    if (!frame.wand) return;
    for (const colour of newlyComplete(last?.wand?.complete, frame.wand.complete)) {
      const shape = completedShape(frame.wand, colour); if (shape) this.drawn.add(shape);
      this.handlers.complete?.(colour, frame.wand);
    }
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/cv/${this.room}?role=game`);
      this.socket = socket;
      socket.onopen = () => { this.retry = 0; };
      socket.onmessage = (event) => {
        let message: unknown; try { message = JSON.parse(String(event.data)); } catch { return; }
        this.handle(message);
      };
      socket.onclose = () => {
        this.latest = undefined; this.picture = undefined; if (this.trackerConnected) { this.trackerConnected = false; this.handlers.status(false); }
        if (!this.closed) this.timer = window.setTimeout(() => this.connect(), Math.min(5000, 600 + this.retry++ * 600));
      };
      socket.onerror = () => socket.close();
    } catch { if (!this.closed) this.timer = window.setTimeout(() => this.connect(), 3000); }
  }
}
