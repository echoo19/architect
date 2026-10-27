import type { Round, Score } from '@architect/shared';
import { rate } from '../format';

/*
 * Geometry for the task success chart, in the design's 700 by 250 viewBox: rounds run along x
 * from 20 to 620 (round 0 is the baseline), labels sit to the right of 620, and the plot's floor
 * is at y = 220.
 */

export const CURVE_BOX = { width: 700, height: 250 } as const;
export const PLOT = { left: 20, right: 620, top: 40, bottom: 220, gridTop: 62, labelY: 244 };

/** Below this many rounds the axis still spans this many, so early runs don't look stretched. */
const MIN_SPAN = 4;
/** The y axis never covers less than this many percentage points, so small moves stay small. */
const MIN_RANGE = 40;
/** Round labels closer together than this would collide. */
const MIN_LABEL_GAP = 28;

export interface Point {
  x: number;
  y: number;
  /** Pass rate in percent. */
  value: number;
}

export interface CurveInput {
  baseline: Score | null;
  rounds: readonly Round[];
  /** Target pass rate, 0 to 1. */
  target: number;
  maxRounds: number;
}

/** A round on the x axis. Long runs label every few rounds, and always the last. */
export interface Tick {
  round: number;
  x: number;
  /** The run has reached this round (finished or in progress). */
  reached: boolean;
}

export interface Branch {
  round: number;
  from: Point;
  to: Point;
}

export interface CurveGeometry {
  ticks: Tick[];
  /** The kept harness's pass rate after each finished round, joined by a solid line. */
  line: Point[];
  /** Reverted rounds: a dashed branch from the line to what the change measured. */
  branches: Branch[];
  head: Point | null;
  targetY: number;
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
  reverted?: number;
}

/** The kept pass rate after every settled round, plus each reverted round's own measurement. */
function steps(input: CurveInput): Step[] {
  const start = baselineOf(input);
  if (!start) return [];
  const result: Step[] = [{ round: 0, value: rate(start) }];
  let current = rate(start);
  for (const round of input.rounds) {
    if (!isSettled(round)) break;
    if (round.decision === 'kept' && round.devAfter) {
      current = rate(round.devAfter);
      result.push({ round: round.index, value: current });
    } else if (round.decision === 'reverted' && round.devAfter) {
      result.push({ round: round.index, value: current, reverted: rate(round.devAfter) });
    } else {
      result.push({ round: round.index, value: current });
    }
  }
  return result;
}

function yRange(values: number[], target: number): [number, number] {
  const all = [...values, target * 100];
  let low = Math.max(0, Math.floor((Math.min(...all) - 5) / 10) * 10);
  let high = Math.min(100, Math.ceil((Math.max(...all) + 5) / 10) * 10);
  if (high - low < MIN_RANGE) {
    low = Math.max(0, high - MIN_RANGE);
    high = Math.min(100, low + MIN_RANGE);
  }
  return [low, high];
}

export function curveGeometry(input: CurveInput): CurveGeometry {
  const history = steps(input);
  const lastRound = input.rounds.at(-1)?.index ?? 0;
  const span = Math.max(lastRound, Math.min(input.maxRounds, MIN_SPAN), 1);
  const stepX = (PLOT.right - PLOT.left) / span;
  const x = (round: number) => PLOT.left + round * stepX;

  const values = history.flatMap((step) =>
    step.reverted === undefined ? [step.value] : [step.value, step.reverted],
  );
  const [low, high] = yRange(values, input.target);
  const y = (value: number) =>
    PLOT.bottom - ((value - low) / (high - low)) * (PLOT.bottom - PLOT.top);
  const point = (round: number, value: number): Point => ({ x: x(round), y: y(value), value });

  const line = history.map((step) => point(step.round, step.value));
  const branches: Branch[] = [];
  history.forEach((step, index) => {
    const previous = line[index - 1];
    if (step.reverted !== undefined && previous) {
      branches.push({ round: step.round, from: previous, to: point(step.round, step.reverted) });
    }
  });

  const every = Math.max(1, Math.ceil(MIN_LABEL_GAP / stepX));
  const ticks: Tick[] = Array.from({ length: span + 1 }, (_, round) => round)
    .filter((round) => round === span || (round % every === 0 && span - round >= every))
    .map((round) => ({ round, x: x(round), reached: round <= lastRound }));

  return {
    ticks,
    line,
    branches,
    head: line.at(-1) ?? null,
    targetY: y(input.target * 100),
  };
}

/** The chart in words, for screen readers. */
export function describeCurve(input: CurveInput): string {
  const parts: string[] = [];
  const start = baselineOf(input);
  if (start) parts.push(`${Math.round(rate(start))}% before teaching`);
  for (const round of input.rounds) {
    if (round.decision === 'kept' && round.devAfter) {
      parts.push(`${Math.round(rate(round.devAfter))}% after round ${round.index}`);
    } else if (round.decision === 'reverted' && round.devAfter) {
      parts.push(`round ${round.index} reverted at ${Math.round(rate(round.devAfter))}%`);
    } else if (round.status === 'failed') {
      parts.push(`round ${round.index} failed`);
    } else {
      parts.push(`round ${round.index} in progress`);
    }
  }
  const target = `Ready at ${Math.round(input.target * 100)}%.`;
  if (parts.length === 0) return `Task success by round: nothing measured yet. ${target}`;
  return `Task success by round: ${parts.join(', ')}. ${target}`;
}
