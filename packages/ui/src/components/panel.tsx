import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PanelProps extends ComponentProps<'section'> {
  /** Adds the standard inner padding and spacing for panels without row lists. */
  padded?: boolean;
}

/** A card on the flow screens, such as "Current round" or "Rounds". */
export function Panel({ padded = false, className, children, ...props }: PanelProps) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-card bg-card shadow-edge',
        padded && 'gap-6 p-6',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export interface PanelHeaderProps {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** A panel's title row, set like a card's: 15px Inter Tight, 56px tall. */
export function PanelHeader({ title, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn('flex min-h-14 items-center justify-between gap-3 px-6', className)}>
      <h2 className="m-0 font-display text-body font-semibold">{title}</h2>
      {actions}
    </div>
  );
}

/** A list row inside a panel. Set the grid columns with `className`. */
export function PanelRow({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid min-h-12 items-center gap-3.5 border-t border-line px-6', className)}
      {...props}
    >
      {children}
    </div>
  );
}

/** The strip along a panel's bottom edge, set off by a hairline. */
export function PanelFooter({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-h-14 items-center gap-3.5 border-t border-line px-6', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export type HeadingSize = 'hero' | 'display-lg' | 'display' | 'display-sm' | 'title' | 'section';

const headingSize: Record<HeadingSize, string> = {
  hero: 'text-hero',
  'display-lg': 'text-title',
  display: 'text-title',
  'display-sm': 'text-h1',
  title: 'text-h2',
  section: 'text-body',
};

export interface HeadingProps extends ComponentProps<'h1'> {
  as?: 'h1' | 'h2' | 'h3';
  size?: HeadingSize;
}

export function Heading({ as: Tag = 'h2', size = 'section', className, ...props }: HeadingProps) {
  return (
    <Tag
      className={cn('m-0 font-display font-semibold text-balance', headingSize[size], className)}
      {...props}
    />
  );
}
