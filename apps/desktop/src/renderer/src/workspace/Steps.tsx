import { useId, useState } from 'react';
import type { AgentStep, WorkspaceMessage } from '@architect/shared';
import { cn, Spinner } from '@architect/ui';
import { ChevronRight } from 'lucide-react';
import { currentStep, stepCount, workedLabel } from './labels';

const NAME_TONE: Record<AgentStep['status'], string> = {
  done: 'text-fg',
  running: 'text-fg-secondary',
  error: 'text-danger',
};

export interface StepsProps {
  message: WorkspaceMessage;
  /** Whether the list starts open, from the "Tool steps" setting. */
  startOpen: boolean;
  /** The reply is held until the user answers a write it wants to make. */
  waiting: boolean;
}

/**
 * The tools and skills an agent used. While it works, the header names the current step;
 * afterwards it says how long the work took. The list opens as the "Tool steps" setting says.
 */
export function Steps({ message, startOpen, waiting }: StepsProps) {
  const listId = useId();
  const [choice, setChoice] = useState<boolean | null>(null);
  const working = message.status === 'streaming';
  const open = choice ?? startOpen;
  const step = working ? currentStep(message.steps) : undefined;

  // While a write waits for an answer, the line under the reply says so; this one just counts.
  let header = workedLabel(message);
  if (working && waiting) header = `${stepCount(message.steps.length)} so far`;
  else if (step) header = `${step.name} ${step.detail}`;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setChoice(!open)}
        className="flex h-7 max-w-full items-center gap-2 self-start rounded-xs text-base text-fg-secondary transition-colors duration-150 hover:text-fg"
      >
        {working && !waiting && <Spinner size={13} />}
        <span className="truncate">{header}</span>
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          aria-hidden
          className={cn('shrink-0 transition-transform duration-200', open && 'rotate-90')}
        />
      </button>
      {open && (
        <ol
          id={listId}
          aria-label="Steps"
          className="m-0 ml-1.5 flex list-none flex-col border-l border-line-control py-0 pl-4 pr-0 font-mono text-sm leading-normal"
        >
          {message.steps.map((item) => (
            <li
              key={item.id}
              className="flex animate-rise flex-wrap items-center gap-x-3.5 gap-y-1 py-[5px]"
            >
              <span className={NAME_TONE[item.status]}>{item.name}</span>
              <span className="text-fg-secondary">{item.detail}</span>
              {item.meta && (
                <span className={item.status === 'error' ? 'text-danger' : 'text-fg-muted'}>
                  {item.meta}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
