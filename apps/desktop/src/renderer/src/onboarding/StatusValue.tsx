import type { ReactNode } from 'react';
import { cn } from '@architect/ui';
import { CircleCheck, CircleMinus } from 'lucide-react';

/** The right side of a setup row: done, or not set up. */
export function StatusValue({ done, children }: { done: boolean; children: ReactNode }) {
  const Icon = done ? CircleCheck : CircleMinus;
  return (
    <span className="flex items-center gap-1.5 text-fg">
      <Icon
        size={15}
        strokeWidth={1.8}
        aria-hidden
        className={cn('shrink-0', done ? 'text-student' : 'text-fg')}
      />
      {children}
    </span>
  );
}
