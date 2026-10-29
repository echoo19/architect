import type { ReactNode } from 'react';
import { cn, IconButton } from '@architect/ui';
import { Check, X } from 'lucide-react';

const FLOW_STEPS = ['Describe', 'Define', 'Train', 'Report'] as const;

/**
 * The bar over the new-agent flow: close, the job's name and the four steps, of which `current`
 * is the one shown. Where the stage is narrow only the steps stay.
 */
export function FlowBar({
  title,
  current,
  actions,
  className,
}: {
  title: ReactNode;
  current: number;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'grid min-h-[60px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-ground-flow px-4 py-2.5',
        'narrow:grid-cols-1 narrow:justify-items-center narrow:px-2',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 narrow:hidden">
        <IconButton label="Close" tabIndex={-1}>
          <X size={18} strokeWidth={1.8} aria-hidden />
        </IconButton>
        <span className="min-w-0 truncate font-medium">{title}</span>
      </div>
      <ol aria-label="Progress" className="m-0 flex list-none gap-1 p-0 text-sm">
        {FLOW_STEPS.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? 'step' : undefined}
            className={cn(
              'flex h-[30px] items-center px-3.5 narrow:px-2.5',
              index < current && 'gap-1.5 text-fg-secondary',
              index === current && 'rounded-full bg-selected text-fg',
              index > current && 'text-fg-muted',
            )}
          >
            {index < current && (
              <Check size={12} strokeWidth={2.2} aria-hidden className="narrow:hidden" />
            )}
            {step}
          </li>
        ))}
      </ol>
      <div className="flex min-w-0 justify-end gap-2 narrow:hidden">{actions}</div>
    </header>
  );
}
