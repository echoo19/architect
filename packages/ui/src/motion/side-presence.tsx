import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/cn';
import { springs } from './springs';

export interface SidePresenceProps {
  /** Whether the panel is there. */
  show: boolean;
  /** The panel, at its own width; while the width springs it is clipped, never squeezed. */
  children: ReactNode;
  className?: string;
}

/**
 * A panel at a page's right that opens by springing its width from nothing, the page making room
 * as it comes, and closes the same way back, such as a model's panel beside the list it was
 * opened from. Whatever is inside keeps its place while the panel comes and goes.
 */
export function SidePresence({ show, children, className }: SidePresenceProps) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="side"
          initial={{ width: 0 }}
          animate={{ width: 'auto', transition: springs.smooth }}
          exit={{ width: 0, transition: springs.settle }}
          className={cn('flex h-full shrink-0 justify-start overflow-hidden', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
