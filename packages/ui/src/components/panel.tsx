import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PanelProps extends ComponentProps<'section'> {
  /** Adds the standard inner padding and spacing for panels without row lists. */
  padded?: boolean;
}

/** A rounded section on the flow screens, such as "Current round" or "Rounds". */
export function Panel({ padded = false, className, children, ...props }: PanelProps) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-6xl border border-line-card bg-panel',
        padded && 'gap-[22px] p-7',
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

export function PanelHeader({ title, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn('flex min-h-[60px] items-center justify-between gap-3 px-7', className)}>
      <h2 className="text-md font-medium">{title}</h2>
      {actions}
    </div>
  );
}

/** A list row inside a panel. Set the grid columns with `className`. */
export function PanelRow({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'grid min-h-[54px] items-center gap-3.5 border-t border-line-row px-7',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** The darker strip along a panel's bottom edge. */
export function PanelFooter({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-3.5 border-t border-line-row-strong bg-aside px-7',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type HeadingSize = 'hero' | 'display-lg' | 'display' | 'display-sm' | 'title' | 'section';

const headingSize: Record<HeadingSize, string> = {
  hero: 'text-hero-lg tracking-tightest',
  'display-lg': 'text-display-lg tracking-tightest',
  display: 'text-display tracking-tighter',
  'display-sm': 'text-display-sm tracking-tighter',
  title: 'text-xl tracking-tight',
  section: 'text-md',
};

export interface HeadingProps extends ComponentProps<'h1'> {
  as?: 'h1' | 'h2' | 'h3';
  size?: HeadingSize;
}

export function Heading({ as: Tag = 'h2', size = 'section', className, ...props }: HeadingProps) {
  return (
    <Tag className={cn('m-0 font-medium text-balance', headingSize[size], className)} {...props} />
  );
}
