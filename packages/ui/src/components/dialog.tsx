import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog as RadixDialog } from 'radix-ui';
import { cn } from '../lib/cn';
import { useOpenState } from '../lib/open-state';
import { useFloatingMotion } from '../motion/floating';
import { useEnterFrom } from '../motion/provider';
import { springs } from '../motion/springs';

const DialogOpen = createContext(false);

/**
 * What a dialog was opened from: the control that had focus, and the middle of it on screen,
 * which the dialog grows from.
 */
interface Opened {
  opener: HTMLElement | null;
  origin: { x: number; y: number } | null;
}
const DialogOpened = createContext<Opened>({ opener: null, origin: null });

function openedFrom(element: Element | null): Opened {
  if (!(element instanceof HTMLElement) || element === document.body) {
    return { opener: null, origin: null };
  }
  const rect = element.getBoundingClientRect();
  const origin =
    rect.width === 0 && rect.height === 0
      ? null
      : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return { opener: element, origin };
}

/**
 * Noted as the dialog renders open, before anything inside it mounts and takes focus (such as a
 * field with `autoFocus`), so it is the control that opened it: a trigger, a button or a row.
 */
function useOpenedFrom(open: boolean): Opened {
  const note = (now: boolean): Opened =>
    now && typeof document !== 'undefined'
      ? openedFrom(document.activeElement)
      : { opener: null, origin: null };
  // A dialog can mount already open, such as one keyed to start afresh each time it opens.
  const [state, setState] = useState(() => ({ open, opened: note(open) }));
  if (state.open !== open) setState({ open, opened: note(open) });
  return state.opened;
}

/** The control the dialog or drawer around was opened from, to give focus back to. */
export function useDialogOpener(): HTMLElement | null {
  return useContext(DialogOpened).opener;
}

/**
 * Where focus goes as a dialog or drawer closes: back to what had it when it opened or, when that
 * is gone (such as a menu item that opened it), to the page's main region, never to nothing.
 */
export function returnFocus(opener: HTMLElement | null): void {
  opener?.focus();
  if (opener && document.activeElement === opener) return;
  document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
}

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
  const opened = useOpenedFrom(isOpen);
  return (
    <DialogOpen.Provider value={isOpen}>
      <DialogOpened.Provider value={opened}>
        <RadixDialog.Root {...props} open={isOpen} onOpenChange={setOpen}>
          {children}
        </RadixDialog.Root>
      </DialogOpened.Provider>
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
  md: 'max-h-[calc(100vh-48px)] max-w-[480px]',
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
  const { opener, origin } = useContext(DialogOpened);
  const floating = useFloatingMotion();
  const content = useRef<HTMLDivElement>(null);
  // Once the body scrolls under the title, a hairline divides them.
  const [scrolled, setScrolled] = useState(false);
  // Grows from the control that opened it: its scale is centred on that point, so the few
  // pixels it travels as it grows lead from there. Set before the first frame is drawn.
  useLayoutEffect(() => {
    const element = content.current;
    if (!open || !element || !origin) return;
    const box = element.getBoundingClientRect();
    const x = Math.round(origin.x - box.left);
    const y = Math.round(origin.y - box.top);
    element.style.transformOrigin = `${x}px ${y}px`;
  }, [open, origin]);
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
            // Opened from a menu or a shortcut there may be no opener to go back to; see
            // `returnFocus`.
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus(opener);
            }}
          >
            <motion.div
              ref={content}
              {...floating}
              className={cn(
                'fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-48px)] -translate-x-1/2 -translate-y-1/2',
                'flex-col overflow-hidden rounded-card surface-float outline-none',
                sizes[size],
                className,
              )}
            >
              <RadixDialog.Title
                className={
                  hideTitle ? 'sr-only' : 'shrink-0 px-6 pt-6 font-display text-h2 font-semibold'
                }
              >
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description
                  className={hideTitle ? 'sr-only' : 'shrink-0 px-6 pt-2 text-ui text-pretty'}
                >
                  {description}
                </RadixDialog.Description>
              )}
              {/* On a short window the body scrolls under the title, so nothing falls off screen. */}
              <div className="relative flex min-h-0 flex-1 flex-col">
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-line',
                    'transition-opacity duration-150',
                    scrolled ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <div
                  onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-quiet"
                >
                  {children}
                </div>
              </div>
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
