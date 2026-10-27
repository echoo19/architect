import type { ReactNode } from 'react';
import { Tooltip as RadixTooltip } from 'radix-ui';

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
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-sm border border-line-control bg-modal px-2 py-1 text-xs text-fg shadow-popover data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade data-[state=instant-open]:animate-fade"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
