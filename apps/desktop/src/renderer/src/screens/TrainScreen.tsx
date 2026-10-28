import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Finding, ListedAttempt, ListedLesson, Round, RunStatus } from '@architect/shared';
import { Button, cn, Drawer, DrawerContent, ErrorState, Skeleton } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import {
  mentoringApi,
  mentoringKeys,
  useMentoringRecords,
  type MentoringRecords,
} from '../api/mentoring';
import { useQuery, type QueryState } from '../api/query';
import { rate } from '../flow/format';
import { modelNames, typeLabel } from '../flow/names';
import { Apprenticeship } from '../flow/train/Apprenticeship';
import { CurrentRound } from '../flow/train/CurrentRound';
import { providerName } from '../flow/define/hosted';
import { draftRoundOf, setupOf } from '../flow/train/draft';
import { Examples } from '../flow/train/Examples';
import { LatestAttempts } from '../flow/train/LatestAttempts';
import { findingNotes, lessonNotes, type StepNote } from '../flow/train/lesson-steps';
import { LessonDrawerContent } from '../flow/train/LessonView';
import { phaseView } from '../flow/train/phase';
import { Resources } from '../flow/train/Resources';
import { RoundDrawerContent, type RoundEvidence } from '../flow/train/RoundDrawer';
import { Rounds, type RoundsFooter } from '../flow/train/Rounds';
import { RunControls, StopDialog } from '../flow/train/RunControls';
import { activeProgress, currentRound, hasKeptChange, type LiveRun } from '../flow/train/run-state';
import { TaskSuccess } from '../flow/train/TaskSuccess';
import { TaughtLessons } from '../flow/train/TaughtLessons';
import { StepsSkeleton, TraceDrawerContent } from '../flow/train/TraceDrawer';
import { useLiveRun } from '../flow/train/use-live-run';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { FlowShell, IMPROVE_STEPS } from '../shell/FlowShell';
import { StopImprovementDialog } from '../workspace/teach/StopImprovement';

/** Statuses in which the run is doing something right now. */
const WORKING: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'stopping', 'testing']);

/** Scrolled further than this, the user is reading something and isn't moved to the report. */
const SCROLLED_AWAY_PX = 80;

/** What the drawer shows. One view can lead to another: a round to an example to an attempt. */
type DrawerView =
  | { kind: 'attempt'; attempt: ListedAttempt; openAt?: number; notes?: StepNote[] }
  | { kind: 'finding'; attemptId: string; openAt: number; notes: StepNote[] }
  | { kind: 'round'; index: number }
  | { kind: 'lesson'; lessonId: string };

/** The drawer's views, newest last. It stays set while the drawer animates closed. */
function useDrawerStack() {
  const [state, setState] = useState<{ stack: DrawerView[]; open: boolean }>({
    stack: [],
    open: false,
  });
  const show = useCallback((view: DrawerView) => setState({ stack: [view], open: true }), []);
  const push = useCallback(
    (view: DrawerView) => setState((current) => ({ stack: [...current.stack, view], open: true })),
    [],
  );
  const back = useCallback(
    () => setState((current) => ({ ...current, stack: current.stack.slice(0, -1) })),
    [],
  );
  const hide = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  return { ...state, top: state.stack.at(-1) ?? null, show, push, back, hide };
}

/**
 * Step three: the mentor teaching the student, live, round by round. An improvement of an agent
 * runs here too, under the lessons it teaches, and ends in a new version instead of a final test.
 */
export function TrainScreen({ runId }: { runId: string }) {
  const { state, retry } = useLiveRun(runId);
  const live = state.status === 'live' ? state.live : null;
  const drawer = useDrawerStack();
  const [stopping, setStopping] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const reading = drawer.open || stopping;
  const improving = live?.improves ?? null;

  useReportWhenFinished(live, contentRef, reading);

  return (
    <FlowShell<string>
      title={live?.job.name ?? 'Training'}
      step={improving ? 'Improve' : 'Train'}
      {...(improving ? { steps: IMPROVE_STEPS } : {})}
      actions={live && <RunControls live={live} onStop={() => setStopping(true)} />}
    >
      <div
        ref={contentRef}
        className="mx-auto box-content flex max-w-[1320px] flex-col gap-5 px-8 pb-12 pt-8"
      >
        {state.status === 'loading' && <TrainSkeleton />}
        {state.status === 'error' && (
          <ErrorState
            title="Couldn't load this training run"
            message={state.error.message}
            onRetry={retry}
            secondaryAction={
              <Button size="md" onClick={() => navigate(paths.home())}>
                Back to agents
              </Button>
            }
            className="min-h-[60vh]"
          />
        )}
        {live && <LiveTraining live={live} drawer={drawer} />}
      </div>
      {live &&
        (live.improves ? (
          <StopImprovementDialog
            open={stopping}
            runId={live.run.id}
            writing={live.run.status === 'testing' || live.run.phase === 'testing'}
            kept={hasKeptChange(live.rounds)}
            onClose={() => setStopping(false)}
          />
        ) : (
          <StopDialog open={stopping} live={live} onClose={() => setStopping(false)} />
        ))}
    </FlowShell>
  );
}

type DrawerStack = ReturnType<typeof useDrawerStack>;

/** The board and its drawer, which read the run's mentoring records together. */
function LiveTraining({ live, drawer }: { live: LiveRun; drawer: DrawerStack }) {
  const records = useMentoringRecords(live.run.id, live.job.id);
  return (
    <>
      <TrainBoard
        live={live}
        records={records}
        onOpenAttempt={(attempt) => drawer.show({ kind: 'attempt', attempt })}
        onOpenRound={(round) => drawer.show({ kind: 'round', index: round.index })}
        onOpenLesson={(lesson) => drawer.show({ kind: 'lesson', lessonId: lesson.id })}
      />
      <Drawer
        open={drawer.open && drawer.top !== null}
        onOpenChange={(next) => !next && drawer.hide()}
      >
        {drawer.top && (
          <DrawerBody live={live} records={records} view={drawer.top} drawer={drawer} />
        )}
      </Drawer>
    </>
  );
}

function DrawerBody({
  live,
  records,
  view,
  drawer,
}: {
  live: LiveRun;
  records: QueryState<MentoringRecords>;
  view: DrawerView;
  drawer: DrawerStack;
}) {
  const names = modelNames(live.job);
  const onBack = drawer.stack.length > 1 ? drawer.back : undefined;
  const openFinding = (finding: Finding) =>
    drawer.push({
      kind: 'finding',
      attemptId: finding.attemptId,
      openAt: finding.failureTurn,
      notes: findingNotes(finding),
    });
  switch (view.kind) {
    case 'attempt':
      return (
        <TraceDrawerContent
          attempt={view.attempt}
          type={typeLabel(live.job, view.attempt.taskType)}
          names={names}
          setup={setupOf(live, view.attempt.harnessVersion)}
          {...(view.openAt === undefined ? {} : { openAt: view.openAt })}
          {...(view.notes === undefined ? {} : { notes: view.notes })}
          onBack={onBack}
        />
      );
    case 'finding':
      return <FindingAttempt live={live} view={view} onBack={onBack} />;
    case 'round': {
      const round = live.rounds.find((item) => item.index === view.index);
      if (!round) return null;
      return (
        <RoundDrawerContent
          runId={live.run.id}
          round={round}
          draft={round.index === draftRoundOf(live)}
          job={live.job}
          lineage={live.lineage.find((entry) => entry.round === round.index)}
          names={names}
          evidence={roundEvidence(records, round.index)}
          onOpenLesson={(lesson) => drawer.push({ kind: 'lesson', lessonId: lesson.id })}
          onOpenFinding={openFinding}
          onBack={onBack}
        />
      );
    }
    case 'lesson': {
      const lesson = records.data?.lessons.find((item) => item.id === view.lessonId);
      if (!lesson) return null;
      return (
        <LessonDrawerContent
          lesson={lesson}
          job={live.job}
          names={names}
          onOpenAttempt={(attemptId, step) =>
            drawer.push({ kind: 'finding', attemptId, openAt: step, notes: lessonNotes(lesson) })
          }
          onBack={onBack}
        />
      );
    }
  }
}

/** A round's records, picked out of the run's. */
function roundEvidence(
  records: QueryState<MentoringRecords>,
  index: number,
):
  | { status: 'loading' }
  | { status: 'error'; error: Error; reload: () => void }
  | { status: 'success'; data: RoundEvidence } {
  if (records.data === undefined) {
    return records.status === 'error'
      ? { status: 'error', error: records.error, reload: records.reload }
      : { status: 'loading' };
  }
  const { experiments, interventions, lessons, categories } = records.data;
  return {
    status: 'success',
    data: {
      experiment: experiments.find((item) => item.round === index),
      intervention: interventions.find((item) => item.round === index),
      lessons: lessons.filter((item) => item.round === index),
      categories,
    },
  };
}

/** The attempt a finding names, read by its id, opened at the step the finding points to. */
function FindingAttempt({
  live,
  view,
  onBack,
}: {
  live: LiveRun;
  view: Extract<DrawerView, { kind: 'finding' }>;
  onBack: (() => void) | undefined;
}) {
  const attempt = useQuery(mentoringKeys.attempt(view.attemptId), () =>
    mentoringApi.attempt(view.attemptId),
  );
  if (attempt.status !== 'success') {
    return (
      <DrawerContent title="Attempt" onBack={onBack}>
        {attempt.status === 'loading' ? (
          <StepsSkeleton />
        ) : (
          <ErrorState
            layout="inline"
            title="Couldn't open this attempt"
            message={attempt.error.message}
            onRetry={attempt.reload}
          />
        )}
      </DrawerContent>
    );
  }
  return (
    <TraceDrawerContent
      attempt={attempt.data}
      type={typeLabel(live.job, attempt.data.taskType)}
      names={modelNames(live.job)}
      setup={setupOf(live, attempt.data.harnessVersion)}
      openAt={view.openAt}
      notes={view.notes}
      onBack={onBack}
    />
  );
}

/**
 * When the run finishes while this screen is open, opens the report card, unless the user has
 * scrolled down to read or has something open. A run that was already finished stays put.
 */
function useReportWhenFinished(
  live: LiveRun | null,
  contentRef: RefObject<HTMLDivElement | null>,
  reading: boolean,
): void {
  const status = live?.run.status ?? null;
  const runId = live?.run.id ?? null;
  const improving = (live?.improves ?? null) !== null;
  const previous = useRef<RunStatus | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (!runId || status !== 'finished' || before === null || before === 'finished') return;
    const scroller = contentRef.current?.closest('main');
    const atTop = !scroller || scroller.scrollTop < SCROLLED_AWAY_PX;
    if (atTop && !reading) navigate(improving ? paths.improvement(runId) : paths.report(runId));
  }, [status, runId, contentRef, reading, improving]);
}

/** Where the student is running now: a hosted copy only practices; the final test runs here. */
function studentPlace({ run, job }: LiveRun): string {
  const testing = run.status === 'testing' || run.phase === 'testing';
  if (!testing && job.student.trainOn === 'hosted') {
    return `on ${job.student.hosted ? providerName(job.student.hosted) : 'a hosted copy'}`;
  }
  return `on ${deviceInSentence(currentPlatform())}`;
}

function TrainBoard({
  live,
  records,
  onOpenAttempt,
  onOpenRound,
  onOpenLesson,
}: {
  live: LiveRun;
  records: QueryState<MentoringRecords>;
  onOpenAttempt: (attempt: ListedAttempt) => void;
  onOpenRound: (round: Round) => void;
  onOpenLesson: (lesson: ListedLesson) => void;
}) {
  const { run, job, improves } = live;
  const names = modelNames(job);
  const draft = draftRoundOf(live);
  const drafting = draft !== null && currentRound(live)?.index === draft;
  const view = phaseView(run, names, drafting, improves !== null);
  const score = run.devCurrent ?? run.devBaseline;
  let footer: RoundsFooter | null = null;
  if (run.status === 'finished') {
    footer = improves
      ? { label: 'See what changed', onClick: () => navigate(paths.improvement(run.id)) }
      : { label: 'See the report card', onClick: () => navigate(paths.report(run.id)) };
  }
  const evidence = records.data ?? null;
  const failure =
    records.status === 'error' && evidence === null
      ? { message: records.error.message, reload: records.reload }
      : null;
  const round = currentRound(live);
  return (
    <>
      {improves && <TaughtLessons improves={improves} />}
      {run.status === 'failed' && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-danger-line bg-danger-tint px-5 py-4"
        >
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">
              {improves ? 'Improving stopped on an error' : 'Training stopped on an error'}
            </span>
            <span className="text-fg-secondary text-pretty">
              {run.error ?? 'The engine reported a failure without a message.'}
            </span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-5">
        <Apprenticeship
          mentor={names.mentor}
          student={names.student}
          studentPlace={studentPlace(live)}
          view={view}
          drafting={drafting}
          passRate={score ? rate(score) / 100 : null}
          progress={activeProgress(live)}
        />
        <CurrentRound
          live={live}
          round={round}
          names={names}
          experiment={evidence?.experiments.find((item) => item.round === round?.index)}
          recordsFailed={failure !== null}
        />
      </div>
      <div className="flex flex-wrap gap-5">
        <TaskSuccess live={live} names={names} />
        <Resources
          live={live}
          mentor={names.mentor}
          records={evidence}
          recordsFailed={failure !== null}
        />
      </div>
      <div className="flex flex-wrap gap-5">
        <Examples job={job} records={records} onOpen={onOpenLesson} />
        <Rounds
          job={job}
          rounds={live.rounds}
          running={WORKING.has(run.status)}
          draftRound={draft}
          records={evidence}
          failure={failure}
          stopReason={run.stopReason}
          onOpen={onOpenRound}
          footer={footer}
        />
      </div>
      <div className="flex flex-wrap gap-5">
        <LatestAttempts
          job={job}
          attempts={live.attempts}
          mentor={names.mentor}
          onOpen={onOpenAttempt}
        />
      </div>
    </>
  );
}

function TrainSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the run" className="flex flex-col gap-5">
      {['h-[378px]', 'h-[368px]', 'h-[330px]'].map((height) => (
        <div key={height} className="flex flex-wrap gap-5">
          <Skeleton className={cn('min-w-0 flex-[7_1_560px] rounded-6xl', height)} />
          <Skeleton className={cn('min-w-0 flex-[5_1_360px] rounded-6xl', height)} />
        </div>
      ))}
    </div>
  );
}
