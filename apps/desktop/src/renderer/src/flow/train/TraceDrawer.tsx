import type { ReactNode } from 'react';
import type { ListedAttempt, Trace } from '@architect/shared';
import { cn, Disclosure, DrawerContent, ErrorState, EvidenceMark, Skeleton } from '@architect/ui';
import { Check, CircleX } from 'lucide-react';
import { flowApi } from '../../api/client';
import { useQuery } from '../../api/query';
import { formatAnswerTime } from '../format';
import type { ModelNames } from './phase';
import type { StepNote } from './lesson-steps';
import { Playback } from './Playback';
import { playbackSteps } from './trace-steps';

const STOP_REASONS: Record<Trace['stopReason'], string | null> = {
  answer: null,
  max_steps: 'Stopped at the step limit before answering.',
  refused: 'Refused the task.',
  error: 'Stopped on an error.',
  aborted: 'Stopped before it finished.',
};

/** "Practice task, round 4" or "Check task, round 3 · never shown to Spark", with its mark. */
function AttemptKind({ attempt, mentor }: { attempt: ListedAttempt; mentor: string }) {
  const check = attempt.split === 'dev';
  const kind = check ? 'Check task' : 'Practice task';
  return (
    <>
      <EvidenceMark kind={check ? 'check' : 'practice'} className="align-[-2px]">
        {attempt.round ? `${kind}, round ${attempt.round}` : kind}
      </EvidenceMark>
      {check && ` · never shown to ${mentor}`}
    </>
  );
}

/**
 * One attempt in full: the verdict, then every step with its evidence, from the keyboard as
 * well as the mouse. Opened from a finding, it starts at the step the finding points to, with
 * Spark's notes on the steps they name.
 */
export function TraceDrawerContent({
  attempt,
  type,
  names,
  setup,
  openAt,
  notes,
  onBack,
}: {
  attempt: ListedAttempt;
  type: string;
  names: ModelNames;
  /** The setup the attempt used, named by where it came from. */
  setup: string;
  openAt?: number;
  notes?: readonly StepNote[];
  /** The way back, when another drawer opened this one. */
  onBack?: (() => void) | undefined;
}) {
  const trace = useQuery(`trace:${attempt.id}`, () => flowApi.trace(attempt.id));
  return (
    <DrawerContent
      title={attempt.prompt ?? `Task ${attempt.taskId}`}
      onBack={onBack}
      subtitle={
        <>
          {type} · <AttemptKind attempt={attempt} mentor={names.mentor} /> · using {setup}
        </>
      }
    >
      <div className="flex flex-col gap-7">
        {attempt.prompt && <WholeRequest prompt={attempt.prompt} />}
        <Verdict attempt={attempt} student={names.student} />
        {trace.status === 'loading' && <StepsSkeleton />}
        {trace.status === 'error' && (
          <ErrorState
            layout="inline"
            title="Couldn't load this attempt's steps"
            message={trace.error.message}
            onRetry={trace.reload}
          />
        )}
        {trace.status === 'success' && (
          <>
            <Playback
              title={`${names.student}'s steps`}
              steps={playbackSteps(trace.data).map((step) => ({
                step,
                actor: 'student',
                replayed: false,
              }))}
              {...(openAt === undefined ? {} : { openAt })}
              {...(notes === undefined ? {} : { notes })}
              mentor={names.mentor}
              student={names.student}
            />
            <TraceFooter trace={trace.data} />
          </>
        )}
      </div>
    </DrawerContent>
  );
}

/** About what a drawer title shows in its three lines; a longer request folds out in full. */
const TITLE_CHARS = 180;

/** A task's request too long for the drawer's title, in full under a fold. */
export function WholeRequest({ prompt }: { prompt: string }) {
  if (prompt.length <= TITLE_CHARS) return null;
  return (
    <Disclosure label="The whole request" className="-mt-3">
      <p className="m-0 whitespace-pre-wrap break-words rounded-md bg-well px-3 py-2 text-sm text-fg-soft">
        {prompt}
      </p>
    </Disclosure>
  );
}

export function StepsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the steps" className="flex flex-col gap-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

/** How the attempt ended when it didn't answer, and what it took. */
export function TraceFooter({ trace }: { trace: Trace }) {
  const tokens = trace.usage.inputTokens + trace.usage.outputTokens;
  const stopped = STOP_REASONS[trace.stopReason];
  return (
    <>
      {(stopped || trace.error) && (
        <p className="m-0 text-sm text-fg-muted">
          {[stopped, trace.error].filter(Boolean).join(' ')}
        </p>
      )}
      <p className="m-0 flex flex-wrap gap-x-2 border-t border-line-card pt-4 text-sm tabular-nums text-fg-muted">
        <span>
          Ran on <span className="font-mono text-xs leading-5">{trace.studentModel}</span>
        </span>
        <span aria-hidden>·</span>
        <span>{formatAnswerTime(trace.latencyMs)} in all</span>
        <span aria-hidden>·</span>
        <span>{tokens.toLocaleString('en-US')} tokens of text read and written</span>
      </p>
    </>
  );
}

/**
 * Passed or failed, the checker's reason, and the answer beside what the checker expected,
 * which can be a record it looks for rather than an answer.
 */
export function Verdict({ attempt, student }: { attempt: ListedAttempt; student: string }) {
  const { check, answerSummary, expectedSummary } = attempt;
  return (
    <VerdictBox
      passed={check.pass}
      title={check.pass ? 'Passed' : 'Failed'}
      reason={check.reason}
      rows={[
        ...(answerSummary ? [{ label: `${student} answered`, value: answerSummary }] : []),
        ...(expectedSummary ? [{ label: 'Checker expected', value: expectedSummary }] : []),
      ]}
    />
  );
}

/** A verdict in a tinted box: a check or a cross, a title, the reason and a few values. */
export function VerdictBox({
  passed,
  title,
  reason,
  rows = [],
  children,
}: {
  passed: boolean;
  title: string;
  reason?: string;
  rows?: { label: string; value: string }[];
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border px-4 py-3.5',
        passed ? 'border-student-tile-line bg-student-tile' : 'border-danger-line bg-danger-tint',
      )}
    >
      <div className="flex items-start gap-2.5">
        {passed ? (
          <Check size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-student" aria-hidden />
        ) : (
          <CircleX
            size={16}
            strokeWidth={1.8}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{title}</span>
          {reason && <span className="text-fg-secondary text-pretty">{reason}</span>}
        </div>
      </div>
      {rows.length > 0 && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 pl-[26px] text-sm">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-fg-muted">{row.label}</dt>
              <dd className="m-0 break-words font-mono">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </div>
  );
}
