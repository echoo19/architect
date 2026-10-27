import { cn } from '../lib/cn';

export interface ProgressProps {
  /** Done so far, from 0 to 1. Leave it out while the total isn't known yet. */
  value?: number;
  /** Accessible name, e.g. "Downloading Muse Glimmer". */
  label: string;
  /** Read out instead of a percentage, e.g. "4.2 GB of 18 GB". */
  valueText?: string;
  className?: string;
}

/** Progress toward a known end, such as a download. A Meter shows a level instead. */
export function Progress({ value, label, valueText, className }: ProgressProps) {
  const fill = value === undefined ? undefined : Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fill === undefined ? undefined : Math.round(fill * 100)}
      aria-valuetext={valueText}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-line-card', className)}
    >
      {fill === undefined ? (
        <div className="h-full w-full animate-skeleton rounded-full bg-student-dim" />
      ) : (
        <div
          className="h-full rounded-full bg-student transition-[width] duration-200"
          style={{ width: `${fill * 100}%` }}
        />
      )}
    </div>
  );
}
