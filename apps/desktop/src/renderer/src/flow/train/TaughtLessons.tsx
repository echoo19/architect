import type { RunImprovement } from '@architect/shared';
import { ErrorState, Panel, PanelHeader, PanelRow, Skeleton } from '@architect/ui';
import { useCorrections } from '../../api/teaching';
import { KindTile } from '../../workspace/teach/kinds';
import { KIND_SHORT } from '../../workspace/teach/lessons';

/**
 * At the top of an improvement's training view: the lessons from the person's flagged answers
 * that this improvement teaches, each with its kind.
 */
export function TaughtLessons({ improves }: { improves: RunImprovement }) {
  const corrections = useCorrections(improves.graduateId);
  const lessons = improves.corrections.flatMap((id) => {
    const found = corrections.data?.find((correction) => correction.id === id);
    return found ? [found] : [];
  });
  return (
    <Panel aria-label="Lessons from your flagged answers" className="w-full">
      <PanelHeader
        title="Lessons from your flagged answers"
        actions={
          <span className="text-sm text-fg-muted">Improving version {improves.version}</span>
        }
      />
      {corrections.data ? (
        <ul className="m-0 list-none p-0">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <PanelRow className="grid-cols-[28px_minmax(0,1fr)_auto] py-2.5">
                <KindTile kind={lesson.proposal.kind} />
                <span className="text-pretty">{lesson.proposal.lesson}</span>
                <span className="text-sm text-fg-muted">{KIND_SHORT[lesson.proposal.kind]}</span>
              </PanelRow>
            </li>
          ))}
        </ul>
      ) : corrections.status === 'error' ? (
        <ErrorState
          layout="inline"
          title="Couldn't load its lessons"
          message={corrections.error.message}
          onRetry={corrections.reload}
          className="border-t border-line-row px-7 py-4"
        />
      ) : (
        <div
          aria-busy="true"
          aria-label="Loading its lessons"
          className="border-t border-line-row px-7 py-4"
        >
          <Skeleton className="h-3.5 w-80" />
        </div>
      )}
    </Panel>
  );
}
