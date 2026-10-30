import { Fragment, useId, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Collapse } from '../motion/collapse';
import { springs } from '../motion/springs';

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
        className="-ml-1 flex h-8 items-center gap-1.5 self-start rounded-mark pl-1 pr-2 text-small font-medium transition-colors duration-150 hover:bg-hover"
      >
        <motion.span
          initial={false}
          animate={{ rotate: open ? 90 : 0 }}
          transition={springs.snappy}
          className="flex shrink-0"
        >
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
        </motion.span>
        {label}
      </button>
      <Collapse open={open} id={id}>
        <div className="pt-2">{children}</div>
      </Collapse>
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
        'm-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-small leading-5',
        className,
      )}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="font-medium">{item.label}</dt>
          <dd className="m-0 min-w-0 break-all font-mono text-small leading-5">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
