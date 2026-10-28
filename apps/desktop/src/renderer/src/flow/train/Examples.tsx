import type { Job, ListedLesson } from '@architect/shared';
import { ErrorState, Panel, PanelHeader, PanelRow, Skeleton } from '@architect/ui';
import { Check, ChevronRight, X } from 'lucide-react';
import type { QueryState } from '../../api/query';
import type { MentoringRecords } from '../../api/mentoring';
import { typeLabel } from '../names';
import { lessonOrigin, lessonVerdict } from './evidence-words';

/**
 * The worked examples Spark wrote, newest first, each verified by the checker or rejected by it:
 * what the checker said, the task it came from and how its right answer was obtained. A row
 * opens it, step by step. The header counts how many were verified.
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
  const verified = lessons.filter((lesson) => lesson.status === 'verified').length;
  return (
    <Panel aria-label="Examples" className="min-w-0 flex-[7_1_560px]">
      <PanelHeader
        title="Examples"
        actions={
          lessons.length > 0 && (
            <span className="text-sm tabular-nums text-fg-muted">
              {verified} of {lessons.length} verified
            </span>
          )
        }
      />
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
      ) : lessons.length === 0 ? (
        <PanelRow className="text-fg-muted">No examples yet</PanelRow>
      ) : (
        <div className="max-h-[372px] overflow-auto">
          <ul className="m-0 min-w-[620px] list-none p-0">
            {[...lessons].reverse().map((lesson) => (
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
      className="group grid min-h-[62px] w-full grid-cols-[20px_minmax(0,1fr)_180px_130px_14px] items-center gap-x-4 border-t border-line-row px-7 py-2 text-left transition-colors duration-150 hover:bg-row-hover"
    >
      {verified ? (
        <Check
          size={15}
          strokeWidth={2.2}
          className="text-student"
          role="img"
          aria-label="Verified"
        />
      ) : (
        <X size={15} strokeWidth={2.2} className="text-fg-faint" role="img" aria-label="Rejected" />
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span className={verified ? 'truncate text-fg-soft' : 'truncate text-fg-muted'}>
          {lessonVerdict(lesson)}
        </span>
        <span className="truncate font-mono text-xs text-fg-muted">
          {lesson.prompt ?? lesson.taskType}
        </span>
      </span>
      <span className={verified ? 'truncate text-fg-secondary' : 'truncate text-fg-muted'}>
        {lessonOrigin(lesson)}
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
