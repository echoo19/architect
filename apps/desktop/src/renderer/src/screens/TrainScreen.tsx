import type { Round, RunDetail } from '@architect/shared';
import {
  Button,
  cn,
  ErrorState,
  Meter,
  Panel,
  PanelHeader,
  PanelRow,
  Skeleton,
  Spinner,
  Stat,
} from '@architect/ui';
import { ArrowRight, Pause, Play, Square } from 'lucide-react';
import { architect } from '../api/client';
import { useRunDetail } from '../api/hooks';
import { formatClock, formatPercent, formatUsd, percentOf } from '../lib/format';
import { mentorName } from '../lib/names';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

const FINISHED = new Set(['stopped', 'finished', 'failed']);

/** Step three: the mentor teaching the student, round by round. */
export function TrainScreen({ runId }: { runId: string }) {
  const detail = useRunDetail(runId);
  const run = detail.data?.run;
  const live = run && !FINISHED.has(run.status) ? run : undefined;

  const control = (verb: string, action: () => Promise<void>) => async () => {
    await attempt(`Couldn't ${verb} training`, action);
    detail.reload();
  };

  return (
    <FlowShell
      title={detail.data?.job.name ?? 'Training'}
      step="Train"
      actions={
        live && (
          <>
            {live.status === 'paused' ? (
              <Button size="md" onClick={control('resume', () => architect().runs.resume(runId))}>
                <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                Resume
              </Button>
            ) : (
              <Button size="md" onClick={control('pause', () => architect().runs.pause(runId))}>
                <Pause size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                Pause
              </Button>
            )}
            <Button size="md" onClick={control('stop', () => architect().runs.stop(runId))}>
              <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
              Stop
            </Button>
          </>
        )
      }
    >
      <div className="mx-auto box-content flex max-w-[1320px] flex-col gap-5 px-8 pb-12 pt-8">
        {detail.status === 'loading' && <TrainSkeleton />}
        {detail.status === 'error' && (
          <ErrorState
            title="Couldn't load this training run"
            message={detail.error.message}
            onRetry={detail.reload}
            secondaryAction={
              <Button size="md" onClick={() => navigate(paths.home())}>
                Back to agents
              </Button>
            }
            className="min-h-[60vh]"
          />
        )}
        {detail.status === 'success' && <TrainOverview detail={detail.data} />}
      </div>
    </FlowShell>
  );
}

function TrainSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the run" className="flex flex-col gap-5">
      {['h-[320px]', 'h-[300px]'].map((height) => (
        <div key={height} className="flex flex-wrap gap-5">
          <Skeleton className={cn('min-w-0 flex-[7_1_560px] rounded-6xl', height)} />
          <Skeleton className={cn('min-w-0 flex-[5_1_360px] rounded-6xl', height)} />
        </div>
      ))}
    </div>
  );
}

interface BudgetRowProps {
  label: string;
  used: string;
  max: string;
  fraction: number;
}

function BudgetRow({ label, used, max, fraction }: BudgetRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-fg-secondary">{label}</span>
        <span className="font-mono">
          {used} <span className="text-fg-muted">/ {max}</span>
        </span>
      </div>
      <Meter label={label} value={fraction} valueText={`${used} of ${max}`} />
    </div>
  );
}

function RoundRow({ round }: { round: Round }) {
  const reverted = round.decision === 'reverted';
  return (
    <PanelRow className={cn('grid-cols-[28px_minmax(0,1fr)_auto]', reverted && 'text-fg-muted')}>
      <span className="font-mono text-fg-secondary">{String(round.index).padStart(2, '0')}</span>
      <span className={cn('truncate', reverted && 'line-through decoration-fg-ghost')}>
        {round.title ?? 'Diagnosing'}
      </span>
      {round.devBefore && round.devAfter ? (
        <span className="font-mono text-sm">
          {percentOf(round.devBefore)} → {percentOf(round.devAfter)}
        </span>
      ) : round.status === 'failed' ? (
        <span className="text-sm text-danger">Failed</span>
      ) : (
        <Spinner tone="mentor" label="In progress" />
      )}
    </PanelRow>
  );
}

function TrainOverview({ detail }: { detail: RunDetail }) {
  const { run, job, rounds } = detail;
  const score = run.devCurrent ?? run.devBaseline;
  const budget = job.budget;
  const mentor = mentorName(job.mentor);

  return (
    <>
      <div className="flex flex-wrap gap-5">
        <Panel padded aria-label="Task success" className="min-w-0 flex-[7_1_560px]">
          <Stat
            size="xl"
            value={score ? formatPercent(score) : '–'}
            label="of practice tasks right"
            note={`Ready at ${Math.round(job.requirements.passRate * 100)}%`}
          />
        </Panel>
        <Panel padded aria-label="Budget" className="min-w-0 flex-[5_1_360px] justify-between">
          <BudgetRow
            label="Rounds"
            used={String(run.totals.rounds)}
            max={String(budget.maxRounds)}
            fraction={run.totals.rounds / budget.maxRounds}
          />
          <BudgetRow
            label={mentor}
            used={formatUsd(run.totals.mentorUsd)}
            max={formatUsd(budget.maxMentorUsd)}
            fraction={budget.maxMentorUsd === 0 ? 1 : run.totals.mentorUsd / budget.maxMentorUsd}
          />
          <BudgetRow
            label="Time"
            used={formatClock(run.totals.wallMs)}
            max={formatClock(budget.maxWallMinutes * 60_000)}
            fraction={run.totals.wallMs / (budget.maxWallMinutes * 60_000)}
          />
        </Panel>
      </div>

      <Panel aria-label="Rounds">
        <PanelHeader title="Rounds" />
        {rounds.length === 0 && (
          <PanelRow className="text-fg-secondary">
            The first round starts once {mentor} has seen the baseline.
          </PanelRow>
        )}
        {[...rounds].reverse().map((round) => (
          <RoundRow key={round.index} round={round} />
        ))}
        {run.status === 'finished' && (
          <button
            type="button"
            onClick={() => navigate(paths.report(run.id))}
            className="flex min-h-[54px] items-center justify-end gap-2 border-t border-line-row px-7 text-fg-secondary transition-colors duration-150 hover:text-fg"
          >
            See the report
            <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </button>
        )}
      </Panel>
    </>
  );
}
