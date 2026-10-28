import type { Experiment, Round } from '@architect/shared';
import { cn, Heading, Panel, Spinner } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { formatRange } from '../format';
import { outcomeNote } from './decision';
import { draftRoundOf } from './draft';
import { DISPOSITIONS } from './evidence-words';
import { failureLine } from './failure-line';
import type { ModelNames } from './phase';
import { latestFailure, roundAttempts, type LiveRun, type RecentAttempt } from './run-state';

const ACTIVE = new Set(['running', 'testing', 'stopping']);

function studentLine(
  live: LiveRun,
  round: Round | null,
  failure: RecentAttempt | null,
  draft: boolean,
): string {
  const { run, job } = live;
  if (run.status === 'testing' || run.phase === 'testing') {
    return `Taking the ${job.splits.test}-task final test on its own.`;
  }
  if (draft) {
    return round?.status === 'evaluating'
      ? `Taking the ${job.splits.dev} check tasks with the first draft.`
      : 'No practice this round. It waits for its first setup.';
  }
  if (failure) return failureLine(failure);
  if (!round) {
    return run.phase === 'baseline'
      ? `Taking ${job.splits.dev} check tasks before any teaching.`
      : 'Waiting for the first round.';
  }
  const attempts = roundAttempts(live, round.index);
  if (attempts.length > 0 && attempts.every((attempt) => attempt.check.pass)) {
    return `Got all ${attempts.length} practice tasks right so far this round.`;
  }
  return `Working through ${job.evaluation.trainBatch} practice tasks.`;
}

function mentorLine(live: LiveRun, round: Round | null, names: ModelNames, draft: boolean): string {
  const { run } = live;
  if (run.status === 'testing' || run.phase === 'testing') {
    return 'Disconnected. The final test runs without help.';
  }
  if (!round) return `Starts teaching once ${names.student} has taken the check tasks.`;
  if (round.diagnosis) return round.diagnosis;
  if (draft) {
    return `Writing ${names.student}'s first full setup from the job and its example tasks.`;
  }
  if (live.mentorBusy || round.status === 'diagnosing') {
    const failed = round.train.total - round.train.pass;
    return failed > 0
      ? `Reading ${failed} failed practice ${failed === 1 ? 'task' : 'tasks'}.`
      : 'Reading the practice results.';
  }
  return `Waits for ${names.student} to finish the practice tasks.`;
}

/** The round's number and, once the mentor has named it, the change it is trying. */
function roundHeading(round: Round | null, draft: boolean): string {
  if (!round) return 'Before the first round';
  if (draft) return `Round ${round.index}: first draft`;
  return round.title ? `Round ${round.index}: ${round.title}` : `Round ${round.index}`;
}

/**
 * What the student just got wrong, what the mentor makes of it, and what it expects to gain;
 * once the round has ended, how its change ended too.
 */
export function CurrentRound({
  live,
  round,
  names,
  experiment,
}: {
  live: LiveRun;
  round: Round | null;
  names: ModelNames;
  /** The round's experiment record, once it has one. */
  experiment: Experiment | undefined;
}) {
  const draft = round !== null && round.index === draftRoundOf(live);
  const failure = round && !draft ? latestFailure(live, round.index) : null;
  const working = ACTIVE.has(live.run.status);
  const predicted = round?.predicted;
  const ended = experiment && !draft ? experiment : undefined;
  return (
    <Panel padded aria-label="Current round" className="min-w-0 flex-[5_1_360px]">
      <div className="flex items-center justify-between gap-3">
        <Heading>{roundHeading(round, draft)}</Heading>
        {working && <Spinner tone="mentor" size={16} label="Working" />}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-student">{names.student}</span>
        <p className="m-0 text-md text-fg-soft text-pretty">
          {studentLine(live, round, failure, draft)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-mentor">{names.mentor}</span>
        <p className="m-0 text-md text-fg-soft text-pretty">
          {mentorLine(live, round, names, draft)}
        </p>
      </div>
      {live.notice && (
        <p role="status" className="m-0 flex items-start gap-2 text-sm text-fg-muted">
          <CircleAlert
            size={13}
            className={
              live.notice.level === 'error' ? 'mt-[3px] text-danger' : 'mt-[3px] text-mentor'
            }
            aria-hidden
          />
          {live.notice.message}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-3 border-t border-line-row-strong pt-[18px]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-fg-secondary">
            {names.mentor} {ended ? 'expected' : 'expects'}
          </span>
          {predicted ? (
            <span>
              <span className="font-mono tabular-nums">
                {formatRange(predicted.devDeltaMin, predicted.devDeltaMax)}
              </span>{' '}
              <span className="text-fg-secondary">check tasks</span>
            </span>
          ) : (
            <span className="text-fg-muted">–</span>
          )}
        </div>
        {ended && <Outcome experiment={ended} live={live} />}
      </div>
    </Panel>
  );
}

/** How the round's change ended: its disposition, and in a few words why it isn't kept. */
function Outcome({ experiment, live }: { experiment: Experiment; live: LiveRun }) {
  const { label, icon: Icon, tone } = DISPOSITIONS[experiment.disposition];
  const note = outcomeNote(experiment, live.job);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-fg-secondary">Result</span>
      <span className="flex min-w-0 items-center gap-2">
        <Icon size={14} strokeWidth={2} aria-hidden className={cn('shrink-0', tone)} />
        <span className={tone}>{label}</span>
        {note && <span className="truncate text-fg-secondary">· {note}</span>}
      </span>
    </div>
  );
}
