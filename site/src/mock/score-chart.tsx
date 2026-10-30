import type { CSSProperties } from 'react';
import { cn } from '@architect/ui';
import { at } from './motion';

/**
 * The score on check tasks, round by round: a line that climbs with each change that is kept, a
 * dashed branch ending in a hollow point for a change that was tried and not kept, and the target.
 * It is laid out in HTML over a plot box, with a stretched SVG for the line, so its labels stay the
 * size of the product's text at any width.
 *
 * The scores are the returns desk's, from comparison 2: 31 of 45 check tasks to start, 42 of 45
 * once round 1 was kept, and 44 of 45 once round 4 was. Rounds 2 and 3 scored 44 of 45 but did not
 * clear the rule for keeping a change, so they are hollow points off the line.
 */

const FLOOR = 60;
const TOP = 100;
/** The share of the plot's height from its top for a score. */
const row = (score: number) => ((TOP - score) / (TOP - FLOOR)) * 100;
/** The share of the plot's width for a round, 0 to 4. */
const column = (round: number) => round * 25;

const TARGET = 95;
const TICKS = ['Start', '1', '2', '3', '4'] as const;
const START = (31 / 45) * 100;
const KEPT_ONE = (42 / 45) * 100;
const FINAL = (44 / 45) * 100;
/** Where the line runs: up with round 1, level through rounds 2 and 3, up again with round 4. */
const LINE = `${column(0)},${row(START)} ${column(1)},${row(KEPT_ONE)} ${column(2)},${row(KEPT_ONE)} ${column(3)},${row(KEPT_ONE)} ${column(4)},${row(FINAL)}`;

/** When each stretch of the line is drawn, in ms from the start of the chapter. */
export interface ChartTimes {
  /** Round 1 is kept and the line climbs to it. */
  rise1: number;
  /** Rounds 2 and 3 are tried and not kept. */
  hollow2: number;
  hollow3: number;
  /** Round 4's score lands and the line climbs to it. */
  rise4: number;
}

/** The part of the plot a sweep reveals, as columns from 0 to 100, and when. */
function sweep(from: number, to: number, start: number, dur: number): CSSProperties {
  return { ...at(start, { dur }), '--x0': `${from}%`, '--x1': `${to}%` } as CSSProperties;
}

/**
 * A stretch of the line, revealed by sweeping across it. Each stretch is the whole line clipped
 * to its columns, so the line is drawn once and the stretches join without a seam.
 */
function Stretch({
  from,
  to,
  start,
  dur,
  played,
}: {
  from: number;
  to: number;
  start: number;
  dur: number;
  /** Not in the finished picture: the first stretch already shows the whole line there. */
  played?: boolean;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn(
        'a a-sweep absolute inset-0 h-full w-full overflow-visible',
        played && 'motion-only',
      )}
      style={sweep(from, to, start, dur)}
    >
      <polyline
        points={LINE}
        fill="none"
        strokeWidth={2.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-student"
      />
    </svg>
  );
}

/**
 * A change that was tried and not kept: a dashed branch off the line to a hollow point, one round
 * on, at the score it reached.
 */
function NotKept({ round, start }: { round: 2 | 3; start: number }) {
  return (
    <div
      className="a a-sweep absolute inset-0"
      style={sweep(column(round - 1), column(round) + 4, start, 560)}
    >
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <polyline
          points={`${column(round - 1)},${row(KEPT_ONE)} ${column(round)},${row(FINAL)}`}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
          className="stroke-fg"
        />
      </svg>
      <span
        aria-hidden
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-fg bg-card"
        style={{ left: `${column(round)}%`, top: `${row(FINAL)}%` }}
      />
    </div>
  );
}

export function ScoreChart({ times, className }: { times: ChartTimes; className?: string }) {
  return (
    <div className={cn('relative ml-11 mr-3 mt-8 h-[190px]', className)}>
      {[100, 90, 80, 70, 60].map((value) => (
        <span
          key={value}
          className="absolute inset-x-0 border-t border-line"
          style={{ top: `${row(value)}%` }}
        >
          <span className="absolute right-full -translate-y-1/2 pr-3 text-small tabular-nums">
            {value}%
          </span>
        </span>
      ))}
      <span
        className="absolute inset-x-0 border-t border-dashed border-line-strong"
        style={{ top: `${row(TARGET)}%` }}
      >
        <span className="absolute bottom-1.5 left-3 text-small tabular-nums narrow:hidden">
          Target {TARGET}%
        </span>
      </span>
      {TICKS.map((label, round) => (
        <span
          key={label}
          className="absolute inset-y-0 border-l border-line"
          style={{ left: `${column(round)}%` }}
        >
          <span className="absolute left-0 top-full -translate-x-1/2 pt-3 text-small tabular-nums">
            {label}
          </span>
        </span>
      ))}

      <Stretch from={column(0)} to={column(1)} start={times.rise1} dur={750} />
      <Stretch from={column(1)} to={column(2)} start={times.hollow2} dur={420} played />
      <Stretch from={column(2)} to={column(3)} start={times.hollow3} dur={420} played />
      <Stretch from={column(3)} to={column(4)} start={times.rise4} dur={600} played />

      <NotKept round={2} start={times.hollow2} />
      <NotKept round={3} start={times.hollow3} />

      {/* The score now: the line's head. */}
      <span
        aria-hidden
        className="a a-pop absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-student"
        style={{
          left: `${column(4)}%`,
          top: `${row(FINAL)}%`,
          ...at(times.rise4 + 540, { dur: 340 }),
        }}
      />
      <span
        aria-hidden
        className="a a-pop absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-student"
        style={{
          left: `${column(1)}%`,
          top: `${row(KEPT_ONE)}%`,
          ...at(times.rise1 + 600, { dur: 340 }),
        }}
      />
      <span
        aria-hidden
        className="absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-student"
        style={{ left: `${column(0)}%`, top: `${row(START)}%` }}
      />
    </div>
  );
}
