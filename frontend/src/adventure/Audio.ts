/**
 * Procedural sound for the 3D adventure: no audio files, nothing to license.
 * A small mixing graph (sfx / music / ambience buses -> compressor), a generated reverb,
 * a living forest bed, gentle generative music that swells in combat, and layered combat foley.
 */
type Region = 'forest' | 'castle' | 'cave';
const PENTA = [0, 2, 4, 7, 9];

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private sfxBus!: GainNode; private musicBus!: GainNode; private ambBus!: GainNode; private reverb!: ConvolverNode; private send!: GainNode;
  private noiseBuf!: AudioBuffer;
  private windGain?: GainNode; private windFilter?: BiquadFilterNode; private dripTimer = 0; private birdTimer = 2; private noteTimer = 1; private chordTimer = 0;
  private padGains: GainNode[] = []; private padOsc: OscillatorNode[] = [];
  private combat = 0; private combatTarget = 0; private beatTimer = 0; private chord = 0; private region: Region = 'forest';
  private muted = false;

  unlock(): void {
    if (!this.ctx) this.build();
    void this.ctx!.resume();
  }
  setMuted(muted: boolean): void { this.muted = muted; if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.1); }
  setCombat(active: boolean): void { this.combatTarget = active ? 1 : 0; }
  setRegion(region: Region): void { this.region = region; }

  private build(): void {
    const ctx = this.ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.42; this.musicBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.5; this.ambBus.connect(this.master);
    // Generated stereo impulse response: a soft forest-glade reverb.
    const len = Math.floor(ctx.sampleRate * 2.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir; this.send = ctx.createGain(); this.send.gain.value = 0.55; this.send.connect(this.reverb).connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const n = this.noiseBuf.getChannelData(0); for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    // Wind bed: looped noise through a slowly breathing band-pass.
    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuf; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 420; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.07; wind.connect(this.windFilter).connect(this.windGain).connect(this.ambBus); wind.start();
    // Music pad: two detuned voices per chord tone through a warm low-pass.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.3; lp.connect(this.musicBus); lp.connect(this.send);
    for (let i = 0; i < 3; i++) for (const det of [-6, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det; const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g).connect(lp); o.start(); this.padOsc.push(o); this.padGains.push(g);
    }
  }

  private get t(): number { return this.ctx!.currentTime; }
  private out(wet = 0.25): GainNode { const g = this.ctx!.createGain(); g.connect(this.sfxBus); if (wet > 0) { const s = this.ctx!.createGain(); s.gain.value = wet; g.connect(s).connect(this.send); } return g; }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, o: { delay?: number; slide?: number; wet?: number; attack?: number; bus?: AudioNode; detune?: number } = {}): void {
    if (!this.ctx) return; const ctx = this.ctx, t = this.t + (o.delay ?? 0);
    const osc = ctx.createOscillator(), amp = ctx.createGain(); osc.type = type; osc.frequency.setValueAtTime(freq, t); if (o.detune) osc.detune.value = o.detune;
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    amp.gain.setValueAtTime(0.0001, t); amp.gain.exponentialRampToValueAtTime(gain, t + (o.attack ?? 0.006)); amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const dest = o.bus ?? this.out(o.wet ?? 0.25); osc.connect(amp).connect(dest); osc.start(t); osc.stop(t + dur + 0.05);
  }
  private noise(dur: number, gain: number, o: { type?: BiquadFilterType; freq?: number; to?: number; q?: number; delay?: number; wet?: number; attack?: number } = {}): void {
    if (!this.ctx) return; const ctx = this.ctx, t = this.t + (o.delay ?? 0);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = o.type ?? 'lowpass'; f.frequency.setValueAtTime(o.freq ?? 1200, t); f.Q.value = o.q ?? 0.7;
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const amp = ctx.createGain(); amp.gain.setValueAtTime(0.0001, t); amp.gain.exponentialRampToValueAtTime(gain, t + (o.attack ?? 0.005)); amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(amp).connect(this.out(o.wet ?? 0.2)); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  // ---- foley -------------------------------------------------------------------------------
  footstep(surface: 'grass' | 'stone' | 'water', run: boolean, volume = 1): void {
    const v = (run ? 0.5 : 0.34) * volume;
    if (surface === 'stone') { this.noise(0.09, v * 0.9, { type: 'bandpass', freq: 2400 + Math.random() * 900, q: 1.4, wet: 0.15 }); this.tone(140 + Math.random() * 30, 0.06, 'sine', v * 0.35, { wet: 0 }); }
    else if (surface === 'water') this.noise(0.22, v, { type: 'bandpass', freq: 900, to: 2200, q: 1.1, wet: 0.3 });
    else { this.noise(0.13, v * 0.8, { type: 'highpass', freq: 1800 + Math.random() * 1600, wet: 0.08 }); this.noise(0.08, v * 0.5, { freq: 500, wet: 0 }); }
  }
  swing(step: number): void {
    this.noise(0.24 + step * 0.04, 0.42, { type: 'bandpass', freq: 600, to: 3200 + step * 500, q: 1.6, wet: 0.15, attack: 0.04 });
    this.tone(260 + step * 60, 0.12, 'triangle', 0.05, { slide: 520, wet: 0 });
  }
  hit(heavy = false, crit = false): void {
    this.noise(heavy ? 0.32 : 0.2, heavy ? 0.6 : 0.45, { freq: 2600, to: 400, wet: 0.2 });
    this.tone(heavy ? 85 : 120, heavy ? 0.34 : 0.22, 'sine', heavy ? 0.55 : 0.4, { slide: 45, wet: 0 });
    // Metallic ring of the blade.
    [1830, 2760, 3910].forEach((f, i) => this.tone(f * (0.97 + Math.random() * 0.06), 0.35 - i * 0.07, 'sine', 0.045, { delay: 0.005, wet: 0.35 }));
    if (crit) [1175, 1568, 2093].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.07, { delay: 0.04 + i * 0.04, wet: 0.5 }));
  }
  cast(): void {
    [880, 1109, 1319, 1760].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.05, { delay: i * 0.025, wet: 0.5 }));
    this.noise(0.3, 0.16, { type: 'highpass', freq: 3000, to: 7000, wet: 0.4, attack: 0.03 });
  }
  burst(): void { this.noise(0.4, 0.3, { type: 'bandpass', freq: 2200, to: 500, q: 0.8, wet: 0.5 }); [1568, 1976, 2637].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.05, { delay: i * 0.03, wet: 0.6 })); }
  dodge(): void { this.noise(0.26, 0.4, { type: 'bandpass', freq: 400, to: 1800, q: 1.2, wet: 0.1, attack: 0.03 }); }
  perfect(): void {
    // Time slows: a deep "whum", then a rising chime.
    this.tone(160, 0.9, 'sine', 0.5, { slide: 55, wet: 0.6 }); this.noise(0.9, 0.25, { freq: 400, to: 120, wet: 0.6 });
    [659, 880, 1319, 1760].forEach((f, i) => this.tone(f, 0.8, 'triangle', 0.08, { delay: 0.15 + i * 0.07, wet: 0.7 }));
  }
  jump(): void { this.noise(0.16, 0.22, { type: 'bandpass', freq: 700, to: 1600, wet: 0.05 }); }
  land(hard = false): void { this.noise(0.18, hard ? 0.55 : 0.32, { freq: 700, to: 200, wet: 0.1 }); this.tone(90, 0.16, 'sine', hard ? 0.45 : 0.25, { slide: 50, wet: 0 }); }
  hurt(): void { this.tone(330, 0.34, 'sawtooth', 0.12, { slide: 110, wet: 0.2 }); this.noise(0.28, 0.45, { freq: 1500, to: 300, wet: 0.2 }); this.tone(70, 0.3, 'sine', 0.5, { slide: 40, wet: 0 }); }
  enemyHurt(): void { this.tone(190 + Math.random() * 40, 0.18, 'square', 0.05, { slide: 90, wet: 0.3 }); }
  enemyDie(boss = false): void {
    this.noise(boss ? 1.6 : 0.7, boss ? 0.5 : 0.32, { type: 'bandpass', freq: 1600, to: 220, q: 0.7, wet: 0.6 });
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.06, { delay: 0.08 + i * 0.055, wet: 0.7 }));
  }
  /** Item jingle in the spirit of a classic adventure "you found something". */
  pickup(): void { [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.08, { delay: i * 0.05, wet: 0.5 })); }
  chest(): void {
    [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, { delay: i * 0.12, wet: 0.4 }));
    [784, 988, 1175, 1568].forEach((f) => this.tone(f, 1.4, 'triangle', 0.07, { delay: 0.55, wet: 0.7, attack: 0.03 }));
  }
  lockOn(): void { this.tone(1400, 0.07, 'square', 0.05, { wet: 0.1 }); this.tone(2100, 0.1, 'square', 0.04, { delay: 0.05, wet: 0.1 }); }
  lockOff(): void { this.tone(1500, 0.08, 'square', 0.04, { slide: 800, wet: 0.1 }); }
  /** An enemy has spotted you: a sharp rising two-note sting. */
  alert(): void { this.tone(587, 0.12, 'square', 0.06, { wet: 0.25 }); this.tone(880, 0.22, 'square', 0.07, { delay: 0.1, wet: 0.35 }); this.noise(0.15, 0.12, { type: 'highpass', freq: 3000, delay: 0.1, wet: 0.2 }); }
  warn(): void { this.tone(2400, 0.12, 'triangle', 0.06, { wet: 0.2 }); this.tone(3200, 0.1, 'triangle', 0.04, { delay: 0.03, wet: 0.2 }); }
  // Compatibility with the shared Sfx vocabulary.
  chime(): void { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.1, { delay: i * 0.07, wet: 0.5 })); }
  success(): void { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.12, { delay: i * 0.1, wet: 0.5 })); }
  fail(): void { [392, 330, 262].forEach((f, i) => this.tone(f, 0.45, 'sawtooth', 0.05, { delay: i * 0.14, wet: 0.3 })); }
  zap(): void { this.cast(); }
  impact(): void { this.hit(); }
  freeze(): void { [1568, 2093, 2637, 3136].forEach((f, i) => this.tone(f, 1.1, 'sine', 0.05, { delay: i * 0.06, wet: 0.8 })); this.noise(1.2, 0.12, { type: 'highpass', freq: 5000, wet: 0.7, attack: 0.3 }); }
  roar(): void { this.noise(1.6, 0.55, { freq: 380, to: 120, wet: 0.5, attack: 0.08 }); this.tone(62, 1.5, 'sawtooth', 0.18, { slide: 40, wet: 0.3, attack: 0.1 }); }
  tick(): void { this.pickup(); }

  /** Called every frame: ambience, generative music and combat intensity. */
  update(dt: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    this.combat += (this.combatTarget - this.combat) * (1 - Math.exp(-dt * 1.5));
    if (this.windFilter && this.windGain) {
      this.windFilter.frequency.setTargetAtTime(380 + Math.sin(ctx.currentTime * 0.13) * 160 + (this.region === 'cave' ? -150 : 0), ctx.currentTime, 0.5);
      this.windGain.gain.setTargetAtTime(this.region === 'cave' ? 0.035 : 0.07 + Math.sin(ctx.currentTime * 0.21) * 0.025, ctx.currentTime, 0.5);
    }
    // Birdsong in the open, water drips in the grotto.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.6 + Math.random() * 4;
      if (this.region !== 'cave' && this.combat < 0.5) {
        const base = 2200 + Math.random() * 2200, notes = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < notes; i++) this.tone(base * (1 + (Math.random() - 0.5) * 0.25), 0.09, 'sine', 0.025, { delay: i * 0.11, slide: base * (1.2 + Math.random() * 0.5), wet: 0.6, bus: this.ambOut() });
      }
    }
    if (this.region === 'cave') { this.dripTimer -= dt; if (this.dripTimer <= 0) { this.dripTimer = 0.8 + Math.random() * 2.2; this.tone(1600 + Math.random() * 900, 0.12, 'sine', 0.05, { slide: 700, wet: 0.9, bus: this.ambOut() }); } }
    // Pad chords drift through a gentle progression (I - vi - IV - V feel, D major).
    this.chordTimer -= dt;
    if (this.chordTimer <= 0) {
      this.chordTimer = 7.5;
      const roots = [62, 59, 55, 57], chords = [[0, 4, 7], [0, 3, 7], [0, 4, 7], [0, 4, 9]], r = roots[this.chord % 4], tones = chords[this.chord % 4]; this.chord++;
      this.padOsc.forEach((o, i) => { const midi = r - 12 + tones[Math.floor(i / 2)]; o.frequency.setTargetAtTime(440 * Math.pow(2, (midi - 69) / 12), ctx.currentTime, 0.8); });
    }
    const padLevel = 0.012 + this.combat * 0.01;
    this.padGains.forEach((g) => g.gain.setTargetAtTime(padLevel, ctx.currentTime, 1.2));
    // Sparse plucked melody; denser and lower in combat.
    this.noteTimer -= dt;
    if (this.noteTimer <= 0) {
      this.noteTimer = this.combat > 0.5 ? 0.32 + Math.random() * 0.3 : 0.9 + Math.random() * 1.8;
      const root = [62, 59, 55, 57][(this.chord + 3) % 4], deg = PENTA[Math.floor(Math.random() * 5)], oct = this.combat > 0.5 ? 0 : 12 * (Math.random() < 0.6 ? 1 : 0);
      const f = 440 * Math.pow(2, (root + deg + oct - 69) / 12);
      this.tone(f, 1.4, 'triangle', 0.045, { wet: 0.75, bus: this.musicOut() });
      this.tone(f * 2, 0.5, 'sine', 0.012, { wet: 0.75, bus: this.musicOut() });
    }
    // Combat drums: soft low thumps and a shaker.
    if (this.combat > 0.3) {
      this.beatTimer -= dt;
      if (this.beatTimer <= 0) {
        this.beatTimer = 0.42;
        this.tone(68, 0.3, 'sine', 0.3 * this.combat, { slide: 42, wet: 0.15, bus: this.musicOut(0.15) });
        this.noise(0.06, 0.08 * this.combat, { type: 'highpass', freq: 6000, delay: 0.21, wet: 0.1 });
      }
    }
  }
  private ambOut(): GainNode { const g = this.ctx!.createGain(); g.connect(this.ambBus); const s = this.ctx!.createGain(); s.gain.value = 0.6; g.connect(s).connect(this.send); return g; }
  private musicOut(wet = 0.75): GainNode { const g = this.ctx!.createGain(); g.connect(this.musicBus); const s = this.ctx!.createGain(); s.gain.value = wet; g.connect(s).connect(this.send); return g; }
}
