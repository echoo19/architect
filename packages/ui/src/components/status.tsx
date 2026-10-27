import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../lib/cn';

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

export type BadgeTone = 'outline' | 'neutral' | 'student';

const badgeTone: Record<BadgeTone, string> = {
  outline: 'border border-line-control text-fg-secondary',
  neutral: 'border border-line-control bg-card text-fg-soft',
  student: 'bg-student-tint font-medium text-student',
};

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
        icon && (tone === 'student' ? 'gap-1.5 pl-2.5' : 'gap-2'),
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
  'aria-label'?: string;
  className?: string;
}

/** The header pills of the new-agent flow: Describe, Define, Train, Graduate. */
export function ProgressStepper({ steps, current, className, ...props }: ProgressStepperProps) {
  return (
    <ol
      aria-label={props['aria-label'] ?? 'Progress'}
      className={cn('m-0 flex list-none flex-wrap gap-1 p-0 text-sm', className)}
    >
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'next';
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
            {state === 'done' && <Check size={12} strokeWidth={2.2} aria-hidden />}
            {step}
            {state === 'done' && <span className="sr-only">, done</span>}
          </li>
        );
      })}
    </ol>
  );
}
