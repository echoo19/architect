import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Tooltip as RadixTooltip } from 'radix-ui';
import { useFloatingMotion } from '../motion/floating';
import { springs } from '../motion/springs';

/** Mount once near the root so every Tooltip shares one open delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={500} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** A single focusable element, such as an IconButton. */
  children: ReactNode;
}

export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const floating = useFloatingMotion({
    origin: 'var(--radix-tooltip-content-transform-origin)',
    transition: springs.snappy,
  });
  return (
    <RadixTooltip.Root open={open} onOpenChange={setOpen}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal forceMount>
        <AnimatePresence>
          {open && (
            <RadixTooltip.Content key="content" forceMount asChild side={side} sideOffset={6}>
              <motion.div
                {...floating}
                className="z-50 rounded-mark surface-float px-2.5 py-1.5 text-small"
              >
                {content}
              </motion.div>
            </RadixTooltip.Content>
          )}
        </AnimatePresence>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
