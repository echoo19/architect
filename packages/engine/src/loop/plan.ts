import type { Method, Round, RunPhase, RunStatus, RunStopReason, Score } from '@architect/shared';

/**
 * One unit of work for a run. Every step persists its result before the next is planned, and a
 * step interrupted part way (a pause, a stop, a crash) is planned again and picks up where the
 * database says it left off.
 */
export type Step =
  | { kind: 'prepare' }
  | { kind: 'baseline' }
  | { kind: 'start_round'; round: number }
  | { kind: 'attempt_train'; round: number }
  | { kind: 'author'; round: number }
  | { kind: 'teach'; round: number }
  | { kind: 'await_training'; round: number }
  | { kind: 'clarify'; round: number }
  | { kind: 'evaluate_candidate'; round: number }
  | { kind: 'abandon_round'; round: number; reason: string }
  | { kind: 'finish_training'; reason?: RunStopReason }
  | { kind: 'freeze' }
  | { kind: 'locked_test' }
  | { kind: 'propose_version' }
  | { kind: 'park' }
  | { kind: 'done' };

export type ActionStep = Exclude<Step, { kind: 'park' } | { kind: 'done' }>;

/** A round as the planner sees it. */
export type PlannedRound = Pick<Round, 'index' | 'status' | 'decision'> & {
  /** Its reply or change set was rejected before dev saw it. */
  rejected?: boolean;
  /** A clarifying round whose question hasn't been answered yet. */
  awaitingAnswer?: boolean;
};

/** Rejected rounds in a row that end training: the author isn't making changes the runner can use. */
export const MAX_REJECTED_IN_A_ROW = 2;

export interface PlanInput {
  method: Method;
  status: RunStatus;
  phase: RunPhase;
  stopRequested: boolean;
  pauseRequested: boolean;
  devBaseline: Score | null;
  /** Dev score of the incumbent. */
  devCurrent: Score | null;
  /** The graduate has been frozen for its locked test. */
  frozen: boolean;
  /**
   * A comparison holds the locked test until every arm is frozen (decision 045): once frozen, the
   * run parks until it is released.
   */
  held?: boolean;
  /**
   * The run's rounds are fixed in advance and run whatever dev says, as a one-shot adapter's are
   * (decision 045): it starts each until `maxRounds`, then ends.
   */
  fixedRounds?: boolean;
  /**
   * The run improves an agent from its queued lessons: it ends in a candidate version of that
   * agent, measured on dev, and never takes the locked test again (decision 042).
   */
  improves?: boolean;
  rounds: readonly PlannedRound[];
  maxRounds: number;
  patience: number;
  passRateTarget: number;
  wallClockSpent: boolean;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(['finished', 'stopped', 'failed']);
const OPEN: ReadonlySet<Round['status']> = new Set([
  'attempting',
  'diagnosing',
  'teaching',
  'training',
  'clarifying',
  'evaluating',
]);

export const STOPPED_ROUND = 'Training was stopped before this change was scored.';
export const OUT_OF_TIME_ROUND = 'The time limit ran out before this change was scored.';

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

function finish(reason?: RunStopReason): Step {
  return reason === undefined ? { kind: 'finish_training' } : { kind: 'finish_training', reason };
}

function targetMet(input: PlanInput): boolean {
  const dev = input.devCurrent;
  return dev !== null && dev.total > 0 && dev.pass >= input.passRateTarget * dev.total - 1e-9;
}

/**
 * Changes dev measured and reverted since the last kept one. Rejected rounds never reached dev,
 * so they neither count nor break the streak.
 */
function revertedSinceKept(rounds: PlanInput['rounds']): number {
  let count = 0;
  for (let i = rounds.length - 1; i >= 0 && rounds[i]?.decision !== 'kept'; i--) {
    if (rounds[i]?.decision === 'reverted') count += 1;
  }
  return count;
}

/** The rejected rounds the list ends with. */
function rejectedInARow(rounds: PlanInput['rounds']): number {
  let count = 0;
  for (let i = rounds.length - 1; i >= 0 && rounds[i]?.rejected === true; i--) count += 1;
  return count;
}

function continueRound(round: PlanInput['rounds'][number]): Step {
  switch (round.status) {
    case 'attempting':
      return { kind: 'attempt_train', round: round.index };
    case 'diagnosing':
      return { kind: 'author', round: round.index };
    case 'teaching':
      return { kind: 'teach', round: round.index };
    case 'training':
      return { kind: 'await_training', round: round.index };
    case 'clarifying':
      // The run waits, paused, for the person's answer; only the answer moves it on.
      return round.awaitingAnswer === true
        ? { kind: 'park' }
        : { kind: 'clarify', round: round.index };
    default:
      return { kind: 'evaluate_candidate', round: round.index };
  }
}

function nextTrainingStep(input: PlanInput): Step {
  switch (input.method) {
    case 'bare':
      return finish();
    case 'one_shot':
      return input.rounds.length === 0 ? { kind: 'start_round', round: 1 } : finish();
    case 'architect':
    case 'self_reflection':
      if (input.fixedRounds === true) {
        if (input.rounds.length < input.maxRounds) {
          return { kind: 'start_round', round: input.rounds.length + 1 };
        }
        return finish('rounds');
      }
      if (targetMet(input)) return finish('target_met');
      if (rejectedInARow(input.rounds) >= MAX_REJECTED_IN_A_ROW) return finish('rejected');
      if (revertedSinceKept(input.rounds) >= input.patience) return finish('patience');
      if (input.rounds.length >= input.maxRounds) return finish('rounds');
      return { kind: 'start_round', round: input.rounds.length + 1 };
  }
}

/**
 * The next step for a run, decided from its persisted state alone. Once the graduate is being
 * tested nothing leads back to training: test results never trigger another round.
 */
export function planNextStep(input: PlanInput): Step {
  if (isTerminal(input.status)) return { kind: 'done' };

  if (input.phase === 'testing') {
    if (input.pauseRequested) return { kind: 'park' };
    if (!input.frozen) return { kind: 'freeze' };
    if (input.held === true) return { kind: 'park' };
    return input.improves === true ? { kind: 'propose_version' } : { kind: 'locked_test' };
  }

  const open = input.rounds.find((round) => OPEN.has(round.status));
  if (input.stopRequested) {
    return open
      ? { kind: 'abandon_round', round: open.index, reason: STOPPED_ROUND }
      : finish('user');
  }
  if (input.pauseRequested) return { kind: 'park' };
  if (input.phase === 'preparing') return { kind: 'prepare' };
  if (input.wallClockSpent) {
    return open
      ? { kind: 'abandon_round', round: open.index, reason: OUT_OF_TIME_ROUND }
      : finish('wall_clock');
  }
  if (input.devBaseline === null) return { kind: 'baseline' };
  if (open) return continueRound(open);
  return nextTrainingStep(input);
}
