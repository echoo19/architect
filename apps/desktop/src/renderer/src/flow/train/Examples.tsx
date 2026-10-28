import type { Job, ListedLesson } from '@architect/shared';
import { ErrorState, Panel, PanelHeader, PanelRow, Skeleton } from '@architect/ui';
import { Check, ChevronRight, X } from 'lucide-react';
import type { QueryState } from '../../api/query';
import type { MentoringRecords } from '../../api/mentoring';
import { typeLabel } from '../names';
import { lessonOrigin } from './evidence-words';

/** How many of the latest examples show. */
const SHOWN = 5;

/**
 * The worked examples Spark wrote and the checker verified, newest first: each kept or thrown
 * out, and how its right answer was obtained. A row opens it, step by step.
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
  const lessons = records.data?.lessons ?? [];
  const shown = [...lessons].reverse().slice(0, SHOWN);
  return (
    <Panel aria-label="Examples" className="min-w-0 flex-[7_1_560px]">
      <PanelHeader title="Examples" />
      {records.status === 'error' && lessons.length === 0 ? (
        <PanelRow className="py-3">
          <ErrorState
            layout="inline"
            title="Couldn't load the examples"
            message={records.error.message}
            onRetry={records.reload}
          />
        </PanelRow>
      ) : records.status === 'loading' && records.data === undefined ? (
        <div aria-busy="true" aria-label="Loading the examples" className="flex flex-col">
          {[0, 1, 2].map((row) => (
            <PanelRow key={row}>
              <Skeleton className="h-4 w-full" />
            </PanelRow>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <PanelRow className="text-fg-muted">No examples yet</PanelRow>
      ) : (
        <div className="overflow-x-auto">
          <ul className="m-0 min-w-[620px] list-none p-0">
            {shown.map((lesson) => (
              <li key={lesson.id}>
                <ExampleRow
                  lesson={lesson}
                  type={typeLabel(job, lesson.taskType)}
                  onOpen={() => onOpen(lesson)}
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
  lesson,
  type,
  onOpen,
}: {
  lesson: ListedLesson;
  type: string;
  onOpen: () => void;
}) {
  const verified = lesson.status === 'verified';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid min-h-[54px] w-full grid-cols-[20px_minmax(0,1fr)_200px_150px_14px] items-center gap-x-4 border-t border-line-row px-7 py-2 text-left transition-colors duration-150 hover:bg-row-hover"
    >
      {verified ? (
        <Check size={15} strokeWidth={2.2} className="text-student" role="img" aria-label="Kept" />
      ) : (
        <X
          size={15}
          strokeWidth={2.2}
          className="text-fg-faint"
          role="img"
          aria-label="Thrown out"
        />
      )}
      <span
        className={
          verified
            ? 'line-clamp-2 break-words font-mono text-sm text-fg-soft'
            : 'line-clamp-2 break-words font-mono text-sm text-fg-muted'
        }
      >
        {lesson.prompt ?? lesson.taskType}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={verified ? 'truncate text-fg-secondary' : 'truncate text-fg-muted'}>
          {lessonOrigin(lesson)}
        </span>
        {!verified && <span className="truncate text-xs text-fg-muted">{lesson.reason}</span>}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-fg-secondary">{type}</span>
        <span className="truncate text-xs text-fg-muted">
          {lesson.round === null ? 'Example' : `Round ${lesson.round}`}
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
