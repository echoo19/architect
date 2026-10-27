import type { ReactNode } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';

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
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-backdrop data-[state=closed]:animate-fade-out data-[state=open]:animate-fade" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[18vh] z-50 w-[calc(100%-48px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-3xl border border-line-control bg-modal shadow-modal outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop"
        >
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
          <Command loop label="Command palette">
            <div className="flex h-14 items-center gap-3 border-b border-line-card px-[18px]">
              <Search size={16} className="shrink-0 text-fg-muted" aria-hidden />
              <Command.Input
                autoFocus
                placeholder={placeholder}
                className="h-full min-w-0 flex-1 bg-transparent text-md text-fg outline-none focus-visible:outline-none"
              />
            </div>
            <Command.List className="max-h-[min(360px,50vh)] scroll-py-2 overflow-y-auto p-2">
              <Command.Empty className="py-10 text-center text-sm text-fg-muted">
                {emptyText}
              </Command.Empty>
              {children}
            </Command.List>
          </Command>
        </RadixDialog.Content>
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
      className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-muted"
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
      className="flex h-10 select-none items-center gap-3 rounded-md px-2.5 text-base text-fg-soft data-[selected=true]:bg-hover data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-secondary"
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut}
    </Command.Item>
  );
}
