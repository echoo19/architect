import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface TableCardProps extends ComponentProps<'table'> {
  /** A full-width row inside the frame, under the table, such as a "Show all 12" button. */
  footer?: ReactNode;
}

/**
 * The bordered table from chat, like `Table` with the `card` variant, plus room for a footer
 * inside the same frame. Wide tables scroll sideways instead of squeezing their columns.
 */
export function TableCard({ footer, className, children, ...props }: TableCardProps) {
  return (
    <div className="min-w-0 overflow-hidden rounded-control shadow-edge">
      <div className="overflow-x-auto">
        <table
          data-variant="card"
          className={cn('group/table w-full border-collapse text-ui tabular-nums', className)}
          {...props}
        >
          {children}
        </table>
      </div>
      {footer}
    </div>
  );
}
