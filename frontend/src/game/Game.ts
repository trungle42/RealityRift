import type { BeatOutcome, Player, StoryBeat, StoryProvider } from '../contracts';
import { runBoss } from '../challenges/boss';
import { runEncounter } from '../challenges/encounter';
import { runFreeze } from '../challenges/freeze';
import { runPose } from '../challenges/pose';
import { runVote } from '../challenges/vote';
import { tween, ease } from '../core/clock';
import { askForParty } from '../screens/PartySetup';
import { showStorybook } from '../screens/StorybookScreen';
import { showTitle } from '../screens/TitleScreen';
import { HERO_X } from '../theme';
import { GameState } from './GameState';
import type { Stage } from './Stage';
import { didWin } from './rules';
import { Campaign } from '../campaign/Campaign';

/**
 * Game progression: title → party → story beats (narration, rewards,
 * challenges) until the storyteller ends the tale → storybook → repeat.
 */
export class Game {
  constructor(private readonly stage: Stage, private readonly story: StoryProvider) {}

  async run(): Promise<never> {
    let party: [Player, Player] | undefined;
    for (;;) {
      this.stage.setGameplayVisible(false);
      await this.stage.setEnvironment('forest');
      await showTitle(this.stage.screens, this.stage.input);
      this.stage.sfx.unlock();
      party = await askForParty(party);
      await this.play(party);
    }
  }

  private async play(party: [Player, Player]): Promise<void> {
    const { stage } = this;
    const state = new GameState(party);
    stage.begin(state);
    stage.setGameplayVisible(true);
    await this.heroesEnter();

    let beat = await stage.think(this.story.begin(party));
    const campaign = new Campaign(stage);
    let bossOutcome: BeatOutcome | undefined;
    for (;;) {
      stage.hud.setChapter(beat.chapter);
      if (!beat.isEnding && !await campaign.explore(beat)) break;
      await stage.setEnvironment(beat.environment);
      await stage.narration.say(beat.narration, beat.speaker);
      if (beat.isEnding) break;
      await stage.narration.close();
      if (beat.reward) await stage.grantReward(beat.reward);

      const outcome = await this.runBeat(beat);
      state.outcomes.push(outcome);
      if (outcome.kind === 'boss') bossOutcome = outcome;

      const next = await stage.think(this.story.next(state.history(), outcome));
      // The engine owns the rules: out of hearts means the tale ends, whatever the storyteller says.
      if (state.defeated && !next.isEnding) break;
      beat = next;
    }

    await stage.narration.close();
    const victory = didWin(state.hearts, bossOutcome);
    const book = await stage.think(this.story.storybook(state.history(), victory));
    stage.hud.setChapter('');
    await showStorybook(stage.screens, stage.input, book);
  }

  private runBeat(beat: StoryBeat): Promise<BeatOutcome> {
    const { stage } = this;
    if (beat.boss) return runBoss(stage, beat.id, beat.boss);
    if (beat.encounter) return runEncounter(stage, beat.id, beat.encounter);
    const c = beat.challenge;
    if (c?.type === 'freeze') return runFreeze(stage, beat.id, c);
    if (c?.type === 'pose') return runPose(stage, beat.id, c);
    if (c?.type === 'vote') return runVote(stage, beat.id, c);
    return Promise.resolve(stage.outcome(beat.id, 'story', true, [0, 0], [true, true], 0, beat.reward ? `They received ${beat.reward.name}` : 'The story continued'));
  }

  private async heroesEnter(): Promise<void> {
    const { heroes } = this.stage;
    heroes.forEach((h) => (h.x = -120));
    await Promise.all(heroes.map(async (h, i) => {
      h.setMovement('walk', 1, 0);
      await tween(h, { x: HERO_X[i] }, 1.1 + i * 0.25, ease.outCubic);
      h.setMovement('idle', 1, 0);
    }));
  }
}
