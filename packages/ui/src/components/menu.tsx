import type { ReactNode } from 'react';
import { DropdownMenu as RadixMenu, Popover as RadixPopover } from 'radix-ui';
import { cn } from '../lib/cn';

const surface =
  'z-50 rounded-xl border border-line-control bg-modal shadow-popover ' +
  'data-[state=closed]:animate-fade-out data-[state=open]:animate-pop';

export const DropdownMenu = RadixMenu.Root;
export const DropdownMenuTrigger = RadixMenu.Trigger;

export interface DropdownMenuContentProps {
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
  className?: string;
}

export function DropdownMenuContent({
  align = 'start',
  side = 'bottom',
  children,
  className,
}: DropdownMenuContentProps) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        side={side}
        sideOffset={6}
        className={cn(surface, 'min-w-48 p-1', className)}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export interface DropdownMenuItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  /** Keyboard hint on the right, e.g. a Shortcut. */
  shortcut?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  children: ReactNode;
}

export function DropdownMenuItem({
  onSelect,
  icon,
  shortcut,
  tone = 'default',
  disabled,
  children,
}: DropdownMenuItemProps) {
  return (
    <RadixMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex h-[34px] select-none items-center gap-2.5 rounded-sm px-2.5 text-base outline-none',
        'data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:shrink-0',
        tone === 'danger' ? 'text-danger' : 'text-fg [&_svg]:text-fg-secondary',
      )}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut}
    </RadixMenu.Item>
  );
}

export function DropdownMenuSeparator() {
  return <RadixMenu.Separator className="mx-1 my-1 h-px bg-line" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Label className="px-2.5 pb-1 pt-2 text-xs text-fg-muted">{children}</RadixMenu.Label>
  );
}

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverClose = RadixPopover.Close;

export interface PopoverContentProps {
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Required when the popover holds a form or a list; read out on open. */
  'aria-label'?: string;
  children: ReactNode;
  className?: string;
}

export function PopoverContent({
  align = 'center',
  side = 'bottom',
  children,
  className,
  ...aria
}: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        side={side}
        sideOffset={8}
        {...aria}
        className={cn(surface, 'w-72 rounded-2xl p-4 outline-none', className)}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
