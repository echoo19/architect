import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Stagger, StaggerItem } from '../motion/reveal';

export interface CardProps {
  /** The card's name, set as its heading and its region's accessible name. */
  title: string;
  /** A 16px Lucide icon before the title. */
  icon?: ReactNode;
  /** One control at the right of the title row, such as an icon button or a small link button. */
  action?: ReactNode;
  /** Spans two columns of a CardGrid where there is room. */
  wide?: boolean;
  /** Rows go edge to edge, split by hairlines, instead of sitting in the card's padding. */
  flush?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A calm card: a flat fill with a hairline edge, a title row and its content. Rows inside are
 * split by hairlines (`CardRow`), never boxed again.
 */
export function Card({ title, icon, action, wide, flush, children, className }: CardProps) {
  // In a CardGrid the card takes its turn to rise in; on its own it simply rises in.
  return (
    <StaggerItem className={cn('flex min-w-0 flex-col', wide && 'lg:col-span-2')}>
      <section
        aria-label={title}
        className={cn('flex min-w-0 flex-1 flex-col rounded-card bg-card shadow-edge', className)}
      >
        <div className="flex min-h-14 items-center gap-2.5 pl-6 pr-4 pt-1">
          {icon && <span className="flex shrink-0 [&_svg]:size-4">{icon}</span>}
          <h2 className="m-0 min-w-0 flex-1 truncate font-display text-body font-semibold">
            {title}
          </h2>
          {action}
        </div>
        <div className={cn('flex min-h-0 flex-1 flex-col', !flush && 'px-6 pb-6')}>{children}</div>
      </section>
    </StaggerItem>
  );
}

export interface CardRowProps {
  /** A mark before the row's text, such as an icon tile or an avatar. */
  icon?: ReactNode;
  title: ReactNode;
  /** One short line under the title. */
  detail?: ReactNode;
  /** Right side: a figure, a status word or a small control. */
  end?: ReactNode;
  /** The whole row opens something. */
  onClick?: () => void;
  /** Accessible name for a clickable row whose visible text is not enough on its own. */
  label?: string;
  /** The row is the one chosen among its card's rows, such as the one whose detail shows beside. */
  selected?: boolean;
  className?: string;
}

/** A row inside a flush card, split from the one above by a hairline. */
export function CardRow({
  icon,
  title,
  detail,
  end,
  onClick,
  label,
  selected,
  className,
}: CardRowProps) {
  const body = (
    <>
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        {detail && <span className="truncate text-small">{detail}</span>}
      </span>
      {end && <span className="flex shrink-0 items-center gap-2 tabular-nums">{end}</span>}
    </>
  );
  const classes = cn(
    'flex min-h-14 w-full items-center gap-3 border-t border-line px-6 py-2.5 text-left text-ui',
    selected && 'bg-selected',
    className,
  );
  if (!onClick) return <div className={classes}>{body}</div>;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        classes,
        'transition-colors duration-150 hover:bg-hover focus-visible:bg-hover',
        'last:rounded-b-card',
      )}
    >
      {body}
    </button>
  );
}

export interface CardGridProps {
  children: ReactNode;
  className?: string;
}

/**
 * Cards in columns that fill the width: one column on a narrow window, two on a wide one, three
 * on a very wide one. The cards rise in one after another on first mount.
 */
export function CardGrid({ children, className }: CardGridProps) {
  return (
    <Stagger
      className={cn('grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3', className)}
    >
      {children}
    </Stagger>
  );
}
