import type { Round, Score } from '@architect/shared';
import { rate } from '../format';

/*
 * The check-task chart's data, in rounds and percent: round 0 is the start, and the axis runs to
 * the round budget (up to MAX_SPAN), so the rounds left show beside the ones used.
 */

/** A longer budget than this is drawn only as far as the run has gone, so its rounds stay apart. */
const MAX_SPAN = 20;
/** The y axis never covers less than this many percentage points, so small moves stay small. */
const MIN_RANGE = 40;

export interface CurveInput {
  /** The round that wrote the first full draft, labelled as such; null when there was none. */
  draftRound?: number | null;
  baseline: Score | null;
  rounds: readonly Round[];
  /** Target pass rate, 0 to 1. */
  target: number;
  maxRounds: number;
}

/** A pass rate in percent after a round; round 0 is the start. */
export interface CurvePoint {
  round: number;
  value: number;
}

/** A round on the x axis. */
export interface Tick {
  round: number;
  /** The run has reached this round (finished or in progress). */
  reached: boolean;
}

/** A reverted round: what it measured, against the kept score it was measured against. */
export interface Branch {
  round: number;
  from: number;
  to: number;
}

export interface CurveData {
  /** The x axis runs from round 0 to this one. */
  span: number;
  ticks: Tick[];
  /** The y axis, low and high, in percent. */
  range: [number, number];
  valueTicks: number[];
  /** The kept harness's pass rate after each finished round, held flat through rounds that kept nothing. */
  line: CurvePoint[];
  /** Where the kept harness was measured: the start and each kept round. */
  kept: CurvePoint[];
  /** Reverted rounds and what they measured. */
  branches: Branch[];
  /**
   * Where the kept setup was last measured, which is the score the agent has now. The line runs
   * on flat past it through rounds that kept nothing, but they measured nothing new.
   */
  head: CurvePoint | null;
  /** The round still running, until it is measured. */
  pending: number | null;
  /** Each round's practice tasks right, in percent, at the round they ran in. */
  practice: CurvePoint[];
  /** The target, in percent. */
  target: number;
}

function baselineOf(input: CurveInput): Score | null {
  return input.baseline ?? input.rounds[0]?.devBefore ?? null;
}

/** Rounds that changed nothing more can happen to: decided, or failed. */
function isSettled(round: Round): boolean {
  return round.decision !== undefined || round.status === 'failed';
}

interface Step {
  round: number;
  value: number;
  /** The value is the kept setup's own measurement here, not one carried over from before. */
  measured: boolean;
  reverted?: number;
}

/** The kept pass rate after every settled round, plus each reverted round's own measurement. */
function steps(input: CurveInput): Step[] {
  const start = baselineOf(input);
  if (!start) return [];
  const result: Step[] = [{ round: 0, value: rate(start), measured: true }];
  let current = rate(start);
  for (const round of input.rounds) {
    if (!isSettled(round)) break;
    if (round.decision === 'kept' && round.devAfter) {
      current = rate(round.devAfter);
      result.push({ round: round.index, value: current, measured: true });
    } else if (round.decision === 'reverted' && round.devAfter) {
      result.push({
        round: round.index,
        value: current,
        measured: false,
        reverted: rate(round.devAfter),
      });
    } else {
      result.push({ round: round.index, value: current, measured: false });
    }
  }
  return result;
}

function yRange(values: number[], target: number): [number, number] {
  const all = [...values, target];
  let low = Math.max(0, Math.floor((Math.min(...all) - 5) / 10) * 10);
  let high = Math.min(100, Math.ceil((Math.max(...all) + 5) / 10) * 10);
  if (high - low < MIN_RANGE) {
    low = Math.max(0, high - MIN_RANGE);
    high = Math.min(100, low + MIN_RANGE);
  }
  return [low, high];
}

/** Practice tasks right in each round that ran some, in percent. A draft round runs none. */
function practiceOf(rounds: readonly Round[]): CurvePoint[] {
  return rounds.flatMap((round) =>
    round.train.total > 0 ? [{ round: round.index, value: rate(round.train) }] : [],
  );
}

export function curveData(input: CurveInput): CurveData {
  const history = steps(input);
  const lastRound = input.rounds.at(-1)?.index ?? 0;
  const span = Math.max(lastRound, Math.min(input.maxRounds, MAX_SPAN), 1);
  const practice = practiceOf(input.rounds);
  const target = input.target * 100;

  const values = [
    ...history.flatMap((step) =>
      step.reverted === undefined ? [step.value] : [step.value, step.reverted],
    ),
    ...practice.map((point) => point.value),
  ];
  const range = yRange(values, target);

  const line = history.map((step) => ({ round: step.round, value: step.value }));
  const kept = history
    .filter((step) => step.measured)
    .map(({ round, value }) => ({ round, value }));
  const branches = history.flatMap((step) =>
    step.reverted === undefined ? [] : [{ round: step.round, from: step.value, to: step.reverted }],
  );
  const head = kept.at(-1) ?? null;
  const open = input.rounds.find((round) => !isSettled(round));
  const pending = head && open ? open.index : null;

  const ticks: Tick[] = Array.from({ length: span + 1 }, (_, round) => ({
    round,
    reached: round <= lastRound,
  }));

  const valueStep = range[1] - range[0] <= 50 ? 10 : 20;
  const valueTicks: number[] = [];
  for (
    let value = Math.ceil(range[0] / valueStep) * valueStep;
    value <= range[1];
    value += valueStep
  ) {
    valueTicks.push(value);
  }

  return { span, ticks, range, valueTicks, line, kept, branches, head, pending, practice, target };
}

/** The chart in words, for screen readers. */
export function describeCurve(input: CurveInput, checks = 'check tasks'): string {
  const parts: string[] = [];
  const start = baselineOf(input);
  if (start) parts.push(`${Math.round(rate(start))}% at the start`);
  for (const round of input.rounds) {
    if (round.decision === 'kept' && round.devAfter) {
      const after = round.index === input.draftRound ? 'the first draft' : `round ${round.index}`;
      parts.push(`${Math.round(rate(round.devAfter))}% after ${after}`);
    } else if (round.decision === 'reverted' && round.devAfter) {
      parts.push(`round ${round.index} undone at ${Math.round(rate(round.devAfter))}%`);
    } else if (round.status === 'failed') {
      parts.push(`round ${round.index} failed`);
    } else {
      parts.push(`round ${round.index} in progress`);
    }
  }
  const target = `Target ${Math.round(input.target * 100)}%.`;
  if (parts.length === 0) return `Score on the ${checks} by round: nothing measured yet. ${target}`;
  const practice = practiceOf(input.rounds).map(
    (point) => `${Math.round(point.value)}% in round ${point.round}`,
  );
  const practised = practice.length > 0 ? ` Practice tasks right: ${practice.join(', ')}.` : '';
  return `Score on the ${checks} by round: ${parts.join(', ')}. ${target}${practised}`;
}
