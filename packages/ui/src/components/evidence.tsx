import type { CSSProperties, ReactNode } from 'react';
import { Eye, EyeOff, Lock, MonitorCheck, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * The four kinds of result Architect keeps apart wherever they show: practice on training tasks
 * the mentor sees, checks on development tasks hidden from it, the locked final test, and the
 * install checks a computer runs on its own. Each has its own mark and its own bar, so a practice
 * score or an install check never reads as held-out evidence.
 */
export type EvidenceKind = 'practice' | 'check' | 'final' | 'install';

const EVIDENCE: Record<EvidenceKind, { label: string; icon: LucideIcon; tone: string }> = {
  practice: { label: 'Practice', icon: Eye, tone: 'text-fg-muted' },
  check: { label: 'Check', icon: EyeOff, tone: 'text-fg-secondary' },
  final: { label: 'Final test', icon: Lock, tone: 'text-student' },
  install: { label: 'Install check', icon: MonitorCheck, tone: 'text-fg-muted' },
};

/** A kind's own label, for screens that name it in a sentence or a heading. */
export function evidenceLabel(kind: EvidenceKind): string {
  return EVIDENCE[kind].label;
}

export interface EvidenceMarkProps {
  kind: EvidenceKind;
  /** Replaces the kind's own label, e.g. "Check tasks". */
  children?: ReactNode;
  /** The icon alone, named for assistive tech by the label. */
  iconOnly?: boolean;
  className?: string;
}

/** The icon and name of a kind of result: an eye for practice, a lock for the final test. */
export function EvidenceMark({ kind, children, iconOnly = false, className }: EvidenceMarkProps) {
  const { label, icon: Icon, tone } = EVIDENCE[kind];
  if (iconOnly) {
    return (
      <Icon
        size={13}
        strokeWidth={1.8}
        role="img"
        aria-label={typeof children === 'string' ? children : label}
        className={cn('shrink-0', tone, className)}
      />
    );
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm', tone, className)}
    >
      <Icon size={13} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {children ?? label}
    </span>
  );
}

/** Practice is hatched, a check is outlined, the final test is solid, an install check is grey. */
const FILL: Record<EvidenceKind, { className: string; style?: CSSProperties }> = {
  practice: {
    className: '',
    style: {
      backgroundImage:
        'repeating-linear-gradient(-45deg, var(--ui-fg-faint) 0 1.5px, transparent 1.5px 4px)',
    },
  },
  check: { className: 'bg-student-dim shadow-[inset_0_0_0_1px_var(--ui-student)]' },
  final: { className: 'bg-student' },
  install: { className: 'bg-fg-faint' },
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export interface EvidenceMeterProps {
  kind: EvidenceKind;
  /** Fill from 0 to 1. */
  value: number;
  /** Accessible name, e.g. "Refunds, final test". */
  label: string;
  /** Read out in place of a percentage, e.g. "6 of 6 passed". */
  valueText?: string;
  /**
   * The mentor's own score on the same tasks, 0 to 1, as an amber tick. Only where the mentor
   * was measured on the same distribution; never an inferred one.
   */
  marker?: number;
  className?: string;
}

/** A score bar drawn in its kind's own way, with the mentor's tick where it was measured. */
export function EvidenceMeter({
  kind,
  value,
  label,
  valueText,
  marker,
  className,
}: EvidenceMeterProps) {
  const fill = FILL[kind];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp(value) * 100)}
      aria-valuetext={valueText}
      data-kind={kind}
      className={cn('relative h-1.5 w-full rounded-full bg-line-card', className)}
    >
      <div
        className={cn('h-full rounded-full', fill.className)}
        style={{ ...fill.style, width: `${clamp(value) * 100}%` }}
      />
      {marker !== undefined && (
        <div
          aria-hidden
          data-marker
          className="absolute -top-[3px] h-3 w-0.5 rounded-sm bg-mentor"
          style={{ left: `calc(${clamp(marker) * 100}% - 1px)` }}
        />
      )}
    </div>
  );
}
