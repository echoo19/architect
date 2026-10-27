import { useSyncExternalStore } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { Toast as RadixToast } from 'radix-ui';
import { cn } from '../lib/cn';
import { Button } from './button';
import { IconButton } from './icon-button';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: 'default' | 'danger';
  action?: { label: string; onClick: () => void };
}

interface ToastEntry extends ToastOptions {
  id: number;
  open: boolean;
}

/** Exit animation length; the entry is dropped once it has played. */
const EXIT_MS = 200;

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
  publish([...entries, { ...options, id: nextId++, open: true }]);
}

function dismiss(id: number) {
  publish(entries.map((entry) => (entry.id === id ? { ...entry, open: false } : entry)));
  setTimeout(() => publish(entries.filter((entry) => entry.id !== id)), EXIT_MS);
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => entries);
  return (
    <RadixToast.Provider swipeDirection="right" duration={6000}>
      {list.map((entry) => (
        <RadixToast.Root
          key={entry.id}
          open={entry.open}
          onOpenChange={(open) => {
            if (!open) dismiss(entry.id);
          }}
          className={cn(
            'flex items-start gap-3 rounded-2xl border border-line-control bg-card-raised py-3.5 pl-4 pr-2.5',
            'shadow-composer-sm data-[state=closed]:animate-fade-out data-[state=open]:animate-rise',
            'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
          )}
        >
          {entry.tone === 'danger' && (
            <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <RadixToast.Title className="font-medium">{entry.title}</RadixToast.Title>
            {entry.description && (
              <RadixToast.Description className="text-sm text-fg-secondary text-pretty">
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
            <IconButton label="Dismiss" size="xs" className="-my-1">
              <X size={14} strokeWidth={1.8} aria-hidden />
            </IconButton>
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2 outline-none" />
    </RadixToast.Provider>
  );
}
