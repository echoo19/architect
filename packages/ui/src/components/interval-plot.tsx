import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

export type IntervalTone = 'student' | 'mentor' | 'fg';

export interface IntervalRow {
  id: string;
  label: string;
  /** The measured value. Null when it was not measured: the row says so, it never shows a zero. */
  estimate: number | null;
  /** The 95% interval's ends. Without them the row shows the point alone. */
  low?: number;
  high?: number;
  tone?: IntervalTone;
}

export interface IntervalGroup {
  /** The group's name, such as an organization or a skill. Leave empty for a single group. */
  label: string;
  rows: readonly IntervalRow[];
}

export interface IntervalPlotProps {
  'aria-label': string;
  groups: readonly IntervalGroup[];
  /** The values at the plot's two ends. Shares, 0 to 1, by default. */
  domain?: readonly [number, number];
  /** Where the faint vertical guides fall, and the labels under the plot. */
  ticks?: readonly number[];
  /** Writes a value, such as `62%`. */
  format?: (value: number) => string;
  className?: string;
}

const TONES: Record<IntervalTone, { bar: string; dot: string }> = {
  student: { bar: 'bg-student', dot: 'bg-student' },
  mentor: { bar: 'bg-mentor', dot: 'bg-mentor' },
  fg: { bar: 'bg-fg', dot: 'bg-fg' },
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Where a value sits along the plot, from 0 to 100, held inside the plot's ends. */
export function intervalPercent(value: number, domain: readonly [number, number]): number {
  const [start, end] = domain;
  if (end === start) return 0;
  return Math.min(100, Math.max(0, ((value - start) / (end - start)) * 100));
}

/** The row's reading for assistive tech: the value and its interval, or that it wasn't measured. */
export function intervalText(row: IntervalRow, format: (value: number) => string): string {
  if (row.estimate === null) return 'not measured';
  const value = format(row.estimate);
  if (row.low === undefined || row.high === undefined) return value;
  return `${value}, 95% interval ${format(row.low)} to ${format(row.high)}`;
}

/**
 * A point with its 95% interval for each row, rows grouped under a name: how each arm of an
 * experiment did on each group. Each row reads out as its label, value and interval.
 */
export function IntervalPlot({
  groups,
  domain = [0, 1],
  ticks = [0, 0.25, 0.5, 0.75, 1],
  format = percent,
  className,
  ...props
}: IntervalPlotProps) {
  return (
    <figure aria-label={props['aria-label']} className={cn('m-0 flex flex-col gap-5', className)}>
      {groups.map((group, index) => (
        <div
          key={`${group.label}-${index}`}
          role="group"
          aria-label={group.label || undefined}
          className="flex flex-col"
        >
          {group.label && <span className="pb-1.5 text-ui font-medium">{group.label}</span>}
          {group.rows.map((row) => (
            <PlotRow key={row.id} row={row} domain={domain} ticks={ticks} format={format} />
          ))}
        </div>
      ))}
      <div
        aria-hidden
        className="grid grid-cols-[minmax(96px,180px)_1fr_72px] gap-4 text-small tabular-nums"
      >
        <span />
        <span className="relative h-5">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-0 -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
              style={{ left: `${intervalPercent(tick, domain)}%` }}
            >
              {format(tick)}
            </span>
          ))}
        </span>
        <span />
      </div>
    </figure>
  );
}

function PlotRow({
  row,
  domain,
  ticks,
  format,
}: {
  row: IntervalRow;
  domain: readonly [number, number];
  ticks: readonly number[];
  format: (value: number) => string;
}) {
  const tone = TONES[row.tone ?? 'student'];
  const hasInterval = row.estimate !== null && row.low !== undefined && row.high !== undefined;
  const from = hasInterval ? intervalPercent(row.low ?? 0, domain) : 0;
  const to = hasInterval ? intervalPercent(row.high ?? 0, domain) : 0;
  return (
    <div className="grid min-h-9 grid-cols-[minmax(96px,180px)_1fr_72px] items-center gap-4 text-ui">
      <span className="truncate">{row.label}</span>
      <span aria-hidden className="relative h-6">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="absolute inset-y-0 w-px bg-line"
            style={{ left: `${intervalPercent(tick, domain)}%` }}
          />
        ))}
        {hasInterval && (
          <motion.span
            initial={false}
            animate={{ left: `${from}%`, width: `${Math.max(to - from, 0)}%` }}
            transition={springs.smooth}
            className={cn('absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full', tone.bar)}
          />
        )}
        {row.estimate !== null && (
          <motion.span
            initial={false}
            animate={{ left: `${intervalPercent(row.estimate, domain)}%` }}
            transition={springs.smooth}
            className={cn(
              'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
              tone.dot,
            )}
          />
        )}
      </span>
      <span className="text-right tabular-nums">
        <span aria-hidden>{row.estimate === null ? '–' : format(row.estimate)}</span>
        <span className="sr-only">{intervalText(row, format)}</span>
      </span>
    </div>
  );
}
