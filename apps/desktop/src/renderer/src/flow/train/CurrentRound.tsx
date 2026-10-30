import type { ReactNode } from 'react';
import type { Round } from '@architect/shared';
import { cn, StepTransition } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { formatRange } from '../format';
import { draftRoundOf } from './draft';
import { failureLine } from './failure-line';
import type { ModelNames } from './phase';
import { Question } from './Question';
import { answerEffect, isOpen, type QuestionView } from './questions';
import {
  hasEnded,
  isTesting,
  latestFailure,
  roundAttempts,
  type LiveRun,
  type RecentAttempt,
} from './run-state';

function studentLine(
  live: LiveRun,
  round: Round,
  failure: RecentAttempt | null,
  draft: boolean,
): string {
  const { job } = live;
  if (draft) {
    return round.status === 'evaluating'
      ? `Taking the ${job.splits.dev} check tasks with the first draft.`
      : 'No practice this round. It waits for its first setup.';
  }
  if (failure) return failureLine(failure);
  const attempts = roundAttempts(live, round.index);
  if (attempts.length > 0 && attempts.every((attempt) => attempt.check.pass)) {
    return `Got all ${attempts.length} practice ${attempts.length === 1 ? 'task' : 'tasks'} right so far this round.`;
  }
  return `Working through ${job.evaluation.trainBatch} practice tasks.`;
}

function mentorLine(live: LiveRun, round: Round, names: ModelNames, draft: boolean): string {
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

/**
 * The newest round, opened under its line in the list of rounds: what the student just got wrong
 * and what the mentor makes of it, and what the mentor expects to gain. How the round ended is
 * said once, in its line. A question the mentor put to the person is asked and answered here too.
 */
export function CurrentRound({
  live,
  round,
  names,
  question,
}: {
  live: LiveRun;
  round: Round;
  names: ModelNames;
  /** The question the round put to the person, when it was one. */
  question: QuestionView | null;
}) {
  const draft = round.index === draftRoundOf(live);
  const over = round.status === 'decided' || round.status === 'failed';
  // Once the round is over, or the run has moved on to its test or its end, the student's last
  // miss and the mentor's progress are history: what is left is the diagnosis and what it expected.
  const active = !over && !hasEnded(live.run) && !isTesting(live.run);
  const failure = active && !draft ? latestFailure(live, round.index) : null;
  const predicted = round.predicted;
  // A run paused on an error says so, with what to do, in a notice of its own above.
  const pausedOnError = live.run.status === 'paused' && live.run.error !== undefined;
  // A question round waits for its answer here, then says what the mentor did with it. A run that
  // ended first can't take the answer any more, so it only says what was asked.
  const asking =
    !hasEnded(live.run) &&
    question !== null &&
    (question.state !== 'ready' || isOpen(round, question.intervention));
  const answered = question?.state === 'ready' ? question.intervention : undefined;
  const unanswered = hasEnded(live.run) && answered?.answer === undefined ? answered : undefined;
  const showDiagnosis = question === null && (active || round.diagnosis !== undefined);

  return (
    <section aria-label="Current round" className="flex flex-col gap-5 pb-6 pl-11">
      {active && (
        <Line who={names.student} tone="student">
          {studentLine(live, round, failure, draft)}
        </Line>
      )}
      <StepTransition transitionKey={asking ? 'asking' : 'answered'} className="empty:hidden">
        {asking && question !== null ? (
          <Question runId={live.run.id} round={round} view={question} names={names} />
        ) : answered?.answer ? (
          <Line who={names.mentor} tone="mentor">
            <p className="m-0 text-pretty">You answered: {answered.answer.text}</p>
            <p className="m-0 text-pretty">{answerEffect(answered, names)}</p>
          </Line>
        ) : unanswered ? (
          <Line who={names.mentor} tone="mentor">
            <p className="m-0 text-pretty">
              {names.mentor} asked: {unanswered.question}
            </p>
            <p className="m-0 text-pretty">Training ended before you answered.</p>
          </Line>
        ) : (
          showDiagnosis && (
            <Line who={names.mentor} tone="mentor">
              {mentorLine(live, round, names, draft)}
            </Line>
          )
        )}
      </StepTransition>
      {live.notice && !pausedOnError && (
        <p role="status" className="m-0 flex items-start gap-2 text-small">
          <CircleAlert
            size={13}
            className={cn(
              'mt-[3px]',
              live.notice.level === 'error' ? 'text-danger' : 'text-mentor',
            )}
            aria-hidden
          />
          {live.notice.message}
        </p>
      )}
      {question === null && predicted && (
        <dl className="m-0">
          <Fact label={over ? 'Expected' : 'Expects'}>
            <span className="tabular-nums">
              {formatRange(predicted.devDeltaMin, predicted.devDeltaMax)} check tasks
            </span>
          </Fact>
        </dl>
      )}
    </section>
  );
}

/** A label in a model's color, and what that model has to say, side by side. */
function Line({
  who,
  tone,
  children,
}: {
  who: string;
  tone: 'student' | 'mentor';
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4">
      <span className={tone === 'student' ? 'text-student' : 'text-mentor'}>{who}</span>
      <div className="flex min-w-0 flex-col gap-1.5 text-pretty">{children}</div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-x-4">
      <dt>{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}
