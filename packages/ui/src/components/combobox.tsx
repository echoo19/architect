import { useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover as RadixPopover } from 'radix-ui';
import { cn } from '../lib/cn';

export interface ComboboxOption {
  /** Unique within the menu. */
  value: string;
  label: string;
  /** Quiet text on the right, such as a price or a size. */
  detail?: ReactNode;
  /** More words that should find it, such as the model id. */
  keywords?: string[];
}

export interface ComboboxGroup {
  heading: string;
  options: readonly ComboboxOption[];
  /** Shown under the heading instead of options while they load, or why they couldn't. */
  note?: ReactNode;
}

export interface ComboboxProps {
  'aria-label': string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  groups: readonly ComboboxGroup[];
  /** Choices made from what was typed, such as "Use this model id". They show while there is text. */
  fromSearch?: (text: string) => ComboboxGroup | null;
  /** Called when the menu opens or closes; a menu can load its lists on opening. */
  onOpenChange?: (open: boolean) => void;
  /** Whether the menu is open, when something other than its own button opens it. */
  open?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** What the closed control shows: the current choice. */
  children: ReactNode;
}

const heading =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 ' +
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-muted';

/**
 * A choice from many, grouped and searchable: the closed control shows the current choice, and
 * the menu filters as you type. Arrow keys, Enter and Escape come from cmdk.
 */
export function Combobox({
  value,
  onValueChange,
  groups,
  fromSearch,
  onOpenChange,
  open: controlled,
  searchPlaceholder = 'Search',
  emptyText = 'Nothing matches that.',
  disabled,
  className,
  children,
  ...props
}: ComboboxProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ?? ownOpen;
  const [search, setSearch] = useState('');
  const typed = search.trim();
  const extra = typed && fromSearch ? fromSearch(typed) : null;

  const changeOpen = (next: boolean) => {
    setOwnOpen(next);
    if (!next) setSearch('');
    onOpenChange?.(next);
  };
  const choose = (next: string) => {
    onValueChange(next);
    changeOpen(false);
  };

  const item = (option: ComboboxOption, forceMount = false) => (
    <Command.Item
      key={option.value}
      value={option.value}
      keywords={[option.label, ...(option.keywords ?? [])]}
      forceMount={forceMount}
      onSelect={() => choose(option.value)}
      className="flex min-h-9 select-none items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-base text-fg-soft outline-none data-[selected=true]:bg-hover data-[selected=true]:text-fg"
    >
      <Check
        size={14}
        strokeWidth={2.2}
        aria-hidden
        className={cn('shrink-0', option.value === value ? 'text-fg' : 'invisible')}
      />
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {option.detail && (
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-fg-muted">
          {option.detail}
        </span>
      )}
    </Command.Item>
  );

  return (
    <RadixPopover.Root open={open} onOpenChange={changeOpen}>
      <RadixPopover.Trigger asChild>
        <button
          type="button"
          aria-label={props['aria-label']}
          disabled={disabled}
          className={cn(
            'inline-flex h-[38px] min-w-56 max-w-full items-center justify-between gap-2 rounded-md border',
            'border-line-control bg-well pl-3 pr-2.5 text-left text-base text-fg transition-colors duration-150',
            'hover:border-line-strong disabled:opacity-40',
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">{children}</span>
          <ChevronDown size={16} className="shrink-0 text-fg-muted" aria-hidden />
        </button>
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 w-[min(440px,calc(100vw-48px))] overflow-hidden rounded-xl border border-line-control bg-modal shadow-popover outline-none data-[state=closed]:animate-fade-out data-[state=open]:animate-pop"
        >
          <Command loop label={props['aria-label']}>
            <div className="flex h-11 items-center gap-2.5 border-b border-line-card px-3.5">
              <Search size={15} className="shrink-0 text-fg-muted" aria-hidden />
              <Command.Input
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder={searchPlaceholder}
                className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none focus-visible:outline-none"
              />
            </div>
            <Command.List className="max-h-[min(380px,50vh)] scroll-py-1 overflow-y-auto p-1">
              <Command.Empty className="py-8 text-center text-sm text-fg-muted">
                {emptyText}
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group.heading} heading={group.heading} className={heading}>
                  {group.note && (
                    <div className="px-2.5 pb-2 pt-0.5 text-sm text-fg-muted">{group.note}</div>
                  )}
                  {group.options.map((option) => item(option))}
                </Command.Group>
              ))}
              {extra && extra.options.length > 0 && (
                <Command.Group heading={extra.heading} forceMount className={heading}>
                  {extra.options.map((option) => item(option, true))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
