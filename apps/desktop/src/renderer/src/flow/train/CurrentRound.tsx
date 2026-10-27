import type { Round } from '@architect/shared';
import { Heading, Panel, Spinner } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { formatRange } from '../format';
import { failureLine } from './failure-line';
import type { ModelNames } from './phase';
import { latestFailure, roundAttempts, type LiveRun, type RecentAttempt } from './run-state';

const ACTIVE = new Set(['running', 'testing', 'stopping']);

function studentLine(live: LiveRun, round: Round | null, failure: RecentAttempt | null): string {
  const { run, job } = live;
  if (run.status === 'testing' || run.phase === 'testing') {
    return `Taking the ${job.splits.test}-task final test on its own.`;
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

function mentorLine(live: LiveRun, round: Round | null, names: ModelNames): string {
  const { run } = live;
  if (run.status === 'testing' || run.phase === 'testing') {
    return 'Disconnected. The final test runs without help.';
  }
  if (!round) return `Starts teaching once ${names.student} has taken the check tasks.`;
  if (round.diagnosis) return round.diagnosis;
  if (live.mentorBusy || round.status === 'diagnosing') {
    const failed = round.train.total - round.train.pass;
    return failed > 0
      ? `Reading ${failed} failed practice ${failed === 1 ? 'task' : 'tasks'}.`
      : 'Reading the practice results.';
  }
  return `Waits for ${names.student} to finish the practice tasks.`;
}

/** What the student just got wrong, what the mentor makes of it, and what it expects to gain. */
export function CurrentRound({
  live,
  round,
  names,
}: {
  live: LiveRun;
  round: Round | null;
  names: ModelNames;
}) {
  const failure = round ? latestFailure(live, round.index) : null;
  const working = ACTIVE.has(live.run.status);
  const { predicted } = round ?? {};
  return (
    <Panel padded aria-label="Current round" className="min-w-0 flex-[5_1_360px]">
      <div className="flex items-center justify-between gap-3">
        <Heading>{round ? `Round ${round.index}` : 'Before the first round'}</Heading>
        {working && <Spinner tone="mentor" size={16} label="Working" />}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-student">{names.student}</span>
        <p className="m-0 text-md text-fg-soft text-pretty">{studentLine(live, round, failure)}</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-mentor">{names.mentor}</span>
        <p className="m-0 text-md text-fg-soft text-pretty">{mentorLine(live, round, names)}</p>
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
      <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-line-row-strong pt-[18px]">
        <span className="text-fg-secondary">Expected</span>
        {predicted ? (
          <span
            className="font-mono"
            aria-label={`Expected ${formatRange(predicted.devDeltaMin, predicted.devDeltaMax)} check tasks right`}
          >
            {formatRange(predicted.devDeltaMin, predicted.devDeltaMax)}
          </span>
        ) : (
          <span className="text-fg-muted">After the diagnosis</span>
        )}
      </div>
    </Panel>
  );
}
