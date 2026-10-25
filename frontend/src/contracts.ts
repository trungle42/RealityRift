/**
 * Integration contracts between the game engine (Dev 1), the AI storyteller
 * (Dev 2) and computer vision / hardware input (Dev 3).
 *
 * Story challenges talk to a StoryProvider and an InputSource. The
 * scripted provider and keyboard input in this repo are the Phase 1
 * implementations; Gemini and MediaPipe versions implement the same
 * interfaces and are swapped in from main.ts. Campaign traversal currently
 * owns keyboard/pointer movement separately from pose tracking.
 */

export type PlayerIndex = 0 | 1;

export interface Player {
  index: PlayerIndex;
  name: string;
}

// ---------------------------------------------------------------------------
// Catalog of things the storyteller may choose from. Gemini selects from these
// ids; it never invents new mechanics.
// ---------------------------------------------------------------------------

export type EnvironmentId = 'forest' | 'castle' | 'cave';
export type PoseId = 'arms-up' | 't-pose' | 'crouch';
export type EnemyKind = 'shadow-wisp' | 'thorn-imp';
export type BossKind = 'frost-witch' | 'shadow-dragon';
/** frost-gaze: players must stay still. shadow-wave: players must crouch. */
export type BossAttack = 'frost-gaze' | 'shadow-wave';
/**
 * heart: restore one shared heart. boss-weaken: boss starts at 75% health.
 * fairy-ally: a fairy joins the boss fight and casts with the party.
 * quick-cast: spells recharge twice as fast.
 */
export type RewardKind = 'heart' | 'boss-weaken' | 'fairy-ally' | 'quick-cast';

export interface VoteOption {
  id: string;
  label: string;
}

export type ChallengeSpec =
  | {
      type: 'freeze';
      prompt: string;
      durationSec: number;
      /** 0..1 — how much motion is forgiven before a player counts as moving. */
      tolerance: number;
    }
  | {
      type: 'pose';
      prompt: string;
      poses: PoseId[];
      secondsPerPose: number;
    }
  | {
      type: 'vote';
      prompt: string;
      options: [VoteOption, VoteOption];
      timeLimitSec: number;
    }
  | {
      /** Reality Rift: the player shows a real object to the webcam and Gemini vision checks it. */
      type: 'show';
      prompt: string;
      /** What to show, e.g. "a book". */
      object: string;
    };

export interface EncounterSpec {
  enemy: EnemyKind;
  count: number;
  /** 1 = normal pace. Higher is harder. */
  speed: number;
}

export interface BossSpec {
  kind: BossKind;
  name: string;
  maxHp: number;
  attacks: BossAttack[];
  /** Warning time before each attack lands. Lower is harder. */
  telegraphSec: number;
  /** How long the boss stays open to spells after each attack. */
  vulnerableSec: number;
}

export interface RewardSpec {
  kind: RewardKind;
  name: string;
  description: string;
}

/**
 * One step of the adventure. Narration plays first, then the reward (if any)
 * is granted, then at most one of challenge / encounter / boss runs.
 */
export interface StoryBeat {
  id: string;
  chapter: string;
  environment: EnvironmentId;
  narration: string[];
  speaker?: string;
  reward?: RewardSpec;
  challenge?: ChallengeSpec;
  encounter?: EncounterSpec;
  boss?: BossSpec;
  /** Narration only, then the storybook. */
  isEnding?: boolean;
}

export type OutcomeKind = 'story' | 'freeze' | 'pose' | 'vote' | 'encounter' | 'boss' | 'show';

export interface PlayerResult {
  success: boolean;
  stars: number;
}

/** What the engine reports back after running a beat. */
export interface BeatOutcome {
  beatId: string;
  kind: OutcomeKind;
  success: boolean;
  /** Set for votes. */
  choiceId?: string;
  perPlayer: [PlayerResult, PlayerResult];
  heartsLost: number;
  /** Plain-English line for the storyteller's memory, e.g. "Wren moved during the freeze spell". */
  summary: string;
}

export interface GameHistory {
  party: [Player, Player];
  hearts: number;
  maxHearts: number;
  stars: [number, number];
  rewards: RewardSpec[];
  outcomes: BeatOutcome[];
  environments: EnvironmentId[];
}

export interface StorybookPage {
  heading: string;
  text: string;
}

export interface Storybook {
  title: string;
  pages: StorybookPage[];
}

export interface StoryProvider {
  begin(party: [Player, Player]): Promise<StoryBeat>;
  /** Called after every beat. Return a beat with isEnding when the tale is over. */
  next(history: GameHistory, last: BeatOutcome): Promise<StoryBeat>;
  storybook(history: GameHistory, victory: boolean): Promise<Storybook>;
}

// ---------------------------------------------------------------------------
// Input. The engine polls read() every frame and listens for discrete events.
// ---------------------------------------------------------------------------

export interface PlayerFrame {
  /** Is this player detected at all (always true for keyboard). */
  present: boolean;
  /** 0 = perfectly still, 1 = clearly moving. */
  motion: number;
  /** Pose currently held, if any. */
  pose: PoseId | null;
}

export type InputEventKind = 'cast' | 'left' | 'right' | 'confirm';

export interface InputEvent {
  /** null for shared controls such as confirm. */
  player: PlayerIndex | null;
  kind: InputEventKind;
}

export interface InputSource {
  read(player: PlayerIndex): PlayerFrame;
  subscribe(listener: (event: InputEvent) => void): () => void;
  destroy(): void;
}
