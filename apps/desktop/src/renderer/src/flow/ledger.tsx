import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@architect/ui';

/*
 * The grammar of the flow's data screens: a title, then rows split by hairlines on the ground,
 * never a card for each list. Rows are 48 tall, numbers are tabular and sit on the right, and a
 * row that opens something highlights a little wider than its hairlines so its text stays aligned.
 */

export interface SectionProps {
  /** The section's title, which is also its accessible name. */
  title: string;
  /** The title's id, when something has to find the section by it. */
  id?: string;
  /** What goes with the title on the right: a count, a legend, a control. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A titled part of a screen. */
export function Section({ title, id, actions, className, children }: SectionProps) {
  const own = useId();
  const headingId = id ?? own;
  return (
    <section aria-labelledby={headingId} className={cn('flex min-w-0 flex-col', className)}>
      <header className="flex min-h-10 items-center justify-between gap-4 pb-3">
        <h2 id={headingId} className="m-0 font-display text-h2 font-semibold">
          {title}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Row({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('border-t border-line', className)} {...props} />;
}

/**
 * The line of a row that opens something. The highlight reaches 12px past the hairlines on each
 * side, so the text stays on the page's edge.
 */
export function RowButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'group -mx-3 grid w-[calc(100%+24px)] items-center gap-x-4 rounded-control px-3 text-left',
        'transition-colors duration-150 hover:bg-hover',
        className,
      )}
      {...props}
    />
  );
}

/** What a row opens, drawn only on hover or focus so a list of them stays quiet. */
export const ROW_CHEVRON =
  'text-fg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100';

/**
 * For a `Collapse` that holds rows: it reaches 16px past them on each side and 4px above and
 * below, so a highlight that reaches past the hairlines, and the focus ring, are not cut off.
 */
export const ROOMY = '-mx-4 -my-1 px-4 py-1';
