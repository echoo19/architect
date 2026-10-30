import { Panel, SettingsRow, Spinner } from '@architect/ui';
import { useHasSampleAgent } from '../api/graduates';
import { StepIntro } from './SetupShell';
import { StatusValue } from './StatusValue';

export interface DoneStepProps {
  /** `saved` is a key on file that hasn't been tested; `ready` is a teacher that needs no key. */
  mentor: { name: string; state: 'connected' | 'saved' | 'ready' | 'missing' };
  student: { name: string; state: 'ready' | 'downloading' | 'missing' };
  /** Download progress while the model is still coming in. */
  percent: number | null;
}

export function DoneStep({ mentor, student, percent }: DoneStepProps) {
  const readyMade = useHasSampleAgent();
  const gaps = [
    student.state === 'missing' && `Agents can't run until ${student.name} is downloaded.`,
    mentor.state === 'missing' && 'Training a new agent needs a teacher.',
  ].filter(Boolean);
  // What the next screen offers to try first; a build without the ready-made agent has no such
  // offer, so the line doesn't name it.
  const offered = readyMade ? 'the sample job or a ready-made agent' : 'the sample job';

  return (
    <>
      <StepIntro title="You're set up">
        Next, describe a job. {mentor.name} teaches {student.name} until it can do the job alone. On
        the next screen you can try {offered} first, if you like.
      </StepIntro>
      <Panel
        aria-label="Setup"
        className="w-full max-w-[620px] px-7 py-1 [&>*:first-child]:border-t-0"
      >
        <SettingsRow label={student.name} meta="The model your agents run on">
          {student.state === 'ready' ? (
            <StatusValue done>Ready</StatusValue>
          ) : student.state === 'downloading' ? (
            <span className="flex items-center gap-2 text-fg">
              <Spinner tone="student" size={13} />
              Downloading{percent === null ? '' : ` · ${percent}%`}
            </span>
          ) : (
            <StatusValue done={false}>Not downloaded</StatusValue>
          )}
        </SettingsRow>
        <SettingsRow label={mentor.name} meta="Teaches it while an agent trains">
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
      {gaps.length > 0 && <p className="-mt-4 text-small text-fg">{gaps.join(' ')}</p>}
    </>
  );
}
