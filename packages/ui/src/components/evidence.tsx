import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Lock, MonitorCheck, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

/**
 * The four kinds of result Architect keeps apart wherever they show: practice on training tasks
 * the mentor sees, checks on development tasks hidden from it, the locked final test, and the
 * install checks a computer runs on its own. Each has its own mark and its own bar, so a practice
 * score or an install check never reads as held-out evidence.
 */
export type EvidenceKind = 'practice' | 'check' | 'final' | 'install';

const EVIDENCE: Record<EvidenceKind, { label: string; icon: LucideIcon; tone: string }> = {
  practice: { label: 'Practice tasks', icon: Eye, tone: '' },
  check: { label: 'Check tasks', icon: EyeOff, tone: '' },
  final: { label: 'Final test', icon: Lock, tone: 'text-student' },
  install: { label: 'Works on this computer', icon: MonitorCheck, tone: '' },
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
        size={14}
        strokeWidth={1.8}
        role="img"
        aria-label={typeof children === 'string' ? children : label}
        className={cn('shrink-0', tone, className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-small',
        tone,
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
      {children ?? label}
    </span>
  );
}

/** Practice is a light fill, a check is outlined, the final test is solid, an install check is faint. */
const FILL: Record<EvidenceKind, string> = {
  practice: 'bg-fg/60',
  check: 'bg-student-soft inset-ring-1 inset-ring-student',
  final: 'bg-student',
  install: 'bg-fg/30',
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
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp(value) * 100)}
      aria-valuetext={valueText}
      data-kind={kind}
      className={cn('relative h-1.5 w-full rounded-full bg-line-strong', className)}
    >
      <motion.div
        initial={false}
        animate={{ width: `${clamp(value) * 100}%` }}
        transition={springs.smooth}
        className={cn('h-full rounded-full', FILL[kind])}
      />
      {marker !== undefined && (
        <div
          aria-hidden
          data-marker
          className="absolute -top-[5px] h-4 w-[3px] rounded-full bg-mentor"
          // A tick at either end stays inside the bar, so it is never cut off or made to scroll.
          style={{ left: `clamp(0px, calc(${clamp(marker) * 100}% - 1.5px), calc(100% - 3px))` }}
        />
      )}
    </div>
  );
}
