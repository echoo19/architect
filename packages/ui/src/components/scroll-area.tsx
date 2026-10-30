import type { ReactNode, Ref } from 'react';
import { ScrollArea as RadixScrollArea } from 'radix-ui';
import { cn } from '../lib/cn';

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  /** The scrolling element, e.g. to keep a chat pinned to the bottom. */
  viewportRef?: Ref<HTMLDivElement>;
  'aria-label'?: string;
}

/** A vertical scroll region with the thin, quiet scrollbar from the design. */
export function ScrollArea({
  children,
  className,
  viewportClassName,
  viewportRef,
  ...aria
}: ScrollAreaProps) {
  return (
    <RadixScrollArea.Root
      type="hover"
      className={cn('relative min-h-0 overflow-hidden', className)}
    >
      <RadixScrollArea.Viewport
        ref={viewportRef}
        {...aria}
        className={cn('size-full rounded-[inherit] focus-visible:outline-none', viewportClassName)}
      >
        {children}
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="vertical"
        className="flex w-2.5 touch-none select-none p-[3px] data-[state=hidden]:animate-fade-out data-[state=visible]:animate-fade"
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-line-strong transition-colors duration-150 hover:bg-fg/30" />
      </RadixScrollArea.Scrollbar>
    </RadixScrollArea.Root>
  );
}
