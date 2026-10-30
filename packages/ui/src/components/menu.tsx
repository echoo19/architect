import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DropdownMenu as RadixMenu, Popover as RadixPopover } from 'radix-ui';
import { cn } from '../lib/cn';
import { useOpenState } from '../lib/open-state';
import { FLOAT_SCALE, springs } from '../motion/springs';

const MenuOpen = createContext(false);
const PopoverOpen = createContext(false);

/** What a menu or popover does as it opens and closes: scale from 0.97 and fade, leaving faster. */
export function floatingMenuMotion(origin: string) {
  return {
    initial: { opacity: 0, scale: FLOAT_SCALE },
    animate: { opacity: 1, scale: 1, transition: springs.smooth },
    exit: { opacity: 0, scale: FLOAT_SCALE, transition: springs.exit },
    style: { transformOrigin: origin },
  } as const;
}

const surface = 'z-50 bg-raised shadow-float';

export function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof RadixMenu.Root>) {
  const [isOpen, setOpen] = useOpenState({ open, defaultOpen, onOpenChange });
  return (
    <MenuOpen.Provider value={isOpen}>
      <RadixMenu.Root {...props} open={isOpen} onOpenChange={setOpen}>
        {children}
      </RadixMenu.Root>
    </MenuOpen.Provider>
  );
}

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
  const open = useContext(MenuOpen);
  return (
    <RadixMenu.Portal forceMount>
      <AnimatePresence>
        {open && (
          <RadixMenu.Content
            key="content"
            forceMount
            asChild
            align={align}
            side={side}
            sideOffset={6}
          >
            <motion.div
              {...floatingMenuMotion('var(--radix-dropdown-menu-content-transform-origin)')}
              className={cn(surface, 'min-w-48 rounded-control p-1', className)}
            >
              {children}
            </motion.div>
          </RadixMenu.Content>
        )}
      </AnimatePresence>
    </RadixMenu.Portal>
  );
}

export interface DropdownMenuItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  /** One line under the label saying what the choice does. */
  description?: ReactNode;
  /** Keyboard hint or mark on the right, e.g. a Shortcut, or a check on the current choice. */
  shortcut?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  children: ReactNode;
}

export function DropdownMenuItem({
  onSelect,
  icon,
  description,
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
        'flex min-h-9 select-none items-center gap-2.5 rounded-mark px-2.5 text-ui outline-none',
        'data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:shrink-0',
        tone === 'danger' ? 'text-danger' : 'text-fg',
        description && 'items-start py-2 [&>svg]:mt-0.5',
      )}
    >
      {icon}
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{children}</span>
          <span className="text-small text-pretty">{description}</span>
        </span>
      ) : (
        <span className="flex-1 truncate">{children}</span>
      )}
      {shortcut}
    </RadixMenu.Item>
  );
}

export function DropdownMenuSeparator() {
  return <RadixMenu.Separator className="mx-1 my-1 h-px bg-line" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <RadixMenu.Label className="px-2.5 pb-1 pt-2 text-small font-medium">
      {children}
    </RadixMenu.Label>
  );
}

export function Popover({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof RadixPopover.Root>) {
  const [isOpen, setOpen] = useOpenState({ open, defaultOpen, onOpenChange });
  return (
    <PopoverOpen.Provider value={isOpen}>
      <RadixPopover.Root {...props} open={isOpen} onOpenChange={setOpen}>
        {children}
      </RadixPopover.Root>
    </PopoverOpen.Provider>
  );
}

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
  const open = useContext(PopoverOpen);
  return (
    <RadixPopover.Portal forceMount>
      <AnimatePresence>
        {open && (
          <RadixPopover.Content
            key="content"
            forceMount
            asChild
            align={align}
            side={side}
            sideOffset={8}
            {...aria}
          >
            <motion.div
              {...floatingMenuMotion('var(--radix-popover-content-transform-origin)')}
              className={cn(surface, 'w-72 rounded-card p-4 outline-none', className)}
            >
              {children}
            </motion.div>
          </RadixPopover.Content>
        )}
      </AnimatePresence>
    </RadixPopover.Portal>
  );
}
