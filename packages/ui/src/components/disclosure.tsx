import { Fragment, useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

export interface DisclosureProps {
  /** What opens, such as "Details" or "The call". */
  label: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Something a person rarely needs, folded under a quiet line until they ask for it: the ids,
 * hashes and settings behind a result, or the raw call behind a step.
 */
export function Disclosure({ label, defaultOpen = false, children, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 self-start rounded-xs text-sm text-fg-muted transition-colors duration-150 hover:text-fg"
      >
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          aria-hidden
          className={cn('shrink-0 transition-transform duration-200', open && 'rotate-90')}
        />
        {label}
      </button>
      {open && (
        <div id={id} className="min-w-0 animate-rise pt-2">
          {children}
        </div>
      )}
    </div>
  );
}

export interface DetailItem {
  label: string;
  value: ReactNode;
}

export interface DetailListProps {
  items: readonly DetailItem[];
  className?: string;
}

/** Names and values set in mono, for ids, hashes and settings a person may need to quote. */
export function DetailList({ items, className }: DetailListProps) {
  return (
    <dl
      className={cn(
        'm-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-sm leading-5',
        className,
      )}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="text-fg-muted">{item.label}</dt>
          <dd className="m-0 min-w-0 break-all font-mono text-xs leading-5 text-fg-secondary">
            {item.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
