import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Round, RunStatus } from '@architect/shared';
import { Button, cn, Drawer, ErrorState, Skeleton } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { rate } from '../flow/format';
import { modelNames, typeLabel } from '../flow/names';
import { Apprenticeship } from '../flow/train/Apprenticeship';
import { CurrentRound } from '../flow/train/CurrentRound';
import { providerName } from '../flow/define/hosted';
import { draftRoundOf, setupOf } from '../flow/train/draft';
import { Examples } from '../flow/train/Examples';
import { phaseView } from '../flow/train/phase';
import { Resources } from '../flow/train/Resources';
import { RoundDrawerContent } from '../flow/train/RoundDrawer';
import { Rounds, type RoundsFooter } from '../flow/train/Rounds';
import { RunControls, StopDialog } from '../flow/train/RunControls';
import {
  activeProgress,
  currentRound,
  type LiveRun,
  type RecentAttempt,
} from '../flow/train/run-state';
import { TaskSuccess } from '../flow/train/TaskSuccess';
import { TraceDrawerContent } from '../flow/train/TraceDrawer';
import { useLiveRun } from '../flow/train/use-live-run';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

/** Statuses in which the run is doing something right now. */
const WORKING: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'stopping', 'testing']);

/** Scrolled further than this, the user is reading something and isn't moved to the report. */
const SCROLLED_AWAY_PX = 80;

/** What an overlay shows. It stays set while the overlay animates closed. */
function useOverlay<T>() {
  const [state, setState] = useState<{ item: T | null; open: boolean }>({
    item: null,
    open: false,
  });
  const show = useCallback((item: T) => setState({ item, open: true }), []);
  const hide = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  return { item: state.item, open: state.open, show, hide };
}

/** Step three: the mentor teaching the student, live, round by round. */
export function TrainScreen({ runId }: { runId: string }) {
  const { state, retry } = useLiveRun(runId);
  const live = state.status === 'live' ? state.live : null;
  const trace = useOverlay<RecentAttempt>();
  const round = useOverlay<number>();
  const stop = useOverlay<true>();
  const contentRef = useRef<HTMLDivElement>(null);
  const reading = trace.open || round.open || stop.open;

  useReportWhenFinished(live, contentRef, reading);

  return (
    <FlowShell
      title={live?.job.name ?? 'Training'}
      step="Train"
      actions={live && <RunControls live={live} onStop={() => stop.show(true)} />}
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
        {live && (
          <TrainBoard
            live={live}
            onOpenAttempt={trace.show}
            onOpenRound={(opened) => round.show(opened.index)}
          />
        )}
      </div>
      {live && (
        <>
          <Drawer open={trace.open} onOpenChange={(open) => !open && trace.hide()}>
            {trace.item && (
              <TraceDrawerContent
                attempt={trace.item}
                type={typeLabel(live.job, trace.item.taskType)}
                names={modelNames(live.job)}
                setup={setupOf(live, trace.item.harnessVersion)}
              />
            )}
          </Drawer>
          <RoundDrawer live={live} index={round.item} open={round.open} onClose={round.hide} />
          <StopDialog open={stop.open} live={live} onClose={stop.hide} />
        </>
      )}
    </FlowShell>
  );
}

function RoundDrawer({
  live,
  index,
  open,
  onClose,
}: {
  live: LiveRun;
  index: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const round = live.rounds.find((item) => item.index === index) ?? null;
  return (
    <Drawer open={open && round !== null} onOpenChange={(next) => !next && onClose()}>
      {round && (
        <RoundDrawerContent
          runId={live.run.id}
          round={round}
          draft={round.index === draftRoundOf(live)}
          job={live.job}
          lineage={live.lineage.find((entry) => entry.round === round.index)}
          names={modelNames(live.job)}
        />
      )}
    </Drawer>
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
  const previous = useRef<RunStatus | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = status;
    if (!runId || status !== 'finished' || before === null || before === 'finished') return;
    const scroller = contentRef.current?.closest('main');
    const atTop = !scroller || scroller.scrollTop < SCROLLED_AWAY_PX;
    if (atTop && !reading) navigate(paths.report(runId));
  }, [status, runId, contentRef, reading]);
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
  onOpenAttempt,
  onOpenRound,
}: {
  live: LiveRun;
  onOpenAttempt: (attempt: RecentAttempt) => void;
  onOpenRound: (round: Round) => void;
}) {
  const { run, job } = live;
  const names = modelNames(job);
  const draft = draftRoundOf(live);
  const drafting = draft !== null && currentRound(live)?.index === draft;
  const view = phaseView(run, names, drafting);
  const score = run.devCurrent ?? run.devBaseline;
  let footer: RoundsFooter | null = null;
  if (run.status === 'finished') {
    footer = { label: 'See the report card', onClick: () => navigate(paths.report(run.id)) };
  }

  return (
    <>
      {run.status === 'failed' && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-danger-line bg-danger-tint px-5 py-4"
        >
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Training stopped on an error</span>
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
        <CurrentRound live={live} round={currentRound(live)} names={names} />
      </div>
      <div className="flex flex-wrap gap-5">
        <TaskSuccess live={live} />
        <Resources live={live} mentor={names.mentor} />
      </div>
      <div className="flex flex-wrap gap-5">
        <Examples job={job} attempts={live.attempts} mentor={names.mentor} onOpen={onOpenAttempt} />
        <Rounds
          rounds={live.rounds}
          running={WORKING.has(run.status)}
          draftRound={draft}
          onOpen={onOpenRound}
          footer={footer}
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
