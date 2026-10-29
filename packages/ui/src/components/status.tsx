import type { ReactNode } from 'react';
import { Check, CircleAlert, CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export type StatusTone = 'student' | 'mentor' | 'neutral' | 'faint';

const dotTone: Record<StatusTone, string> = {
  student: 'bg-student',
  mentor: 'bg-mentor',
  neutral: 'bg-fg-secondary',
  faint: 'bg-fg-faint',
};

export interface StatusDotProps {
  tone?: StatusTone;
  /** Announced to assistive tech, e.g. "Needs you". Without it the dot is decorative. */
  label?: string;
  size?: 6 | 7 | 10;
  className?: string;
}

export function StatusDot({ tone = 'student', label, size = 7, className }: StatusDotProps) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{ width: size, height: size }}
      className={cn('inline-block shrink-0 rounded-full', dotTone[tone], className)}
    />
  );
}

export type BadgeTone = 'outline' | 'neutral' | 'emphasis' | 'student' | 'danger' | 'alert';

const badgeTone: Record<BadgeTone, string> = {
  outline: 'border border-line-control text-fg-secondary',
  neutral: 'border border-line-control bg-card text-fg-soft',
  /**
   * What must not be missed but is not bad news, such as an example made up to show a step: the
   * body's own ink and a stronger edge, so it stands out among quiet tags without the red of a
   * warning.
   */
  emphasis: 'border border-line-strong font-medium text-fg',
  student: 'bg-student-tint font-medium text-student',
  danger: 'border border-danger-line text-danger',
  /** Bad news as loud as the good: a filled tint where `student` is a filled blue. */
  alert: 'bg-danger-tint font-medium text-danger',
};

export type MarkState = 'ok' | 'attention' | 'blocked' | 'off' | 'working';

const markIcon = {
  ok: CircleCheck,
  attention: CircleAlert,
  blocked: CircleX,
  off: CircleMinus,
} as const;

const markTone: Record<Exclude<MarkState, 'working'>, string> = {
  ok: 'text-student',
  attention: 'text-fg-soft',
  blocked: 'text-danger',
  off: 'text-fg-faint',
};

export interface StatusMarkProps {
  state: MarkState;
  /** Read out in place of the icon, e.g. "Passed". Without it the mark is decorative. */
  label?: string;
  /** 16 in a row; 24 beside a page title. */
  size?: 14 | 16 | 18 | 24;
  className?: string;
}

/**
 * A check's outcome at the start of a row: passed, needs attention, blocked, left out or skipped,
 * or still running.
 */
export function StatusMark({ state, label, size = 16, className }: StatusMarkProps) {
  if (state === 'working') return <Spinner size={size} label={label} className={className} />;
  const Icon = markIcon[state];
  return (
    <Icon
      size={size}
      strokeWidth={1.8}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('shrink-0', markTone[state], className)}
    />
  );
}

export interface VersionTagProps {
  version: number;
  /** The version chats run on, set in the student's tint. */
  active?: boolean;
  className?: string;
}

/** "v2" in a small tile, the way a list of an agent's versions marks each one. Decorative. */
export function VersionTag({ version, active = false, className }: VersionTagProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-7 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 font-mono text-sm',
        active ? 'bg-student-tint text-student' : 'bg-hover text-fg-secondary',
        className,
      )}
    >
      v{version}
    </span>
  );
}

export interface BadgeProps {
  tone?: BadgeTone;
  /** `md` is 28px, `lg` is 30px. */
  size?: 'md' | 'lg';
  /** A leading StatusDot or 14px icon. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A small pill: "Offline" in the workspace header, "Ready" on the report. */
export function Badge({ tone = 'outline', size = 'md', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm',
        size === 'md' ? 'h-7' : 'h-[30px]',
        icon && (tone === 'student' || tone === 'alert' ? 'gap-1.5 pl-2.5' : 'gap-2'),
        badgeTone[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export interface ProgressStepperProps {
  steps: readonly string[];
  /** Index of the current step. Earlier steps show as done. */
  current: number;
  /** Earlier steps that still need something from the person: marked as that, not as done. */
  attention?: readonly string[];
  'aria-label'?: string;
  className?: string;
}

/** The header pills of the new-agent flow: Describe, Define, Train, Graduate. */
export function ProgressStepper({
  steps,
  current,
  attention = [],
  className,
  ...props
}: ProgressStepperProps) {
  return (
    <ol
      aria-label={props['aria-label'] ?? 'Progress'}
      className={cn('m-0 flex list-none flex-wrap gap-1 p-0 text-sm', className)}
    >
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'next';
        const needs = state === 'done' && attention.includes(step);
        return (
          <li
            key={step}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'flex h-[30px] items-center px-3.5',
              state === 'done' && 'gap-1.5 text-fg-secondary',
              state === 'current' && 'rounded-full bg-selected text-fg',
              state === 'next' && 'text-fg-muted',
            )}
          >
            {state === 'done' &&
              (needs ? (
                <CircleAlert size={12} strokeWidth={2.2} aria-hidden />
              ) : (
                <Check size={12} strokeWidth={2.2} aria-hidden />
              ))}
            {step}
            {state === 'done' && (
              <span className="sr-only">{needs ? ', needs attention' : ', done'}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
