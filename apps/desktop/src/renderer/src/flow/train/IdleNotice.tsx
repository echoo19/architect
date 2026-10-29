import { Button } from '@architect/ui';
import { ToggleLeft } from 'lucide-react';
import { navigate, paths } from '../../lib/router';
import { modelNames } from '../names';
import type { LiveRun } from './run-state';

/**
 * Why a run ended before it began: the teacher had nothing it may change (decision 063). The job
 * turned off every way to change the agent that could run here, so no round was started and
 * nothing was spent. The engine's own sentence says which, and the job is where it is put right.
 */
export function IdleNotice({ live }: { live: LiveRun }) {
  const teacher = modelNames(live.job).mentor;
  return (
    <div
      role="status"
      aria-label={`${teacher} had nothing it may change`}
      className="flex items-start gap-3 rounded-2xl border border-line-card bg-well px-5 py-4"
    >
      <ToggleLeft size={16} className="mt-0.5 shrink-0 text-mentor" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-[260px] flex-[1_1_320px] flex-col gap-0.5">
          <span className="font-medium">{teacher} had nothing it may change</span>
          <span className="text-fg-secondary text-pretty">
            {live.run.error ?? 'Every way to change the agent was off for this run.'}
          </span>
        </div>
        <Button size="sm" onClick={() => navigate(paths.define(live.run.jobId))}>
          Back to the job
        </Button>
      </div>
    </div>
  );
}
