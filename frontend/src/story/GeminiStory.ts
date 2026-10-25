import type { BeatOutcome, GameHistory, Player, StoryBeat, Storybook, StoryProvider } from '../contracts';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';
const TIMEOUT_MS = 16000;

/**
 * Gemini-backed storyteller (Dev 2). The backend decides each beat's structure from the same
 * catalog the engine supports and Gemini writes the text. Any failure (network, timeout, 503)
 * falls back to the scripted provider for that beat; both use the same beat ids, so a run can
 * switch between them mid-adventure.
 */
export class GeminiStory implements StoryProvider {
  constructor(private readonly fallback: StoryProvider) {}

  begin(party: [Player, Player]): Promise<StoryBeat> {
    return this.call<StoryBeat>('begin', { party }, () => this.fallback.begin(party));
  }

  next(history: GameHistory, last: BeatOutcome): Promise<StoryBeat> {
    return this.call<StoryBeat>('next', { history, last }, () => this.fallback.next(history, last));
  }

  storybook(history: GameHistory, victory: boolean): Promise<Storybook> {
    return this.call<Storybook>('storybook', { history, victory }, () => this.fallback.storybook(history, victory));
  }

  private async call<T>(route: string, body: unknown, fallback: () => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API}/api/provider/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      console.warn(`[GeminiStory] ${route} failed, using scripted fallback:`, err);
      return fallback();
    } finally {
      clearTimeout(timer);
    }
  }
}
