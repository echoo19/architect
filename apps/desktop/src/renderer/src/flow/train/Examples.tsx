import type { Job } from '@architect/shared';
import { Panel, PanelHeader, PanelRow } from '@architect/ui';
import { Check, ChevronRight, EyeOff, X } from 'lucide-react';
import { typeLabel } from '../names';
import type { RecentAttempt } from './run-state';

/** How many of the latest attempts show. */
const SHOWN = 5;

/** The student's latest attempts, newest first. A row opens its trace. */
export function Examples({
  job,
  attempts,
  mentor,
  onOpen,
}: {
  job: Job;
  attempts: readonly RecentAttempt[];
  mentor: string;
  onOpen: (attempt: RecentAttempt) => void;
}) {
  const shown = attempts.slice(0, SHOWN);
  return (
    <Panel aria-label="Latest attempts" className="min-w-0 flex-[7_1_560px]">
      <PanelHeader title="Latest attempts" />
      {shown.length === 0 ? (
        <PanelRow className="text-fg-muted">No attempts yet</PanelRow>
      ) : (
        <div className="overflow-x-auto">
          <ul className="m-0 min-w-[680px] list-none p-0">
            {shown.map((attempt) => (
              <li key={attempt.id}>
                <ExampleRow
                  attempt={attempt}
                  type={typeLabel(job, attempt.taskType)}
                  mentor={mentor}
                  onOpen={() => onOpen(attempt)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function ExampleRow({
  attempt,
  type,
  mentor,
  onOpen,
}: {
  attempt: RecentAttempt;
  type: string;
  mentor: string;
  onOpen: () => void;
}) {
  const passed = attempt.check.pass;
  const check = attempt.split === 'dev';
  const kind = check ? 'Check task' : 'Practice task';
  const set = attempt.round ? `${kind}, round ${attempt.round}` : kind;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid min-h-[54px] w-full grid-cols-[20px_minmax(0,1fr)_230px_150px_14px] items-center gap-x-4 border-t border-line-row px-7 py-2 text-left font-mono text-sm transition-colors duration-150 hover:bg-row-hover"
    >
      {passed ? (
        <Check
          size={15}
          strokeWidth={2.2}
          className="text-student"
          role="img"
          aria-label="Passed"
        />
      ) : (
        <X size={15} strokeWidth={2.2} className="text-fg-faint" role="img" aria-label="Failed" />
      )}
      <span className={passed ? 'truncate text-fg-soft' : 'truncate text-fg-muted'}>
        {attempt.prompt ?? attempt.taskId}
      </span>
      <Answer attempt={attempt} />
      <span className="flex min-w-0 flex-col font-sans">
        <span className="truncate text-fg-secondary">{type}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
          <span className="truncate">{set}</span>
          {check && (
            <EyeOff
              size={12}
              strokeWidth={1.8}
              className="shrink-0"
              role="img"
              aria-label={`Hidden from ${mentor}`}
            />
          )}
        </span>
      </span>
      <ChevronRight
        size={14}
        strokeWidth={1.8}
        aria-hidden
        className="text-fg-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}

/** A right answer as given; a wrong one struck through, with the expected one under it. */
function Answer({ attempt }: { attempt: RecentAttempt }) {
  const { answerSummary, expectedSummary, check } = attempt;
  if (check.pass) return <span className="truncate text-fg">{answerSummary ?? 'Passed'}</span>;
  if (!answerSummary) return <span className="truncate text-fg-muted">{check.reason}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg-muted line-through decoration-fg-faint">
        {answerSummary}
      </span>
      {expectedSummary && (
        <span className="truncate text-fg-secondary">
          <span className="font-sans text-fg-muted">Expected </span>
          {expectedSummary}
        </span>
      )}
    </span>
  );
}
