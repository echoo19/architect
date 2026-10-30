import type { Job } from '@architect/shared';
import { EvidenceMark, Stagger, StaggerItem } from '@architect/ui';
import { Check, ChevronRight, X } from 'lucide-react';
import { Appear, useFirstKeys } from '../appear';
import { taskTitle } from '../format';
import { ROW_CHEVRON, RowButton, Section } from '../ledger';
import { typeLabel } from '../names';
import type { RecentAttempt } from './run-state';

/** How many of the latest attempts show. */
const SHOWN = 5;

/** The student's latest attempts, newest first. A row opens its trace. */
export function LatestAttempts({
  job,
  attempts,
  mentor,
  ended,
  onOpen,
}: {
  job: Job;
  attempts: readonly RecentAttempt[];
  /** The run is over, so an empty list stays empty. */
  ended: boolean;
  mentor: string;
  onOpen: (attempt: RecentAttempt) => void;
}) {
  const shown = attempts.slice(0, SHOWN);
  const first = useFirstKeys(shown.map((attempt) => attempt.id));
  return (
    <Section title="Latest attempts">
      {shown.length === 0 ? (
        <p className="m-0 border-y border-line py-3.5">
          {ended ? 'No attempts' : 'No attempts yet'}
        </p>
      ) : (
        <Stagger as="ul" className="m-0 list-none border-b border-line p-0">
          {shown.map((attempt) => (
            <StaggerItem as="li" key={attempt.id} className="border-t border-line">
              <Appear added={!first.has(attempt.id)}>
                <AttemptRow
                  attempt={attempt}
                  type={typeLabel(job, attempt.taskType)}
                  mentor={mentor}
                  onOpen={() => onOpen(attempt)}
                />
              </Appear>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </Section>
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
  // A check task's score is all the mentor ever sees of it.
  const what = `${attempt.round ? `${kind}, round ${attempt.round}` : kind}${check ? `, ${mentor} sees only the score` : ''}`;
  return (
    <RowButton
      onClick={onOpen}
      className="min-h-12 grid-cols-[16px_minmax(0,1fr)_auto_14px] py-2.5"
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
        <X size={15} strokeWidth={2.2} className="text-danger" role="img" aria-label="Failed" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">
          {attempt.prompt ? taskTitle(attempt.prompt) : attempt.taskId}
        </span>
        {!passed && (
          <span className="truncate text-small" title={attempt.check.reason}>
            {attempt.check.reason}
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-2.5 text-small" title={what}>
        <span className="truncate">{type}</span>
        <EvidenceMark kind={check ? 'check' : 'practice'} iconOnly>
          {what}
        </EvidenceMark>
      </span>
      <ChevronRight size={14} strokeWidth={1.8} aria-hidden className={ROW_CHEVRON} />
    </RowButton>
  );
}
