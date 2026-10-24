/** Reads narration aloud with the browser's built-in text-to-speech. */
export class Narrator {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;
  private readonly synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

  constructor() {
    if (!this.synth) return;
    const choose = () => {
      const voices = this.synth!.getVoices();
      this.voice =
        voices.find((v) => /en-GB/i.test(v.lang) && /female|libby|sonia|serena|kate/i.test(v.name)) ??
        voices.find((v) => /en-GB/i.test(v.lang)) ??
        voices.find((v) => /^en/i.test(v.lang)) ??
        null;
    };
    choose();
    this.synth.addEventListener('voiceschanged', choose);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  }

  speak(text: string): void {
    if (!this.synth || !this.enabled) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 0.95;
    u.pitch = 1.05;
    this.synth.speak(u);
  }

  stop(): void {
    this.synth?.cancel();
  }
}
