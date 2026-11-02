import type { TaskPlan } from '@architect/shared';
import { Button, cn } from '@architect/ui';
import { ChevronRight } from 'lucide-react';
import { SheetRow } from './SheetRow';
import { tasksText, totalOf } from './task-plan';

/** A line of a list on the page, set apart from the next by a hairline. */
const LINE = 'border-t border-line py-3 first:border-t-0 first:pt-0';

/**
 * What the agent will be asked, as rows of the page: each kind of task by its name, with one of
 * its requests and how many there are, and what the person answered while the job was drafted.
 * The rule behind each kind and more examples are a click away, in the inspector's Evaluation.
 */
export function TaskRows({ plan, onMore }: { plan: TaskPlan; onMore: () => void }) {
  const answers = plan.answers ?? [];
  return (
    <>
      {plan.types.length > 0 && (
        <SheetRow label="Tasks" region="Tasks" align="start">
          <div className="flex flex-col gap-1">
            <ul className="m-0 flex list-none flex-col p-0">
              {plan.types.map((type) => {
                const example = type.examples[0]?.request;
                return (
                  <li
                    key={type.id}
                    className={cn(LINE, 'flex items-baseline justify-between gap-4')}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span>{type.label}</span>
                      {example !== undefined && (
                        <span className="text-small text-pretty">{example}</span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums">{tasksText(totalOf(type.counts))}</span>
                  </li>
                );
              })}
            </ul>
            <Button variant="ghost" size="xs" className="-ml-3 self-start" onClick={onMore}>
              Examples and rules
              <ChevronRight size={13} strokeWidth={1.8} aria-hidden />
            </Button>
          </div>
        </SheetRow>
      )}
      {answers.length > 0 && (
        <SheetRow label="Your answers" region="Your answers" align="start">
          <dl className="m-0 flex flex-col">
            {answers.map((item) => (
              <div key={item.question} className={cn(LINE, 'flex flex-col gap-0.5')}>
                <dt className="text-small text-pretty">{item.question}</dt>
                <dd className="m-0 text-pretty">{item.answer.trim()}</dd>
              </div>
            ))}
          </dl>
        </SheetRow>
      )}
    </>
  );
}
