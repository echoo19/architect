import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Tabs } from 'radix-ui';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

export interface PageTab<T extends string> {
  value: T;
  label: string;
  /** A 16px Lucide icon before the label. */
  icon?: ReactNode;
}

export interface PageTabsProps<T extends string> {
  tabs: readonly PageTab<T>[];
  value: T;
  onValueChange: (value: T) => void;
  'aria-label': string;
  /** The open tab's content. */
  children: ReactNode;
  className?: string;
}

/**
 * A page's sections as tabs: a segmented strip under the title whose selected fill slides
 * between them, and the open tab's content below it.
 */
export function PageTabs<T extends string>({
  tabs,
  value,
  onValueChange,
  children,
  className,
  ...props
}: PageTabsProps<T>) {
  const indicator = useId();
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        const match = tabs.find((tab) => tab.value === next);
        if (match) onValueChange(match.value);
      }}
      className={cn('flex min-w-0 flex-col gap-6', className)}
    >
      <Tabs.List
        aria-label={props['aria-label']}
        className="inline-flex self-start rounded-full bg-field p-[3px] shadow-edge"
      >
        {tabs.map((tab) => (
          <Tabs.Trigger
            key={tab.value}
            value={tab.value}
            // Radix focuses a clicked tab from script, which draws the keyboard ring for a mouse
            // click; a click opens the tab without moving focus, and the keyboard is unchanged.
            onMouseDown={(event) => {
              if (event.button !== 0 || event.ctrlKey) return;
              event.preventDefault();
              onValueChange(tab.value);
            }}
            className={cn(
              'relative flex h-9 items-center gap-2 rounded-full px-4 text-ui font-medium',
              'transition-colors duration-150 hover:bg-hover',
            )}
          >
            {tab.value === value && (
              <motion.span
                layoutId={indicator}
                transition={springs.snappy}
                aria-hidden
                className="absolute inset-0 rounded-full bg-raised shadow-edge-strong"
              />
            )}
            {tab.icon && (
              <span aria-hidden className="relative flex [&_svg]:size-4">
                {tab.icon}
              </span>
            )}
            <span className="relative">{tab.label}</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value={value} className="min-w-0 focus-visible:outline-none">
        {children}
      </Tabs.Content>
    </Tabs.Root>
  );
}
