import type { Round, Score } from '@architect/shared';
import { rate } from '../format';

/*
 * Geometry for the check-task chart, in the design's 700 by 250 viewBox: rounds run along x from
 * 52 to 612 (round 0 is the start), percentages sit left of 52, the Target and Round labels sit
 * right of 612, and the plot's floor is at y = 220.
 */

export const CURVE_BOX = { width: 700, height: 250 } as const;
export const PLOT = { left: 52, right: 612, top: 40, bottom: 220, gridTop: 62, labelY: 244 };

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
  /** The round that wrote the first full draft, labelled as such; null when there was none. */
  draftRound?: number | null;
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

/** A percentage on the y axis, with its gridline. */
export interface ValueTick {
  value: number;
  y: number;
}

export interface Branch {
  round: number;
  from: Point;
  to: Point;
}

export interface CurveGeometry {
  ticks: Tick[];
  valueTicks: ValueTick[];
  /** The kept harness's pass rate after each finished round, joined by a solid line. */
  line: Point[];
  /** Reverted rounds: a dashed branch from the line to what the change measured. */
  branches: Branch[];
  /**
   * Where the kept setup was last measured, which is the score the agent has now. The line runs
   * on flat past it through rounds that kept nothing, but they measured nothing new.
   */
  head: Point | null;
  /** The round still running, marked on the axis at its own round until it is measured. */
  pending: { round: number; x: number } | null;
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

  const lastMeasured = history.reduce((at, step, index) => (step.measured ? index : at), -1);
  const head = line[lastMeasured] ?? null;
  const open = input.rounds.find((round) => !isSettled(round));
  const pending = head && open ? { round: open.index, x: x(open.index) } : null;

  const every = Math.max(1, Math.ceil(MIN_LABEL_GAP / stepX));
  const ticks: Tick[] = Array.from({ length: span + 1 }, (_, round) => round)
    .filter((round) => round === span || (round % every === 0 && span - round >= every))
    .map((round) => ({ round, x: x(round), reached: round <= lastRound }));

  const valueStep = high - low <= 50 ? 10 : 20;
  const valueTicks: ValueTick[] = [];
  for (let value = Math.ceil(low / valueStep) * valueStep; value <= high; value += valueStep) {
    valueTicks.push({ value, y: y(value) });
  }

  return {
    ticks,
    valueTicks,
    line,
    branches,
    head,
    pending,
    targetY: y(input.target * 100),
  };
}

/** The chart in words, for screen readers. */
export function describeCurve(input: CurveInput): string {
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
  if (parts.length === 0)
    return `Score on the check tasks by round: nothing measured yet. ${target}`;
  return `Score on the check tasks by round: ${parts.join(', ')}. ${target}`;
}
