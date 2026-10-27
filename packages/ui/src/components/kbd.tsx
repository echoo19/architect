import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-control',
        'bg-field px-1.5 font-mono text-xs leading-none text-fg-secondary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Enter: '↩',
  Escape: 'Esc',
};

const OTHER_SYMBOLS: Record<string, string> = { Mod: 'Ctrl', Escape: 'Esc' };

const MAC_NAMES: Record<string, string> = { Mod: 'Command', Alt: 'Option' };
const OTHER_NAMES: Record<string, string> = { Mod: 'Ctrl' };

/** How a key is printed on this platform. `Mod` is Command on macOS and Ctrl elsewhere. */
export function shortcutLabel(key: string, mac: boolean): string {
  return (mac ? MAC_SYMBOLS[key] : OTHER_SYMBOLS[key]) ?? key;
}

function spokenName(key: string, mac: boolean): string {
  return (mac ? MAC_NAMES[key] : OTHER_NAMES[key]) ?? key;
}

export interface ShortcutProps {
  /** Key names such as `Mod`, `Shift`, `K`, `,`. */
  keys: readonly string[];
  /** Show macOS symbols instead of key names. */
  mac: boolean;
  className?: string;
}

export function Shortcut({ keys, mac, className }: ShortcutProps) {
  return (
    <span
      aria-label={keys.map((key) => spokenName(key, mac)).join('+')}
      className={cn('inline-flex shrink-0 items-center gap-1', className)}
    >
      {keys.map((key) => (
        <Kbd key={key}>{shortcutLabel(key, mac)}</Kbd>
      ))}
    </span>
  );
}
