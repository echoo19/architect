import type { Job } from '@architect/shared';
import { EvidenceMark, Panel, PanelHeader, PanelRow } from '@architect/ui';
import { Check, ChevronRight, X } from 'lucide-react';
import { typeLabel } from '../names';
import type { RecentAttempt } from './run-state';

/** How many of the latest attempts show. */
const SHOWN = 5;

/** The student's latest attempts, newest first. A row opens its trace. */
export function LatestAttempts({
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
                <AttemptRow
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

function AttemptRow({
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
      className="group grid min-h-[54px] w-full grid-cols-[20px_minmax(0,1fr)_280px_170px_14px] items-center gap-x-4 border-t border-line-row px-7 py-2 text-left font-mono text-sm transition-colors duration-150 hover:bg-row-hover"
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
      <span
        className={
          passed
            ? 'line-clamp-2 break-words text-fg-soft'
            : 'line-clamp-2 break-words text-fg-muted'
        }
      >
        {attempt.prompt ?? attempt.taskId}
      </span>
      <Answer attempt={attempt} />
      <span className="flex min-w-0 flex-col font-sans">
        <span className="truncate text-fg-secondary">{type}</span>
        <EvidenceMark kind={check ? 'check' : 'practice'} className="min-w-0 text-xs">
          <span className="truncate">{set}</span>
          {check && <span className="sr-only">, hidden from {mentor}</span>}
        </EvidenceMark>
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

/**
 * A right answer as given; a wrong one struck through, with what the checker found wrong under
 * it. The checker's words fit any task, where the expected value can be a whole record.
 */
function Answer({ attempt }: { attempt: RecentAttempt }) {
  const { answerSummary, check } = attempt;
  if (check.pass) return <span className="truncate text-fg">{answerSummary ?? 'Passed'}</span>;
  if (!answerSummary) return <span className="truncate text-fg-muted">{check.reason}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg-muted line-through decoration-fg-faint">
        {answerSummary}
      </span>
      <span className="truncate font-sans text-fg-secondary" title={check.reason}>
        {check.reason}
      </span>
    </span>
  );
}
