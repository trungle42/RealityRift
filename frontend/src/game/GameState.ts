import type { BeatOutcome, EnvironmentId, GameHistory, Player, RewardKind, RewardSpec } from '../contracts';

export const MAX_HEARTS = 3;

/** Shared hearts, per-player stars, rewards and the record of what happened. */
export class GameState {
  hearts = MAX_HEARTS;
  stars: [number, number] = [0, 0];
  readonly rewards: RewardSpec[] = [];
  readonly outcomes: BeatOutcome[] = [];
  readonly environments: EnvironmentId[] = [];

  constructor(readonly party: [Player, Player]) {}

  loseHeart(): boolean {
    if (this.hearts <= 0) return false;
    this.hearts--;
    return true;
  }

  gainHeart(): boolean {
    if (this.hearts >= MAX_HEARTS || this.defeated) return false;
    this.hearts++;
    return true;
  }

  has(kind: RewardKind): boolean {
    return this.rewards.some((r) => r.kind === kind);
  }

  get defeated(): boolean {
    return this.hearts <= 0;
  }

  visit(env: EnvironmentId): void {
    if (this.environments[this.environments.length - 1] !== env) this.environments.push(env);
  }

  history(): GameHistory {
    return structuredClone({
      party: this.party,
      hearts: this.hearts,
      maxHearts: MAX_HEARTS,
      stars: [...this.stars],
      rewards: [...this.rewards],
      outcomes: [...this.outcomes],
      environments: [...this.environments],
    });
  }
}
