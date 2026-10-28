import { useId, useState } from 'react';
import { cn } from '@architect/ui';
import { ChevronRight } from 'lucide-react';

export interface CodeViewProps {
  code: string;
  /** What the code printed and gave back, or the error it stopped on. */
  output: string;
  /** The output is an error. */
  failed?: boolean;
  className?: string;
}

/**
 * Code the agent ran, folded to its first line until it is opened, with what the code gave back
 * under it.
 */
export function CodeView({ code, output, failed = false, className }: CodeViewProps) {
  const rest = useId();
  const [open, setOpen] = useState(false);
  const [first = '', ...more] = code.trim().split('\n');
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-lg bg-well font-mono text-xs leading-5',
        className,
      )}
    >
      <button
        type="button"
        aria-label="Code"
        aria-expanded={open}
        aria-controls={rest}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-start gap-2 px-3 pt-2 text-left text-fg-secondary transition-colors duration-150 hover:text-fg"
      >
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          aria-hidden
          className={cn('mt-[3px] shrink-0 transition-transform duration-200', open && 'rotate-90')}
        />
        <span className={cn('min-w-0', open ? 'whitespace-pre-wrap break-words' : 'truncate')}>
          {first}
          {!open && more.length > 0 && ' …'}
        </span>
      </button>
      <pre
        id={rest}
        hidden={!open || more.length === 0}
        className="m-0 whitespace-pre-wrap break-words pl-[33px] pr-3 text-fg-secondary"
      >
        {more.join('\n')}
      </pre>
      <pre
        className={cn(
          'm-0 mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-line-card px-3 py-2',
          failed ? 'text-danger' : 'text-fg',
        )}
      >
        {output}
      </pre>
    </div>
  );
}
