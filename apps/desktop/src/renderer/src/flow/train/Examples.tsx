import { useState } from 'react';
import type { Job, ListedLesson } from '@architect/shared';
import { Panel, PanelHeader, PanelRow, Skeleton } from '@architect/ui';
import { Check, ChevronRight, X } from 'lucide-react';
import type { QueryState } from '../../api/query';
import type { MentoringRecords } from '../../api/mentoring';
import { ProblemState } from '../../components/ProblemState';
import { typeLabel } from '../names';
import { lessonOrigin, lessonVerdict } from './evidence-words';

/** Up to this many examples show at once, the newest; the rest unfold. */
const SHOWN = 8;

/**
 * The worked examples Spark wrote for the agent to learn from, newest first: what the checker
 * said of each, whether it passed, the task it came from and how its answer was obtained. A row
 * opens it, step by step. The header counts the ones that passed, over every example listed.
 */
export function Examples({
  job,
  records,
  onOpen,
}: {
  job: Job;
  records: QueryState<MentoringRecords>;
  onOpen: (lesson: ListedLesson) => void;
}) {
  const [all, setAll] = useState(false);
  const lessons = records.data?.lessons ?? [];
  const passed = lessons.filter((lesson) => lesson.status === 'verified').length;
  // An example belongs to its round's change, so one from a change not kept isn't in the agent.
  const notKept = new Set(
    (records.data?.experiments ?? [])
      .filter((experiment) => experiment.disposition !== 'kept')
      .map((experiment) => experiment.round),
  );
  const newest = [...lessons].reverse();
  const shown = all ? newest : newest.slice(0, SHOWN);
  return (
    <Panel aria-label="Worked examples" className="min-w-0 flex-[7_1_560px]">
      <PanelHeader
        title="Worked examples"
        actions={
          lessons.length > 0 && (
            <span className="text-sm tabular-nums text-fg-muted">
              {passed} of {lessons.length} passed the checker
            </span>
          )
        }
      />
      {records.status === 'error' && lessons.length === 0 ? (
        <PanelRow className="py-3">
          <ProblemState
            layout="inline"
            error={records.error}
            title="Couldn't load the worked examples"
            onRetry={records.reload}
          />
        </PanelRow>
      ) : records.status === 'loading' && records.data === undefined ? (
        <div aria-busy="true" aria-label="Loading the worked examples" className="flex flex-col">
          {[0, 1, 2].map((row) => (
            <PanelRow key={row}>
              <Skeleton className="h-4 w-full" />
            </PanelRow>
          ))}
        </div>
      ) : lessons.length === 0 ? (
        <PanelRow className="text-fg-muted">No worked examples yet</PanelRow>
      ) : (
        <div className="overflow-x-auto">
          <ul className="m-0 min-w-[620px] list-none p-0">
            {shown.map((lesson) => (
              <li key={lesson.id}>
                <ExampleRow
                  lesson={lesson}
                  type={typeLabel(job, lesson.taskType)}
                  kept={lesson.round === null || !notKept.has(lesson.round)}
                  onOpen={() => onOpen(lesson)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {lessons.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll((open) => !open)}
          className="mt-auto flex min-h-[54px] items-center justify-end border-t border-line-row px-7 text-fg-secondary transition-colors duration-150 hover:text-fg"
        >
          {all ? `Show the newest ${SHOWN}` : `Show all ${lessons.length}`}
        </button>
      )}
    </Panel>
  );
}

function ExampleRow({
  lesson,
  type,
  kept,
  onOpen,
}: {
  lesson: ListedLesson;
  type: string;
  /** False when the round's change, which the example went with, wasn't kept. */
  kept: boolean;
  onOpen: () => void;
}) {
  const passed = lesson.status === 'verified';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid min-h-[62px] w-full grid-cols-[20px_minmax(0,1fr)_190px_120px_14px] items-center gap-x-4 border-t border-line-row px-7 py-2 text-left transition-colors duration-150 hover:bg-row-hover"
    >
      {passed ? (
        <Check
          size={15}
          strokeWidth={2.2}
          className="text-student"
          role="img"
          aria-label="Passed the checker"
        />
      ) : (
        <X
          size={15}
          strokeWidth={2.2}
          className="text-fg-faint"
          role="img"
          aria-label="Failed the checker"
        />
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className={passed ? 'truncate text-fg-soft' : 'truncate text-fg-muted'}>
          {lessonVerdict(lesson)}
        </span>
        <span className="truncate font-mono text-xs text-fg-muted">
          {lesson.prompt ?? lesson.taskType}
        </span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={passed ? 'truncate text-fg-secondary' : 'truncate text-fg-muted'}>
          {lessonOrigin(lesson)}
        </span>
        <span
          className={passed ? 'truncate text-xs text-student' : 'truncate text-xs text-fg-muted'}
        >
          {passed ? 'Checker passed it' : 'Checker failed it'}
        </span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-fg-secondary">{type}</span>
        <span className="truncate text-xs text-fg-muted">
          {lesson.round === null
            ? 'Example'
            : kept
              ? `Round ${lesson.round}`
              : `Round ${lesson.round}, not kept`}
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
