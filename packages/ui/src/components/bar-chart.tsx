import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { useEnterFrom } from '../motion/provider';
import { springs } from '../motion/springs';

export interface BarDatum {
  key: string;
  /** Under the bar, such as a day: "28". Several bars may leave it empty to keep the axis calm. */
  label: string;
  /** How the bar reads out in full, such as "Wednesday, October 28: 6 requests". */
  description: string;
  value: number;
  /** The part of the value drawn in red at its top, such as replies that failed. */
  alert?: number;
}

export interface BarChartProps {
  'aria-label': string;
  data: readonly BarDatum[];
  /** Whose bars they are: the student's blue, or plain. */
  tone?: 'student' | 'fg';
  /** The plot's height in pixels, without its labels. */
  height?: number;
  className?: string;
}

/**
 * The smallest round number at or above `value` for the top of a scale: 1, 2 or 5 times a power
 * of ten, and never under 1, so a scale of counts has whole steps.
 */
export function niceCeiling(value: number): number {
  if (!(value > 1)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((each) => each * power >= value) ?? 10;
  return step * power;
}

const TONES = { student: 'bg-student', fg: 'bg-fg' } as const;

/**
 * Counts as vertical bars, one per step along the axis (such as a day), on faint guides at zero,
 * half and the top, with the top's figure at the left. A step with none keeps a short mark on the
 * baseline, so an empty day still shows. The bars rise into place on first mount. Reads out as a
 * list, one line per bar.
 */
export function BarChart({
  data,
  tone = 'student',
  height = 136,
  className,
  ...props
}: BarChartProps) {
  const top = niceCeiling(Math.max(0, ...data.map((datum) => datum.value)));
  const guides = [top, top / 2, 0];
  const from = useEnterFrom({ scaleY: 0 });
  return (
    <figure aria-label={props['aria-label']} className={cn('m-0 flex flex-col', className)}>
      <ul className="sr-only">
        {data.map((datum) => (
          <li key={datum.key}>{datum.description}</li>
        ))}
      </ul>
      <div aria-hidden className="grid grid-cols-[auto_1fr] gap-x-3">
        <div className="relative w-6 text-small tabular-nums" style={{ height }}>
          {guides.map((guide) => (
            <span
              key={guide}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ top: `${((top - guide) / top) * 100}%` }}
            >
              {Number.isInteger(guide) ? guide : ''}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height }}>
          {guides.map((guide) => (
            <span
              key={guide}
              className={cn('absolute inset-x-0 h-px', guide === 0 ? 'bg-line-strong' : 'bg-line')}
              style={{ top: `${((top - guide) / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {data.map((datum, index) => {
              const share = datum.value / top;
              const alert = Math.min(datum.alert ?? 0, datum.value);
              return (
                <div
                  key={datum.key}
                  className="flex h-full min-w-0 flex-1 items-end justify-center"
                >
                  {datum.value === 0 ? (
                    <span className="h-0.5 w-full max-w-7 rounded-full bg-line-strong" />
                  ) : (
                    <motion.span
                      initial={from}
                      animate={{ scaleY: 1 }}
                      transition={{ ...springs.smooth, delay: Math.min(index, 20) * 0.012 }}
                      className={cn(
                        'flex w-full max-w-7 origin-bottom flex-col overflow-hidden rounded-t-mark rounded-b-[2px]',
                        TONES[tone],
                      )}
                      style={{ height: `${share * 100}%` }}
                    >
                      {alert > 0 && (
                        <span
                          className="w-full shrink-0 bg-danger"
                          style={{ height: `${(alert / datum.value) * 100}%` }}
                        />
                      )}
                    </motion.span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <span />
        <div className="flex gap-[3px] pt-2 text-small tabular-nums">
          {data.map((datum) => (
            <span key={datum.key} className="min-w-0 flex-1 text-center">
              {datum.label}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
