import type { Job } from '@architect/shared';
import { Panel, PanelHeader, PanelRow } from '@architect/ui';
import { Check, X } from 'lucide-react';
import { typeLabel } from '../names';
import type { RecentAttempt } from './run-state';

/** Older rows fade, as in the design; hovering or focusing a row brings it back. */
const FADE = [1, 0.8, 0.62, 0.46, 0.34];

/** The student's latest attempts, newest first. A row opens its trace. */
export function Examples({
  job,
  attempts,
  student,
  onOpen,
}: {
  job: Job;
  attempts: readonly RecentAttempt[];
  student: string;
  onOpen: (attempt: RecentAttempt) => void;
}) {
  const shown = attempts.slice(0, FADE.length);
  return (
    <Panel aria-label="Examples" className="min-w-0 flex-[7_1_560px]">
      <PanelHeader title="Examples" />
      {shown.length === 0 ? (
        <PanelRow className="text-fg-secondary">
          {student}&apos;s attempts show up here as it works.
        </PanelRow>
      ) : (
        <div className="overflow-x-auto">
          <ul className="m-0 min-w-[680px] list-none p-0">
            {shown.map((attempt, index) => (
              <li key={attempt.id}>
                <ExampleRow
                  attempt={attempt}
                  type={typeLabel(job, attempt.taskType)}
                  opacity={FADE[index] ?? 1}
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
  opacity,
  onOpen,
}: {
  attempt: RecentAttempt;
  type: string;
  opacity: number;
  onOpen: () => void;
}) {
  const passed = attempt.check.pass;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ opacity }}
      className="grid h-[54px] w-full grid-cols-[20px_minmax(0,1fr)_210px_136px] items-center gap-x-4 border-t border-line-row px-7 text-left font-mono text-sm transition-[opacity,background-color] duration-150 hover:bg-row-hover hover:opacity-100! focus-visible:opacity-100!"
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
      <span className="truncate text-fg-muted">{type}</span>
    </button>
  );
}

/** A right answer as given; a wrong one struck through beside the expected one. */
function Answer({ attempt }: { attempt: RecentAttempt }) {
  const { answerSummary, expectedSummary, check } = attempt;
  if (check.pass) return <span className="truncate text-fg">{answerSummary ?? 'Passed'}</span>;
  if (!answerSummary) return <span className="truncate text-fg-muted">{check.reason}</span>;
  return (
    <span className="flex min-w-0 gap-2.5">
      <span className="min-w-0 truncate text-fg-muted line-through decoration-fg-faint">
        {answerSummary}
      </span>
      {expectedSummary && (
        <span className="max-w-[75%] shrink-0 truncate text-fg-secondary">{expectedSummary}</span>
      )}
    </span>
  );
}
