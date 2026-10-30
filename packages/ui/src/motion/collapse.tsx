import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/cn';
import { springs } from './springs';

export interface CollapseProps {
  open: boolean;
  /** The id a button's `aria-controls` points at. */
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Opens and closes by animating its height, so a disclosure never jumps. Closed, it renders
 * nothing; one that starts open appears open, without the entrance.
 */
export function Collapse({ open, id, className, children }: CollapseProps) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          id={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1, transition: springs.smooth }}
          exit={{ height: 0, opacity: 0, transition: springs.exit }}
          className={cn('min-w-0 overflow-hidden', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
