import { Panel, SettingsRow, Spinner } from '@architect/ui';
import { capitalized, mentorIntro, STUDENT_ROLE, studentIntro } from '../lib/names';
import { StepIntro } from './SetupShell';
import { StatusValue } from './StatusValue';

export interface DoneStepProps {
  /** `saved` is a key on file that hasn't been tested; `ready` is a mentor that needs no key. */
  mentor: { name: string; label: string; state: 'connected' | 'saved' | 'ready' | 'missing' };
  student: { name: string; model: string; state: 'ready' | 'downloading' | 'missing' };
  /** Download progress while the model is still coming in. */
  percent: number | null;
}

export function DoneStep({ mentor, student, percent }: DoneStepProps) {
  const gaps = [
    student.state === 'missing' && "Agents can't run until the local model is downloaded.",
    mentor.state === 'missing' && 'Training a new agent needs a mentor.',
  ].filter(Boolean);

  return (
    <>
      <StepIntro title="You're set up">
        Next, describe a job. {mentorIntro(mentor.name)}, coaches {studentIntro(student.name)},
        until it can do the job alone. The sample job is on the next screen, if you'd like to see
        one first.
      </StepIntro>
      <Panel
        aria-label="Setup"
        className="w-full max-w-[620px] px-7 py-1 [&>*:first-child]:border-t-0"
      >
        <SettingsRow label={capitalized(STUDENT_ROLE)} meta={student.model} metaFont="code">
          {student.state === 'ready' ? (
            <StatusValue done>Ready</StatusValue>
          ) : student.state === 'downloading' ? (
            <span className="flex items-center gap-2 text-fg-secondary">
              <Spinner tone="student" size={13} />
              Downloading{percent === null ? '' : ` · ${percent}%`}
            </span>
          ) : (
            <StatusValue done={false}>Not downloaded</StatusValue>
          )}
        </SettingsRow>
        <SettingsRow label="Mentor" meta={mentor.label}>
          {mentor.state === 'connected' ? (
            <StatusValue done>Connected</StatusValue>
          ) : mentor.state === 'ready' ? (
            <StatusValue done>Ready</StatusValue>
          ) : mentor.state === 'saved' ? (
            <StatusValue done>Key saved</StatusValue>
          ) : (
            <StatusValue done={false}>Skipped</StatusValue>
          )}
        </SettingsRow>
      </Panel>
      {gaps.length > 0 && <p className="-mt-4 text-sm text-fg-muted">{gaps.join(' ')}</p>}
    </>
  );
}
