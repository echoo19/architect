import type { ReactNode } from 'react';
import { cn } from '@architect/ui';

interface SheetRowProps {
  /** What the row is about, in the label column. */
  label: ReactNode;
  /** The field the label names, when the row holds one. */
  htmlFor?: string;
  /** Names the row as a region of the page, for the row that holds a setting of its own. */
  region?: string;
  /**
   * Where the label sits against the value: `center` for a row that holds a control, as tall as
   * the label's line is; `start` for a row of text, whose first line the label stands level with.
   */
  align?: 'center' | 'start';
  children: ReactNode;
  className?: string;
}

/**
 * One row of a page's settings: a label column and the value beside it, set apart from the next
 * row by a hairline. Every row of a page uses the same column, so the labels and the values line up
 * down the whole page. Below 720px the label sits over its value.
 */
export function SheetRow({
  label,
  htmlFor,
  region,
  align = 'center',
  children,
  className,
}: SheetRowProps) {
  const Tag = region === undefined ? 'div' : 'section';
  return (
    <Tag
      {...(region === undefined ? {} : { 'aria-label': region })}
      className={cn(
        'grid grid-cols-1 gap-x-8 gap-y-2 border-t border-line py-5 first:border-t-0',
        'min-[720px]:grid-cols-[168px_minmax(0,1fr)]',
        className,
      )}
    >
      <div
        className={cn(
          'flex text-ui font-medium',
          align === 'center' && 'min-h-10 items-center self-start',
        )}
      >
        {htmlFor === undefined ? label : <label htmlFor={htmlFor}>{label}</label>}
      </div>
      <div className="min-w-0">{children}</div>
    </Tag>
  );
}
