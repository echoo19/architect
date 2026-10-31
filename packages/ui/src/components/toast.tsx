import { useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, X } from 'lucide-react';
import { Toast as RadixToast } from 'radix-ui';
import { useFloatingMotion } from '../motion/floating';
import { useEnterFrom } from '../motion/provider';
import { FLOAT_SCALE } from '../motion/springs';
import { Button } from './button';
import { IconButton } from './icon-button';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: 'default' | 'danger';
  action?: { label: string; onClick: () => void };
  /**
   * A toast that stands for the latest of a kind, such as the last change with its Undo: a new
   * one with the same key takes the place of the one showing, so they never pile up.
   */
  key?: string;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

let entries: ToastEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: ToastEntry[]) {
  entries = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows a toast from anywhere. Needs a `<Toaster />` mounted once. */
export function toast(options: ToastOptions): void {
  const kept =
    options.key === undefined ? entries : entries.filter((entry) => entry.key !== options.key);
  publish([...kept, { ...options, id: nextId++ }]);
}

function dismiss(id: number) {
  publish(entries.filter((entry) => entry.id !== id));
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => entries);
  const floating = useFloatingMotion();
  // A toast also rises a little as it comes in.
  const enter = useEnterFrom({ opacity: 0, scale: FLOAT_SCALE, y: 12 });
  return (
    <RadixToast.Provider swipeDirection="right" duration={6000}>
      <AnimatePresence>
        {list.map((entry) => (
          <RadixToast.Root
            key={entry.id}
            forceMount
            asChild
            onOpenChange={(open) => {
              if (!open) dismiss(entry.id);
            }}
          >
            <motion.li
              layout
              initial={enter}
              animate={{ ...floating.animate, y: 0 }}
              exit={floating.exit}
              className="flex items-start gap-3 rounded-card surface-float py-4 pl-5 pr-3 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]"
            >
              {entry.tone === 'danger' && (
                <CircleAlert size={16} className="mt-1 shrink-0 text-danger" aria-hidden />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <RadixToast.Title className="text-ui font-medium">{entry.title}</RadixToast.Title>
                {entry.description && (
                  <RadixToast.Description className="text-small text-pretty">
                    {entry.description}
                  </RadixToast.Description>
                )}
              </div>
              {entry.action && (
                <RadixToast.Action altText={entry.action.label} asChild>
                  <Button size="sm" onClick={entry.action.onClick}>
                    {entry.action.label}
                  </Button>
                </RadixToast.Action>
              )}
              <RadixToast.Close asChild>
                <IconButton label="Dismiss" size="xs" className="-my-0.5">
                  <X size={14} strokeWidth={1.8} aria-hidden />
                </IconButton>
              </RadixToast.Close>
            </motion.li>
          </RadixToast.Root>
        ))}
      </AnimatePresence>
      {/* Over a pinned action bar (a page's <footer>), toasts sit above it, clear of its buttons. */}
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-[60] [body:has(footer)_&]:bottom-24 flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  );
}
