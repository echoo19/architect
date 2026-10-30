import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { cn } from '../lib/cn';
import { useFloatingMotion } from '../motion/floating';
import { Dialog, DialogBackdrop, useDialogOpen } from './dialog';
import { IconButton } from './icon-button';

export const Drawer = Dialog;

export interface DrawerContentProps {
  /** Read out when the drawer opens; shown in the header, wrapped when long. */
  title: string;
  /** A short line under the title, such as the task type and split. */
  subtitle?: ReactNode;
  /** Controls in the header, left of the close button. */
  actions?: ReactNode;
  /** When one drawer leads to another, the way back to the one before, left of the title. */
  onBack?: () => void;
  /** A bar pinned along the bottom, such as a form's buttons, so it stays in view. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A panel that slides over the right side of the window for detail, such as an attempt's trace.
 * Escape and the close button dismiss it, and focus returns to what opened it.
 */
export function DrawerContent({
  title,
  subtitle,
  actions,
  onBack,
  footer,
  children,
  className,
}: DrawerContentProps) {
  const open = useDialogOpen();
  const floating = useFloatingMotion({ origin: 'right center' });
  // Drawers open from rows rather than a DialogTrigger, so remember where focus came from.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Portal forceMount>
      <AnimatePresence>
        {open && <DialogBackdrop key="backdrop" />}
        {open && (
          <RadixDialog.Content
            key="content"
            forceMount
            asChild
            aria-describedby={undefined}
            onOpenAutoFocus={() => {
              opener.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              opener.current?.focus();
            }}
          >
            <motion.div
              {...floating}
              className={cn(
                'fixed bottom-3 right-3 top-3 z-50 flex w-[min(600px,calc(100vw-24px))] flex-col',
                'overflow-hidden rounded-card bg-raised shadow-float outline-none',
                className,
              )}
            >
              <div
                className={cn(
                  'flex min-h-16 shrink-0 items-start gap-3 border-b border-line py-3 pr-3',
                  onBack ? 'pl-3' : 'pl-6',
                )}
              >
                {onBack && (
                  <IconButton label="Back" onClick={onBack}>
                    <ArrowLeft size={16} strokeWidth={1.8} aria-hidden />
                  </IconButton>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
                  {/* Three lines at most: a long title, such as a task's whole request, keeps the
                      drawer's body in view. Its full text is still the dialog's accessible name. */}
                  <RadixDialog.Title className="m-0 line-clamp-3 break-words font-display text-body font-semibold text-pretty">
                    {title}
                  </RadixDialog.Title>
                  {subtitle && <span className="text-small text-pretty">{subtitle}</span>}
                </div>
                {actions}
                <RadixDialog.Close asChild>
                  <IconButton label="Close">
                    <X size={16} strokeWidth={1.8} aria-hidden />
                  </IconButton>
                </RadixDialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6">{children}</div>
              {footer && (
                <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-3 border-t border-line px-6 py-4">
                  {footer}
                </div>
              )}
            </motion.div>
          </RadixDialog.Content>
        )}
      </AnimatePresence>
    </RadixDialog.Portal>
  );
}

export interface DrawerSectionProps {
  title: string;
  /** `mentor` sets the title in the mentor's color, for what the mentor wrote. */
  tone?: 'default' | 'mentor';
  /** Controls at the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** One titled part of a drawer, such as "Spark's diagnosis" or "Files changed". */
export function DrawerSection({
  title,
  tone = 'default',
  actions,
  children,
  className,
}: DrawerSectionProps) {
  return (
    <section aria-label={title} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className={cn('m-0 text-small font-medium', tone === 'mentor' && 'text-mentor')}>
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
