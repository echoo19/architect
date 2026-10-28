import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ProviderMarkProps {
  /** Whose mark: its first letter is shown unless an icon is given. */
  name: string;
  /** A 14px icon in place of the letter, such as a chip for a model on this computer. */
  icon?: ReactNode;
  className?: string;
}

/** A model provider's mark: a quiet tile with its initial. Decorative; the name is shown beside it. */
export function ProviderMark({ name, icon, className }: ProviderMarkProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-line-control',
        'bg-card text-sm font-medium leading-none text-fg-secondary [&_svg]:size-[15px]',
        className,
      )}
    >
      {icon ?? (name.trim().charAt(0).toUpperCase() || '?')}
    </span>
  );
}
