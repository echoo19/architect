import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as RadixDialog } from 'radix-ui';
import { cn } from '../lib/cn';
import { useOpenState } from '../lib/open-state';
import { useFloatingMotion } from '../motion/floating';
import { useEnterFrom } from '../motion/provider';
import { springs } from '../motion/springs';

const DialogOpen = createContext(false);

/** Whether the dialog or drawer around is open. Its content stays mounted while it leaves. */
export function useDialogOpen(): boolean {
  return useContext(DialogOpen);
}

/**
 * A dialog, or the drawer built on the same root. It tracks whether it is open itself, so the
 * content can finish leaving before it unmounts.
 */
export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof RadixDialog.Root>) {
  const [isOpen, setOpen] = useOpenState({ open, defaultOpen, onOpenChange });
  return (
    <DialogOpen.Provider value={isOpen}>
      <RadixDialog.Root {...props} open={isOpen} onOpenChange={setOpen}>
        {children}
      </RadixDialog.Root>
    </DialogOpen.Provider>
  );
}

export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/** The dimmed window behind a dialog, a drawer or the palette. */
export function DialogBackdrop() {
  const enter = useEnterFrom({ opacity: 0 });
  return (
    <RadixDialog.Overlay forceMount asChild>
      <motion.div
        initial={enter}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: springs.exit }}
        className="fixed inset-0 z-50 bg-backdrop"
      />
    </RadixDialog.Overlay>
  );
}

export interface DialogContentProps {
  /** Always required for assistive tech; hide it visually when the layout shows its own. */
  title: string;
  hideTitle?: boolean;
  description?: string;
  /** `md` for confirmations, `lg` for the settings layout. */
  size?: 'md' | 'lg';
  children: ReactNode;
  className?: string;
}

const sizes = {
  md: 'max-w-[480px]',
  lg: 'h-[min(600px,calc(100vh-48px))] max-w-[800px]',
} as const;

export function DialogContent({
  title,
  hideTitle = false,
  description,
  size = 'md',
  children,
  className,
}: DialogContentProps) {
  const open = useDialogOpen();
  const floating = useFloatingMotion();
  return (
    <RadixDialog.Portal forceMount>
      <AnimatePresence>
        {open && <DialogBackdrop key="backdrop" />}
        {open && (
          <RadixDialog.Content
            key="content"
            forceMount
            asChild
            {...(description ? {} : { 'aria-describedby': undefined })}
          >
            <motion.div
              {...floating}
              className={cn(
                'fixed left-1/2 top-1/2 z-50 w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2',
                'overflow-hidden rounded-card bg-raised shadow-float outline-none',
                sizes[size],
                className,
              )}
            >
              <RadixDialog.Title
                className={hideTitle ? 'sr-only' : 'px-6 pt-6 font-display text-h2 font-semibold'}
              >
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description
                  className={hideTitle ? 'sr-only' : 'px-6 pt-2 text-ui text-pretty'}
                >
                  {description}
                </RadixDialog.Description>
              )}
              {children}
            </motion.div>
          </RadixDialog.Content>
        )}
      </AnimatePresence>
    </RadixDialog.Portal>
  );
}

/** Buttons along the bottom of a `md` dialog. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 px-6 pb-6 pt-6">{children}</div>;
}
