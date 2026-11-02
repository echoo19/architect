import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

export interface NavItemProps {
  /** A 16px Lucide icon or a spinner at the row's left; it names itself or is hidden. */
  icon?: ReactNode;
  children: ReactNode;
  /** At the row's right: a status word or a spinner. */
  end?: ReactNode;
  /** The row of the page on screen. */
  current?: boolean;
  /**
   * Rows that share this name slide one selected fill between them when the page changes, so
   * the eye follows the move. Without it the selected row simply takes the fill.
   */
  indicator?: string;
  /** Sits under a row with an icon, lined up with that row's text, as a chat under its agent. */
  nested?: boolean;
  onClick: () => void;
  className?: string;
}

/**
 * A row of the sidebar: a place, an agent's chat, a training run. 40px tall (36 nested), its
 * icon in a 16px box, hover a step lighter, the current row on the selected fill. A long name
 * wraps to a second line rather than being cut. On a row that isn't nested, a status word that
 * doesn't fit beside the name drops under it, so the name keeps its line.
 */
export function NavItem({
  icon,
  children,
  end,
  current = false,
  indicator,
  nested = false,
  onClick,
  className,
}: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'relative flex w-full min-w-0 shrink-0 items-center gap-2.5 rounded-control text-left',
        'transition-colors duration-150',
        nested ? 'min-h-9 py-1.5 pl-11 pr-2.5' : 'min-h-10 px-2.5 py-2',
        current ? !indicator && 'bg-selected' : 'hover:bg-hover',
        className,
      )}
    >
      {current && indicator && (
        <motion.span
          layoutId={indicator}
          transition={springs.settle}
          aria-hidden
          className="absolute inset-0 rounded-control bg-selected"
        />
      )}
      {icon && (
        <span className="relative flex min-w-4 shrink-0 items-center justify-center">{icon}</span>
      )}
      {end && !nested ? (
        <span className="relative flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2.5">
          <span className="line-clamp-2 min-w-0 break-words">{children}</span>
          <span className="flex shrink-0 items-center text-small">{end}</span>
        </span>
      ) : (
        <>
          <span className="relative line-clamp-2 min-w-0 flex-1 break-words">{children}</span>
          {end && <span className="relative flex shrink-0 items-center text-small">{end}</span>}
        </>
      )}
    </button>
  );
}
