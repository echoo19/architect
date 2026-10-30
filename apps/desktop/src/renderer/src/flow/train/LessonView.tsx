import { Fragment, useState, type ReactNode } from 'react';
import type { Job, ListedAttempt, ListedLesson, Trace } from '@architect/shared';
import {
  Button,
  DetailList,
  Disclosure,
  DrawerContent,
  DrawerSection,
  EvidenceMark,
  Segmented,
} from '@architect/ui';
import { ArrowRight, Check, CircleHelp, CircleX } from 'lucide-react';
import { flowApi } from '../../api/client';
import { mentoringApi, mentoringKeys } from '../../api/mentoring';
import { useQuery, type QueryState } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { formatCost, taskTitle } from '../format';
import { typeLabel } from '../names';
import { lessonOrigin, lessonStatus } from './evidence-words';
import { answerOf, correctionSteps, lessonNotes, takeoverStep } from './lesson-steps';
import type { ModelNames } from './phase';
import { Playback } from './Playback';
import { playbackSteps } from './trace-steps';
import { StepsSkeleton, VerdictBox, WholeRequest } from './TraceDrawer';

type View = 'correction' | 'original';

export interface LessonViewProps {
  lesson: ListedLesson;
  job: Job;
  names: ModelNames;
  /** Opens the attempt the lesson came from, at a step. */
  onOpenAttempt: (attemptId: string, step: number) => void;
  onBack?: (() => void) | undefined;
}

/**
 * One example in full: whether it was verified and how it was made, the failure behind it, the
 * correction step by step from the checkpoint where Spark took over, and what it cost.
 */
export function LessonDrawerContent({
  lesson,
  job,
  names,
  onOpenAttempt,
  onBack,
}: LessonViewProps) {
  const sourceId = lesson.source.kind === 'attempt' ? lesson.source.attemptId : null;
  const trace = useQuery(mentoringKeys.lessonTrace(lesson.id), () =>
    mentoringApi.lessonTrace(lesson.id),
  );
  const original = useQuery(`trace:${sourceId ?? 'none'}`, () =>
    sourceId === null ? Promise.resolve(null) : flowApi.trace(sourceId),
  );
  const attempt = useQuery(mentoringKeys.attempt(sourceId ?? 'none'), () =>
    sourceId === null ? Promise.resolve(null) : mentoringApi.attempt(sourceId),
  );
  const taskId = lesson.source.kind === 'correction' ? null : lesson.source.taskId;
  // Examples are made from practice tasks, so they carry practice's mark.
  const round = lesson.round === null ? 'Practice task' : `Practice task, round ${lesson.round}`;
  return (
    <DrawerContent
      title={
        lesson.prompt ? taskTitle(lesson.prompt) : taskId ? `Task ${taskId}` : 'Worked example'
      }
      onBack={onBack}
      subtitle={
        <>
          Worked example · {typeLabel(job, lesson.taskType)} ·{' '}
          <EvidenceMark kind="practice" className="align-[-2px]">
            {round}
          </EvidenceMark>{' '}
          · {lessonOrigin(lesson)}
        </>
      }
    >
      <div className="flex flex-col gap-7">
        {lesson.prompt && <WholeRequest prompt={lesson.prompt} />}
        <VerdictBox
          passed={lesson.status === 'verified'}
          title={`${names.mentor}'s example ${lessonStatus(lesson).toLowerCase()}`}
          reason={lesson.reason}
        />
        <BeforeAndAfter
          lesson={lesson}
          attempt={attempt.status === 'success' ? attempt.data : null}
          original={original.status === 'success' ? original.data : null}
          correction={trace}
          names={names}
        />
        {lesson.diagnosis && sourceId !== null && (
          <DrawerSection title={`${names.mentor}'s finding`} tone="mentor">
            <p className="m-0 text-body text-fg text-pretty">{lesson.diagnosis.cause}</p>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small text-fg">
              {lesson.diagnosis.evidence.map((item) => (
                <li key={`${item.turn}-${item.note}`} className="text-pretty">
                  <span className="tabular-nums text-fg">
                    {names.student}&apos;s step {item.turn}
                  </span>{' '}
                  {item.note}
                </li>
              ))}
            </ul>
            <Button
              size="md"
              className="self-start"
              onClick={() => onOpenAttempt(sourceId, lesson.diagnosis?.failureTurn ?? 1)}
            >
              Open {names.student}&apos;s attempt at step {lesson.diagnosis.failureTurn}
              <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </Button>
          </DrawerSection>
        )}
        <LessonSteps
          lesson={lesson}
          trace={trace}
          original={original}
          names={names}
          hasOriginal={sourceId !== null}
        />
        <Checked lesson={lesson} />
        <DrawerSection title="What this example cost">
          <p className="m-0 flex flex-wrap gap-x-2 text-small text-fg tabular-nums">
            <span>
              {names.mentor} {formatCost(lesson.cost.usd)}
            </span>
            <span aria-hidden>·</span>
            <span>
              {lesson.cost.calls} {lesson.cost.calls === 1 ? 'call' : 'calls'} to {names.mentor}
            </span>
          </p>
        </DrawerSection>
        <Disclosure label="Details">
          <DetailList
            items={[
              { label: 'Example', value: lesson.id },
              {
                label: 'Tokens',
                value: `${lesson.cost.inputTokens.toLocaleString('en-US')} in, ${lesson.cost.outputTokens.toLocaleString('en-US')} out`,
              },
              ...(lesson.interventionId
                ? [{ label: 'Intervention', value: lesson.interventionId }]
                : []),
              ...(sourceId ? [{ label: 'Attempt', value: sourceId }] : []),
              ...(taskId ? [{ label: 'Task', value: taskId }] : []),
              ...(lesson.categoryId ? [{ label: 'Category', value: lesson.categoryId }] : []),
              { label: 'Acted as the agent', value: lesson.actorModel },
              ...(lesson.checkpoint
                ? [
                    {
                      label: 'Checkpoint',
                      value: `step ${lesson.checkpoint.turn}, ${lesson.checkpoint.replayedCalls} calls replayed, fallback ${lesson.checkpoint.fallback}`,
                    },
                  ]
                : []),
              ...(lesson.episode
                ? [
                    { label: 'Episode', value: lesson.episode.id },
                    {
                      label: 'Trained turns',
                      value: lesson.episode.verifiedTurns.join(', '),
                    },
                  ]
                : []),
            ]}
          />
        </Disclosure>
      </div>
    </DrawerContent>
  );
}

/**
 * The student's answer, with what the checker found wrong in it, beside the correction's answer,
 * when the lesson repaired a failed attempt. Answers to the same task have the same fields, so
 * the two read side by side; an expected record needn't.
 */
function BeforeAndAfter({
  lesson,
  attempt,
  original,
  correction,
  names,
}: {
  lesson: ListedLesson;
  attempt: ListedAttempt | null;
  original: Trace | null;
  correction: QueryState<Trace | null>;
  names: ModelNames;
}) {
  if (attempt === null || original === null) return null;
  // A correction that never ran has no answer; its steps say so below.
  if (correction.status === 'success' && correction.data === null) return null;
  const before = answerOf(original.finalText) || attempt.answerSummary || '';
  const after =
    correction.status === 'success' && correction.data !== null
      ? answerOf(correction.data.finalText)
      : '';
  const answers = [
    { who: names.student, text: before },
    { who: `${names.mentor}'s correction`, text: after },
  ].filter((answer) => answer.text !== '');
  return (
    // Whose answer each is, in the title: the second is Spark's, for Glimmer to learn from.
    <DrawerSection title={`${names.student}'s answer, and ${names.mentor}'s correction`}>
      <dl className="m-0 grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 text-small">
        <AnswerRow who={names.student} passed={attempt.check.pass} note={attempt.check.reason} />
        {correction.status === 'success' && correction.data !== null && (
          <AnswerRow
            who={`${names.mentor}'s correction`}
            passed={lesson.status === 'verified'}
            note={lesson.status === 'verified' ? 'Got it right.' : 'Got it wrong.'}
          />
        )}
        {correction.status === 'error' && (
          <AnswerRow
            who={`${names.mentor}'s correction`}
            passed={null}
            note="Couldn't be read, like its steps below."
          />
        )}
      </dl>
      {/* The answers as the task's format writes them, for whoever wants to compare them. */}
      {answers.length > 0 && (
        <Disclosure label="Details">
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-small">
            {answers.map((answer) => (
              <Fragment key={answer.who}>
                <dt className="text-fg">{answer.who}</dt>
                <dd className="m-0 break-words font-mono text-fg">{answer.text}</dd>
              </Fragment>
            ))}
          </dl>
        </Disclosure>
      )}
    </DrawerSection>
  );
}

function AnswerRow({
  who,
  passed,
  note,
}: {
  who: string;
  /** Null when there is no answer to mark. */
  passed: boolean | null;
  note?: string | undefined;
}) {
  return (
    <>
      {passed === null ? (
        <CircleHelp
          size={15}
          strokeWidth={1.8}
          role="img"
          aria-label="Not read"
          className="mt-0.5 text-fg"
        />
      ) : passed ? (
        <Check
          size={15}
          strokeWidth={2.2}
          role="img"
          aria-label="Passed"
          className="mt-0.5 text-student"
        />
      ) : (
        <CircleX
          size={15}
          strokeWidth={1.8}
          role="img"
          aria-label="Failed"
          className="mt-0.5 text-danger"
        />
      )}
      <dt className="text-fg">{who}</dt>
      <dd className="m-0 flex min-w-0 flex-col gap-0.5">
        {note && <span className="text-fg text-pretty">{note}</span>}
      </dd>
    </>
  );
}

/** The correction step by step, or the student's own attempt, one at a time. */
function LessonSteps({
  lesson,
  trace,
  original,
  names,
  hasOriginal,
}: {
  lesson: ListedLesson;
  trace: QueryState<Trace | null>;
  original: QueryState<Trace | null>;
  names: ModelNames;
  hasOriginal: boolean;
}) {
  const [view, setView] = useState<View>('correction');
  const switcher = hasOriginal ? (
    <Segmented<View>
      aria-label="Which steps"
      value={view}
      onValueChange={setView}
      options={[
        { value: 'correction', label: `${names.mentor}'s correction` },
        { value: 'original', label: `${names.student}'s attempt` },
      ]}
    />
  ) : null;
  if (trace.status === 'loading' || (hasOriginal && original.status === 'loading')) {
    return <StepsSkeleton />;
  }
  const failed = trace.status === 'error' ? trace : original.status === 'error' ? original : null;
  if (failed?.error) {
    return (
      <ProblemState
        layout="inline"
        error={failed.error}
        title="Couldn't load the steps"
        onRetry={failed.reload}
      />
    );
  }
  const source = original.data ?? null;
  const correction = trace.data ?? null;
  if (view === 'original' && source !== null) {
    return (
      <div className="flex flex-col gap-3">
        {switcher}
        <Playback
          key="original"
          title={`${names.student}'s steps`}
          steps={playbackSteps(source).map((step) => ({
            step,
            actor: 'student',
            replayed: false,
          }))}
          notes={lessonNotes(lesson)}
          {...(lesson.diagnosis ? { openAt: lesson.diagnosis.failureTurn } : {})}
          mentor={names.mentor}
          student={names.student}
        />
      </div>
    );
  }
  if (correction === null) {
    return (
      <div className="flex flex-col gap-3">
        {switcher}
        <p className="m-0 text-fg text-pretty">This try never ran, so it has no steps to show.</p>
      </div>
    );
  }
  const from = takeoverStep(lesson);
  return (
    <div className="flex flex-col gap-3">
      {switcher}
      <Playback
        key="correction"
        title={`${names.mentor}'s correction`}
        steps={correctionSteps(lesson, correction, source)}
        openAt={from}
        /* The verdict and the before and after stay in view; the correction waits below. */
        revealOnOpen={false}
        replayed={
          from > 2
            ? `${names.student}'s steps 1 to ${from - 1}, replayed`
            : `${names.student}'s step 1, replayed`
        }
        takeover={
          from > 1
            ? `${names.mentor} takes over at step ${from}`
            : lesson.checkpoint?.fallback === 'full_task'
              ? `${names.mentor} does the whole task, since taking over later didn't pass`
              : `${names.mentor} does the whole task`
        }
        mentor={names.mentor}
        student={names.student}
      />
    </div>
  );
}

/** What the checker and the audit of every write said about the correction. */
function Checked({ lesson }: { lesson: ListedLesson }) {
  if (lesson.check === null && lesson.audit === null) return null;
  return (
    <DrawerSection title="Checked">
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-small">
        {lesson.check && (
          <CheckLine passed={lesson.check.pass} label="Checker">
            {lesson.check.reason}
          </CheckLine>
        )}
        {lesson.audit && (
          <CheckLine passed={lesson.audit.ok} label="Writes">
            {lesson.audit.ok
              ? lesson.audit.changed.length > 0
                ? `Changed ${lesson.audit.changed.join(', ')} and nothing else`
                : 'Changed no file'
              : lesson.audit.problems.join(' ')}
          </CheckLine>
        )}
      </ul>
    </DrawerSection>
  );
}

function CheckLine({
  passed,
  label,
  children,
}: {
  passed: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      {passed ? (
        <Check size={14} strokeWidth={2.2} aria-hidden className="mt-[3px] shrink-0 text-student" />
      ) : (
        <CircleX
          size={14}
          strokeWidth={1.8}
          aria-hidden
          className="mt-[3px] shrink-0 text-danger"
        />
      )}
      <span className="min-w-0 text-pretty">
        <span className="text-fg">{label}:</span> <span className="text-fg">{children}</span>
      </span>
    </li>
  );
}
