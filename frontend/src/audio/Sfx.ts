/** Tiny synthesized sound effects so the game has no audio assets to load. */
export class Sfx {
  private ctx: AudioContext | null = null;

  /** Must be called from a user gesture before sounds will play. */
  unlock(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  chime(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.12, i * 0.07));
  }

  success(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.14, i * 0.1));
  }

  fail(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.06, i * 0.14));
  }

  zap(): void {
    this.tone(1200, 0.18, 'square', 0.05, 0, 300);
  }

  impact(): void {
    this.noise(0.25, 0.25, 900);
    this.tone(110, 0.3, 'sine', 0.25, 0, 40);
  }

  hurt(): void {
    this.tone(220, 0.35, 'sawtooth', 0.12, 0, 90);
    this.noise(0.2, 0.15, 600);
  }

  freeze(): void {
    [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.6, 'sine', 0.06, i * 0.05));
  }

  roar(): void {
    this.noise(1.2, 0.35, 300);
    this.tone(70, 1.2, 'sawtooth', 0.14, 0, 45);
  }

  tick(): void {
    this.tone(880, 0.06, 'square', 0.04);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(dur: number, gain: number, cutoff: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start();
  }
}
