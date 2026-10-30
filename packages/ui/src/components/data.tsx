import type { ComponentProps, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

export type StatSize = 'md' | 'lg' | 'xl';

const statValue: Record<StatSize, string> = {
  md: 'text-h1',
  lg: 'text-title',
  xl: 'text-hero',
};

export interface StatProps {
  value: ReactNode;
  label?: ReactNode;
  /** A small line under the label, e.g. "Spark 94%". */
  note?: ReactNode;
  noteTone?: 'muted' | 'mentor' | 'student';
  /** `code` sets the note in mono, for a figure; `text` for a phrase that may wrap. */
  noteFont?: 'text' | 'code';
  size?: StatSize;
  className?: string;
}

const noteTones = { muted: '', mentor: 'text-mentor', student: 'text-student' };

/** A big number with a label: "91% Task success". */
export function Stat({
  value,
  label,
  note,
  noteTone = 'muted',
  noteFont = 'code',
  size = 'md',
  className,
}: StatProps) {
  return (
    <div className={cn('flex flex-col', size === 'md' ? 'gap-1.5' : 'gap-1', className)}>
      <span className={cn('font-display font-semibold tabular-nums', statValue[size])}>
        {value}
      </span>
      {label && <span>{label}</span>}
      {note && (
        <span
          className={cn(
            'text-small',
            noteFont === 'code' ? 'font-mono' : 'text-pretty',
            noteTones[noteTone],
          )}
        >
          {note}
        </span>
      )}
    </div>
  );
}

export interface MeterProps {
  /** Fill from 0 to 1. Past 1 the meter is full and red: what it measures went over its cap. */
  value: number;
  /** Accessible name, e.g. "Spark spending". */
  label: string;
  /** Read out instead of a percentage, e.g. "$2.40 of $5". */
  valueText?: string;
  /** Whose it is: the student's blue, the mentor's amber, or plain. */
  tone?: 'fg' | 'student' | 'mentor';
  /** 3px for budgets, 4px for per-skill scores. */
  thickness?: 3 | 4;
  /** A mentor-colored tick, 0 to 1, for comparing against the mentor's own score. */
  marker?: number;
  className?: string;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const METER_TONES = { fg: 'bg-fg', student: 'bg-student', mentor: 'bg-mentor' } as const;

export function Meter({
  value,
  label,
  valueText,
  tone = 'fg',
  thickness = 3,
  marker,
  className,
}: MeterProps) {
  const fill = clamp(value);
  const over = value > 1;
  return (
    <div
      role="meter"
      aria-label={label}
      data-over={over || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill * 100)}
      aria-valuetext={valueText}
      className={cn(
        'relative w-full rounded-full bg-line-strong',
        thickness === 3 ? 'h-[3px]' : 'h-1',
        className,
      )}
    >
      <motion.div
        initial={false}
        animate={{ width: `${fill * 100}%` }}
        transition={springs.smooth}
        className={cn('h-full rounded-full', over ? 'bg-danger' : METER_TONES[tone])}
      />
      {marker !== undefined && (
        <div
          aria-hidden
          className="absolute -top-1 h-3 w-0.5 rounded-mark bg-mentor"
          style={{ left: `clamp(0px, calc(${clamp(marker) * 100}% - 1px), calc(100% - 2px))` }}
        />
      )}
    </div>
  );
}

export interface CapMeterProps {
  /** What is measured, such as "Spark". Also the meter's accessible name. */
  label: ReactNode;
  /** Plain-text name for assistive tech when `label` is not a string. */
  name?: string;
  used: number;
  /** The hard cap. Absent when none was recorded: the amount stands alone, with no meter. */
  cap?: number | undefined;
  /** Writes an amount, such as `$2.40`. */
  format: (amount: number) => string;
  tone?: MeterProps['tone'];
  className?: string;
}

/**
 * An amount against its cap: the label, "used of cap" in tabular figures, and a thin meter under
 * them. Over the cap, the figures and the meter turn red.
 */
export function CapMeter({
  label,
  name,
  used,
  cap,
  format,
  tone = 'fg',
  className,
}: CapMeterProps) {
  const over = cap !== undefined && used > cap;
  const reading = cap === undefined ? format(used) : `${format(used)} of ${format(cap)}`;
  const accessible = name ?? (typeof label === 'string' ? label : 'Spending');
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3 text-ui">
        <span className="min-w-0 truncate">{label}</span>
        <span className={cn('shrink-0 tabular-nums', over && 'text-danger')}>
          {cap === undefined ? (
            format(used)
          ) : (
            <>
              <span className="font-medium">{format(used)}</span> of {format(cap)}
            </>
          )}
        </span>
      </div>
      {cap !== undefined && (
        <Meter
          label={accessible}
          tone={tone}
          value={cap === 0 ? (used > 0 ? 2 : 0) : used / cap}
          valueText={over ? `${reading}, over the cap` : reading}
        />
      )}
    </div>
  );
}

export interface TableProps extends ComponentProps<'table'> {
  /** `card` is the bordered table in chat; `plain` is the mono table in side panels. */
  variant?: 'card' | 'plain';
}

export function Table({ variant = 'card', className, children, ...props }: TableProps) {
  const table = (
    <table
      data-variant={variant}
      className={cn(
        'group/table w-full border-collapse tabular-nums',
        variant === 'card' ? 'text-ui' : 'font-mono text-small',
        className,
      )}
      {...props}
    >
      {children}
    </table>
  );
  if (variant === 'plain') return table;
  return <div className="overflow-hidden rounded-control shadow-edge">{table}</div>;
}

export function TableHeader(props: ComponentProps<'thead'>) {
  return <thead {...props} />;
}

export function TableBody(props: ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('[tbody_&]:border-t [tbody_&]:border-line', className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'text-left font-medium',
        'group-data-[variant=card]/table:px-4 group-data-[variant=card]/table:py-2.5',
        'group-data-[variant=plain]/table:py-2 group-data-[variant=plain]/table:pr-3',
        className,
      )}
      {...props}
    />
  );
}

/** The first cell of a row reads as the row's name, set a little heavier than the rest. */
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn(
        'first:font-medium',
        'group-data-[variant=card]/table:px-4 group-data-[variant=card]/table:py-2.5',
        'group-data-[variant=plain]/table:py-[9px] group-data-[variant=plain]/table:pr-3',
        className,
      )}
      {...props}
    />
  );
}
