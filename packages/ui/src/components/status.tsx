import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Check, CircleAlert, CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';
import { Spinner } from './spinner';

export type BadgeTone = 'outline' | 'neutral' | 'emphasis' | 'student' | 'danger' | 'alert';

const badgeTone: Record<BadgeTone, string> = {
  outline: 'shadow-edge-strong',
  neutral: 'bg-hover',
  /**
   * What must not be missed but is not bad news, such as an example made up to show a step: a
   * stronger edge and a heavier weight, so it stands out among plain tags without the red of a
   * warning.
   */
  emphasis: 'font-medium shadow-edge-strong',
  student: 'bg-student-soft font-medium text-student',
  danger: 'text-danger inset-ring-1 inset-ring-danger/40',
  /** Bad news as loud as the good: a filled tint where `student` is a filled blue. */
  alert: 'bg-danger-soft font-medium text-danger',
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
  attention: 'text-fg',
  blocked: 'text-danger',
  off: 'text-fg',
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
 * or still running. An icon, never a dot.
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
  /** The version chats run on, set in the student's color. */
  active?: boolean;
  className?: string;
}

/** "v2" in a small tile, the way a list of an agent's versions marks each one. Decorative. */
export function VersionTag({ version, active = false, className }: VersionTagProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-7 min-w-9 shrink-0 items-center justify-center rounded-mark px-1.5 font-mono text-small',
        active ? 'bg-student-soft text-student' : 'bg-hover',
        className,
      )}
    >
      v{version}
    </span>
  );
}

export interface BadgeProps {
  tone?: BadgeTone;
  /** `md` is 28px, `lg` is 32px. */
  size?: 'md' | 'lg';
  /** A leading 14px icon. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A small pill: "Offline" in the workspace header, "Ready" on the report. */
export function Badge({ tone = 'outline', size = 'md', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 text-small',
        size === 'md' ? 'h-7' : 'h-8',
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

/**
 * One name for the current step's pill wherever a stepper is drawn: each flow step is a screen of
 * its own, and the pill slides from the step left to the step arrived at.
 */
const STEPPER_PILL = 'progress-stepper-current';

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
      className={cn('m-0 flex list-none flex-wrap gap-1 p-0 text-small', className)}
    >
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'next';
        const needs = state === 'done' && attention.includes(step);
        return (
          <li
            key={step}
            aria-current={state === 'current' ? 'step' : undefined}
            className={cn(
              'relative isolate flex h-8 items-center px-3.5',
              state === 'done' && 'gap-1.5',
              state === 'current' && 'font-medium',
            )}
          >
            {state === 'done' &&
              (needs ? (
                <CircleAlert size={13} strokeWidth={2.2} aria-hidden />
              ) : (
                <Check size={13} strokeWidth={2.2} aria-hidden />
              ))}
            {step}
            {state === 'current' && (
              <motion.span
                layoutId={STEPPER_PILL}
                transition={springs.smooth}
                aria-hidden
                className="absolute inset-0 -z-10 rounded-full bg-selected"
              />
            )}
            {state === 'done' && (
              <span className="sr-only">{needs ? ', needs attention' : ', done'}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
