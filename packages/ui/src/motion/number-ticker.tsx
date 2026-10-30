import NumberFlow, { type Format } from '@number-flow/react';
import { cn } from '../lib/cn';
import { useInstantMotion } from './provider';

/**
 * Integers, percentages (a whole number such as 91, shown "91%"), US dollars ("$5" or "$2.40")
 * and durations (a number of milliseconds, shown "2 h 38 min", "14 min" or "40 s").
 */
export type NumberKind = 'integer' | 'percent' | 'currency' | 'duration';

export interface NumberDisplay {
  format: Format;
  suffix?: string;
}

/** How a number of one of the plain kinds is written. */
export function numberDisplay(kind: Exclude<NumberKind, 'duration'>, value: number): NumberDisplay {
  switch (kind) {
    case 'integer':
      return { format: { maximumFractionDigits: 0 } };
    case 'percent':
      return { format: { maximumFractionDigits: 0 }, suffix: '%' };
    case 'currency':
      return {
        format: {
          style: 'currency',
          currency: 'USD',
          // Whole amounts have no cents, as in the rest of the app.
          minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
          maximumFractionDigits: 2,
        },
      };
  }
}

export interface DurationPart {
  value: number;
  suffix: string;
}

/** The hours and minutes, or the minutes, or the seconds, that a length of time is said in. */
export function durationParts(ms: number): DurationPart[] {
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return [{ value: Math.round(ms / 1000), suffix: ' s' }];
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return [{ value: minutes, suffix: ' min' }];
  const rest = minutes % 60;
  return rest === 0
    ? [{ value: hours, suffix: ' h' }]
    : [
        { value: hours, suffix: ' h' },
        { value: rest, suffix: ' min' },
      ];
}

export interface NumberTickerProps {
  value: number;
  kind?: NumberKind;
  className?: string;
}

/**
 * A number whose digits roll to the new value when it changes. It never shows a half-rolled or a
 * wrong value, and sits still when the app runs without animation.
 */
export function NumberTicker({ value, kind = 'integer', className }: NumberTickerProps) {
  const instant = useInstantMotion();
  const shared = { locales: 'en-US', animated: !instant } as const;
  if (kind === 'duration') {
    return (
      <span className={cn('inline-flex items-baseline gap-1 tabular-nums', className)}>
        {durationParts(value).map((part) => (
          <NumberFlow
            key={part.suffix}
            value={part.value}
            format={{ maximumFractionDigits: 0 }}
            suffix={part.suffix}
            {...shared}
          />
        ))}
      </span>
    );
  }
  const display = numberDisplay(kind, value);
  return (
    <NumberFlow
      value={value}
      format={display.format}
      {...(display.suffix === undefined ? {} : { suffix: display.suffix })}
      className={cn('tabular-nums', className)}
      {...shared}
    />
  );
}
