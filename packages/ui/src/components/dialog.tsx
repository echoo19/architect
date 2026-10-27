import type { ReactNode } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
import { cn } from '../lib/cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

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
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-backdrop data-[state=closed]:animate-fade-out data-[state=open]:animate-fade" />
      <RadixDialog.Content
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2',
          'overflow-hidden rounded-5xl border border-line-control bg-modal shadow-modal outline-none',
          'data-[state=closed]:animate-pop-out data-[state=open]:animate-pop',
          sizes[size],
          className,
        )}
      >
        <RadixDialog.Title
          className={hideTitle ? 'sr-only' : 'px-7 pt-6 text-xl font-medium tracking-tight'}
        >
          {title}
        </RadixDialog.Title>
        {description && (
          <RadixDialog.Description
            className={hideTitle ? 'sr-only' : 'px-7 pt-1.5 text-fg-secondary text-pretty'}
          >
            {description}
          </RadixDialog.Description>
        )}
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** Buttons along the bottom of a `md` dialog. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 px-7 pb-6 pt-6">{children}</div>;
}
