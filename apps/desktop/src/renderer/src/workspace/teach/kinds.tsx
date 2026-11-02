import type { CorrectionKind } from '@architect/shared';
import { cn } from '@architect/ui';
import { CircleHelp, CircleSlash, Dumbbell, FileSearch, ListChecks } from 'lucide-react';
import { KIND_LABELS } from './lessons';

const KIND_ICONS: Record<CorrectionKind, typeof ListChecks> = {
  procedure: ListChecks,
  source: FileSearch,
  weakness: Dumbbell,
  ambiguous: CircleHelp,
  invalid: CircleSlash,
};

/** A lesson's kind as its icon, bare at the start of a row, the way rows mark what they hold. */
export function KindIcon({ kind, className }: { kind: CorrectionKind; className?: string }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span
      role="img"
      aria-label={KIND_LABELS[kind]}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center text-fg [&_svg]:size-4',
        className,
      )}
    >
      <Icon size={15} strokeWidth={1.7} aria-hidden />
    </span>
  );
}

/** A lesson's kind as an icon and its name, over the lesson itself. */
export function KindLabel({ kind }: { kind: CorrectionKind }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span className="flex items-center gap-2 text-small text-fg">
      <Icon size={15} strokeWidth={1.7} aria-hidden />
      {KIND_LABELS[kind]}
    </span>
  );
}
