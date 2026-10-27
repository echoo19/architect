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
  | { kind: 'evaluate_candidate'; round: number }
  | { kind: 'abandon_round'; round: number; reason: string }
  | { kind: 'finish_training'; reason?: RunStopReason }
  | { kind: 'freeze' }
  | { kind: 'locked_test' }
  | { kind: 'park' }
  | { kind: 'done' };

export type ActionStep = Exclude<Step, { kind: 'park' } | { kind: 'done' }>;

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
  rounds: readonly Pick<Round, 'index' | 'status' | 'decision'>[];
  maxRounds: number;
  patience: number;
  passRateTarget: number;
  wallClockSpent: boolean;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(['finished', 'stopped', 'failed']);
const OPEN: ReadonlySet<Round['status']> = new Set(['attempting', 'diagnosing', 'evaluating']);

export const STOPPED_ROUND = 'Stopped before this change was evaluated.';
export const OUT_OF_TIME_ROUND = 'The wall-clock budget ran out before this change was evaluated.';

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

/** Rounds since the last kept change, counting failed and reverted ones. */
function roundsWithoutGain(rounds: PlanInput['rounds']): number {
  let count = 0;
  for (let i = rounds.length - 1; i >= 0 && rounds[i]?.decision !== 'kept'; i--) count += 1;
  return count;
}

function continueRound(round: PlanInput['rounds'][number]): Step {
  switch (round.status) {
    case 'attempting':
      return { kind: 'attempt_train', round: round.index };
    case 'diagnosing':
      return { kind: 'author', round: round.index };
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
      if (targetMet(input)) return finish('target_met');
      if (roundsWithoutGain(input.rounds) >= input.patience) return finish('patience');
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
    return input.frozen ? { kind: 'locked_test' } : { kind: 'freeze' };
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
