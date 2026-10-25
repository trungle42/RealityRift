import type { BeatOutcome, PlayerFrame, PoseId } from '../contracts';

/** Missing tracking is not evidence that a player held a pose or stayed still. */
export const isStill = (frame: PlayerFrame, tolerance: number): boolean => frame.present && frame.motion <= tolerance;
export const matchesPose = (frame: PlayerFrame, pose: PoseId): boolean => frame.present && frame.pose === pose;
export const initialBossHp = (maxHp: number, weakened: boolean): number => Math.max(1, weakened ? Math.round(maxHp * 0.75) : maxHp);
export const heartsLostSince = (before: number, after: number): number => Math.max(0, before - after);
export const didWin = (hearts: number, boss: BeatOutcome | undefined): boolean => hearts > 0 && boss?.success === true;
