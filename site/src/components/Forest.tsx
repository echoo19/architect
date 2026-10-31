import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@architect/ui';
import type { Tone } from '../evidence';

/**
 * A row of an interval plot: one thing measured, the number it came to, and the 95% interval the
 * report gives around it. Marks are thin and drawn from the page's own colors: white, the
 * student's blue for the run that was taught, the mentor's amber for Spark. Each row names itself
 * and states its figure in words, so no mark is the only way to read a number.
 */
export interface ForestRow {
  label: ReactNode;
  /** The estimate, with its interval, on the axis. */
  value: number;
  low: number;
  high: number;
  /** The figure the row ends on, as it is read. */
  figure: ReactNode;
  tone?: Tone;
  /** Read out in place of the marks. */
  summary: string;
}

const toneClass: Record<Tone, string> = {
  plain: 'bg-fg',
  student: 'bg-student',
  mentor: 'bg-mentor',
};

const COLUMNS =
  'grid-cols-[minmax(0,15rem)_minmax(0,1fr)_var(--figure)] max-sm:grid-cols-[minmax(0,1fr)_auto]';

export function Forest({
  rows,
  min,
  max,
  ticks,
  formatTick,
  target,
  zero,
  name,
  figureWidth = '8.5rem',
}: {
  rows: readonly ForestRow[];
  min: number;
  max: number;
  ticks: readonly number[];
  formatTick: (value: number) => string;
  /** A line to reach, drawn dashed and named under the plot. */
  target?: { at: number; label: string };
  /** Mark where there is no difference, and say so. */
  zero?: string;
  /** What the plot shows, for reading it out. */
  name: string;
  /** How wide the column of figures is, so every row's plot is the same width. */
  figureWidth?: string;
}) {
  const at = (value: number) => `${((value - min) / (max - min)) * 100}%`;
  const style = { '--figure': figureWidth } as CSSProperties;
  return (
    <figure className="m-0" aria-label={name} style={style}>
      {rows.map((row, index) => {
        const tone = row.tone ?? 'plain';
        return (
          <div key={index} className={cn('grid gap-x-5 border-t border-line', COLUMNS)}>
            <div className="flex min-h-14 items-center max-sm:min-h-12">{row.label}</div>
            <div
              role="img"
              aria-label={row.summary}
              className="relative min-h-14 max-sm:order-last max-sm:col-span-2 max-sm:min-h-8"
            >
              {ticks.map((tick) => (
                <span
                  key={tick}
                  aria-hidden
                  className="absolute inset-y-0 border-l border-line"
                  style={{ left: at(tick) }}
                />
              ))}
              {zero && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 border-l border-fg"
                  style={{ left: at(0) }}
                />
              )}
              {target && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 border-l border-dashed border-line-strong"
                  style={{ left: at(target.at) }}
                />
              )}
              <span
                aria-hidden
                className={cn('absolute top-1/2 h-0.5 -translate-y-1/2', toneClass[tone])}
                style={{ left: at(row.low), width: `calc(${at(row.high)} - ${at(row.low)})` }}
              />
              {[row.low, row.high].map((end) => (
                <span
                  key={end}
                  aria-hidden
                  className={cn(
                    'absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2',
                    toneClass[tone],
                  )}
                  style={{ left: at(end) }}
                />
              ))}
              <span
                aria-hidden
                className={cn(
                  'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ground',
                  toneClass[tone],
                )}
                style={{ left: at(row.value) }}
              />
            </div>
            <div className="flex min-h-14 items-center justify-end tabular-nums max-sm:min-h-12">
              {row.figure}
            </div>
          </div>
        );
      })}
      <div className={cn('grid gap-x-5 border-t border-line', COLUMNS)}>
        <span className="max-sm:hidden" />
        <div className="relative h-8 text-small tabular-nums max-sm:col-span-2">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              className={cn(
                'absolute top-2 whitespace-nowrap',
                index === 0
                  ? ''
                  : index === ticks.length - 1
                    ? '-translate-x-full'
                    : '-translate-x-1/2',
              )}
              style={{ left: at(tick) }}
            >
              {formatTick(tick)}
            </span>
          ))}
        </div>
      </div>
      {(target || zero) && (
        <p className="m-0 mt-1 flex flex-wrap gap-x-6 text-small tabular-nums">
          {zero && (
            <span>
              <span aria-hidden className="mr-2 inline-block h-3 border-l border-fg align-middle" />
              {zero}
            </span>
          )}
          {target && (
            <span>
              <span
                aria-hidden
                className="mr-2 inline-block h-3 border-l border-dashed border-line-strong align-middle"
              />
              {target.label}
            </span>
          )}
        </p>
      )}
    </figure>
  );
}
