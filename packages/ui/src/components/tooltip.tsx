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
  /**
   * A click opens it too, rather than closing it: for a trigger that does nothing else, such as
   * an info icon, which a pointer that can't hover must still be able to read.
   */
  openOnClick?: boolean;
}

export function Tooltip({ content, side = 'top', children, openOnClick = false }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const floating = useFloatingMotion({
    origin: 'var(--radix-tooltip-content-transform-origin)',
    transition: springs.snappy,
  });
  return (
    <RadixTooltip.Root open={open} onOpenChange={setOpen}>
      <RadixTooltip.Trigger
        asChild
        {...(openOnClick
          ? {
              onClick: (event) => {
                // Radix closes a tooltip on a click; this one opens instead.
                event.preventDefault();
                setOpen(true);
              },
            }
          : {})}
      >
        {children}
      </RadixTooltip.Trigger>
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
