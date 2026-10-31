import type { ReactNode } from 'react';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import { Search } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useFloatingMotion } from '../motion/floating';
import { DialogBackdrop } from './dialog';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
  /** Shown when nothing matches the search. */
  emptyText?: string;
  /** CommandGroup elements. */
  children: ReactNode;
}

/** The Ctrl/Cmd+K palette. Filtering and arrow-key navigation come from cmdk. */
export function CommandPalette({
  open,
  onOpenChange,
  placeholder = 'Search actions and agents',
  emptyText = 'Nothing matches that.',
  children,
}: CommandPaletteProps) {
  const floating = useFloatingMotion({ origin: 'top center' });
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal forceMount>
        <AnimatePresence>
          {open && <DialogBackdrop key="backdrop" />}
          {open && (
            <RadixDialog.Content key="content" forceMount asChild aria-describedby={undefined}>
              <motion.div
                {...floating}
                className="fixed left-1/2 top-[18vh] z-50 w-[calc(100%-48px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-card surface-float outline-none"
              >
                <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
                <Command loop label="Command palette">
                  <div className="flex h-14 items-center gap-3 border-b border-line px-5">
                    <Search size={16} className="shrink-0" aria-hidden />
                    <Command.Input
                      autoFocus
                      placeholder={placeholder}
                      className="h-full min-w-0 flex-1 bg-transparent text-body text-fg outline-none focus-visible:outline-none"
                    />
                  </div>
                  <Command.List className="max-h-[min(360px,50vh)] scroll-py-2 overflow-y-auto p-2">
                    <Command.Empty className="py-10 text-center text-small">
                      {emptyText}
                    </Command.Empty>
                    {children}
                  </Command.List>
                </Command>
              </motion.div>
            </RadixDialog.Content>
          )}
        </AnimatePresence>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface CommandGroupProps {
  heading: string;
  children: ReactNode;
}

export function CommandGroup({ heading, children }: CommandGroupProps) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:font-medium"
    >
      {children}
    </Command.Group>
  );
}

export interface CommandItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  /** A Shortcut shown on the right. */
  shortcut?: ReactNode;
  /** Extra words that should find this item. */
  keywords?: string[];
  /** Unique text cmdk filters on; defaults to the item's text content. */
  value?: string;
  children: ReactNode;
}

export function CommandItem({
  onSelect,
  icon,
  shortcut,
  keywords,
  value,
  children,
}: CommandItemProps) {
  return (
    <Command.Item
      onSelect={onSelect}
      keywords={keywords}
      value={value}
      className="flex h-10 select-none items-center gap-3 rounded-mark px-2.5 text-ui data-[selected=true]:bg-hover [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut}
    </Command.Item>
  );
}
