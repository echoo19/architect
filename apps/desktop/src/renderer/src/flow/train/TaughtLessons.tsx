import type { RunImprovement } from '@architect/shared';
import { Skeleton, Stagger, StaggerItem } from '@architect/ui';
import { useCorrections } from '../../api/teaching';
import { ProblemState } from '../../components/ProblemState';
import { KIND_LABELS } from '../../workspace/teach/lessons';
import { Section } from '../ledger';

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
    <Section
      title="Lessons from your flagged answers"
      actions={<span className="text-small">Improving from version {improves.version}</span>}
    >
      {corrections.data ? (
        <Stagger as="ul" className="m-0 list-none border-b border-line p-0">
          {lessons.map((lesson) => (
            <StaggerItem
              as="li"
              key={lesson.id}
              className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t border-line py-2.5"
            >
              <span className="text-pretty">{lesson.proposal.lesson}</span>
              <span className="text-small">{KIND_LABELS[lesson.proposal.kind]}</span>
            </StaggerItem>
          ))}
        </Stagger>
      ) : corrections.status === 'error' ? (
        <ProblemState
          layout="inline"
          error={corrections.error}
          title="Couldn't load its lessons"
          onRetry={corrections.reload}
          className="border-y border-line py-3"
        />
      ) : (
        <div
          aria-busy="true"
          aria-label="Loading its lessons"
          className="border-y border-line py-4"
        >
          <Skeleton className="h-3.5 w-80" />
        </div>
      )}
    </Section>
  );
}
