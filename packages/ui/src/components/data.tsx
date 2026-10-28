import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type StatSize = 'md' | 'lg' | 'xl';

const statValue: Record<StatSize, string> = {
  md: 'text-stat tracking-tighter',
  lg: 'text-display-lg tracking-tightest',
  xl: 'text-hero tracking-tightest',
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

const noteTones = { muted: 'text-fg-muted', mentor: 'text-mentor', student: 'text-student' };

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
      <span className={cn('font-medium tabular-nums', statValue[size])}>{value}</span>
      {label && <span className="text-fg-secondary">{label}</span>}
      {note && (
        <span
          className={cn(
            'text-sm',
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
  /** Fill from 0 to 1. */
  value: number;
  /** Accessible name, e.g. "Spark spending". */
  label: string;
  /** Read out instead of a percentage, e.g. "$2.40 of $5". */
  valueText?: string;
  tone?: 'fg' | 'student';
  /** 3px for budgets, 4px for per-skill scores. */
  thickness?: 3 | 4;
  /** A mentor-colored tick, 0 to 1, for comparing against the mentor's own score. */
  marker?: number;
  className?: string;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

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
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill * 100)}
      aria-valuetext={valueText}
      className={cn(
        'relative w-full rounded-full bg-line-card',
        thickness === 3 ? 'h-[3px]' : 'h-1',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-200',
          tone === 'fg' ? 'bg-fg' : 'bg-student',
        )}
        style={{ width: `${fill * 100}%` }}
      />
      {marker !== undefined && (
        <div
          aria-hidden
          className="absolute -top-1 h-3 w-0.5 rounded-sm bg-mentor"
          style={{ left: `calc(${clamp(marker) * 100}% - 1px)` }}
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
        variant === 'card' ? 'text-base' : 'font-mono text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </table>
  );
  if (variant === 'plain') return table;
  return <div className="overflow-hidden rounded-xl border border-line-card">{table}</div>;
}

export function TableHeader(props: ComponentProps<'thead'>) {
  return <thead {...props} />;
}

export function TableBody(props: ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        '[tbody_&]:border-t group-data-[variant=card]/table:border-line-card group-data-[variant=plain]/table:border-line-row-strong',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'text-left font-normal',
        'group-data-[variant=card]/table:px-4 group-data-[variant=card]/table:py-2.5 group-data-[variant=card]/table:text-fg-secondary',
        'group-data-[variant=plain]/table:py-2 group-data-[variant=plain]/table:pr-3 group-data-[variant=plain]/table:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

/** The first cell of a row reads as the row's name; the rest are secondary. */
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn(
        'text-fg-secondary first:text-fg',
        'group-data-[variant=card]/table:px-4 group-data-[variant=card]/table:py-2.5',
        'group-data-[variant=plain]/table:py-[9px] group-data-[variant=plain]/table:pr-3',
        className,
      )}
      {...props}
    />
  );
}
