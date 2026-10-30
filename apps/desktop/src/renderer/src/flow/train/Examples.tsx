import { useState } from 'react';
import type { Job, ListedLesson } from '@architect/shared';
import { Button, Collapse, NumberTicker, Skeleton, Stagger, StaggerItem } from '@architect/ui';
import { Check, ChevronRight, X } from 'lucide-react';
import type { QueryState } from '../../api/query';
import type { MentoringRecords } from '../../api/mentoring';
import { ProblemState } from '../../components/ProblemState';
import { Appear, useFirstKeys } from '../appear';
import { Counted } from '../counted';
import { taskTitle } from '../format';
import { ROOMY, ROW_CHEVRON, Row, RowButton, Section } from '../ledger';
import { typeLabel } from '../names';
import { lessonOrigin, lessonVerdict } from './evidence-words';

/** Up to this many examples show at once, the newest; the rest unfold. */
const SHOWN = 8;

/**
 * The worked examples the mentor wrote for the agent to learn from, newest first: what the checker
 * said of each, whether it passed, the task it came from and how its answer was obtained. A row
 * opens it, step by step. The header counts the ones that passed, over every example listed. It
 * is there once there is an example to list, or a reason one can't be.
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
  const first = useFirstKeys(newest.slice(0, SHOWN).map((lesson) => lesson.id));
  const failed = records.status === 'error' && lessons.length === 0;
  const loading = records.status === 'loading' && records.data === undefined;
  const open = (lesson: ListedLesson) => () => onOpen(lesson);
  const kept = (lesson: ListedLesson) => lesson.round === null || !notKept.has(lesson.round);
  return (
    <Collapse open={lessons.length > 0 || failed || loading} className={ROOMY}>
      <Section
        title="Worked examples"
        actions={
          lessons.length > 0 && (
            <span className="text-small tabular-nums">
              <Counted said={`${passed} of ${lessons.length}`}>
                <NumberTicker value={passed} /> of <NumberTicker value={lessons.length} />
              </Counted>{' '}
              passed
            </span>
          )
        }
      >
        {failed ? (
          <div className="border-y border-line py-3">
            <ProblemState
              layout="inline"
              error={records.error}
              title="Couldn't load the worked examples"
              onRetry={records.reload}
            />
          </div>
        ) : loading ? (
          <div
            aria-busy="true"
            aria-label="Loading the worked examples"
            className="flex flex-col gap-3 border-y border-line py-3.5"
          >
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : (
          <>
            <Stagger as="ul" className="m-0 list-none border-b border-line p-0">
              {newest.slice(0, SHOWN).map((lesson) => (
                <StaggerItem as="li" key={lesson.id} className="border-t border-line">
                  <Appear added={!first.has(lesson.id)}>
                    <ExampleRow
                      lesson={lesson}
                      type={typeLabel(job, lesson.taskType)}
                      kept={kept(lesson)}
                      onOpen={open(lesson)}
                    />
                  </Appear>
                </StaggerItem>
              ))}
            </Stagger>
            {lessons.length > SHOWN && (
              <Collapse open={all} className={ROOMY}>
                <ul className="m-0 list-none border-b border-line p-0">
                  {newest.slice(SHOWN).map((lesson) => (
                    <Row key={lesson.id}>
                      <ExampleRow
                        lesson={lesson}
                        type={typeLabel(job, lesson.taskType)}
                        kept={kept(lesson)}
                        onOpen={open(lesson)}
                      />
                    </Row>
                  ))}
                </ul>
              </Collapse>
            )}
          </>
        )}
        {lessons.length > SHOWN && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 self-start"
            aria-expanded={all}
            onClick={() => setAll((current) => !current)}
          >
            {all ? `Show the newest ${SHOWN}` : `Show all ${lessons.length}`}
          </Button>
        )}
      </Section>
    </Collapse>
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
    <RowButton
      onClick={onOpen}
      className="min-h-12 grid-cols-[16px_minmax(0,1fr)_176px_184px_14px] py-2.5"
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
          className="text-danger"
          role="img"
          aria-label="Failed the checker"
        />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{lessonVerdict(lesson)}</span>
        <span className="truncate text-small">
          {lesson.prompt ? taskTitle(lesson.prompt) : lesson.taskType}
        </span>
      </span>
      <span className="truncate text-small">{lessonOrigin(lesson)}</span>
      <span className="truncate text-right text-small">
        {type}
        {lesson.round !== null && ` · Round ${lesson.round}${kept ? '' : ', not kept'}`}
      </span>
      <ChevronRight size={14} strokeWidth={1.8} aria-hidden className={ROW_CHEVRON} />
    </RowButton>
  );
}
