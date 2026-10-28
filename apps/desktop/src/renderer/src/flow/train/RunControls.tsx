import { useState } from 'react';
import type { RunStatus } from '@architect/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Spinner,
  Tooltip,
} from '@architect/ui';
import { ArrowRight, Pause, Play, Square } from 'lucide-react';
import { architect } from '../../api/client';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { modelNames } from '../names';
import { setupOf } from './draft';
import { hasKeptChange, type LiveRun } from './run-state';

interface Request {
  action: 'pause' | 'resume';
  /** The status the run had when asked; the request is pending until that changes. */
  from: RunStatus;
}

/** Pause or resume and stop while training; the way forward once it has ended. */
export function RunControls({ live, onStop }: { live: LiveRun; onStop: () => void }) {
  const { run } = live;
  const [request, setRequest] = useState<Request | null>(null);
  const pending = request?.from === run.status ? request.action : null;

  const ask = async (action: Request['action']) => {
    setRequest({ action, from: run.status });
    const sent = await attempt(`Couldn't ${action} training`, async () => {
      await (action === 'pause' ? architect().runs.pause(run.id) : architect().runs.resume(run.id));
      return true;
    });
    if (!sent) setRequest(null);
  };

  switch (run.status) {
    case 'finished':
      return (
        <Button size="md" variant="primary" onClick={() => navigate(paths.report(run.id))}>
          See the report card
          <ArrowRight size={15} strokeWidth={2} aria-hidden />
        </Button>
      );
    case 'stopped':
    case 'failed':
      return (
        <Button size="md" onClick={() => navigate(paths.define(run.jobId))}>
          Back to the job
        </Button>
      );
    case 'stopping':
      return (
        <Button size="md" disabled>
          <Spinner size={13} />
          Stopping
        </Button>
      );
  }

  return (
    <>
      {run.status === 'paused' ? (
        <Button size="md" loading={pending === 'resume'} onClick={() => void ask('resume')}>
          {pending !== 'resume' && (
            <Play size={13} fill="currentColor" strokeWidth={0} aria-hidden />
          )}
          {pending === 'resume' ? 'Resuming' : 'Resume'}
        </Button>
      ) : (
        <Tooltip content="Holds training after the step in progress. Paused time doesn't count.">
          <Button
            size="md"
            loading={pending === 'pause'}
            disabled={run.status === 'queued'}
            onClick={() => void ask('pause')}
          >
            {pending !== 'pause' && (
              <Pause size={13} fill="currentColor" strokeWidth={0} aria-hidden />
            )}
            {pending === 'pause' ? 'Pausing' : 'Pause'}
          </Button>
        </Tooltip>
      )}
      {run.status !== 'testing' && (
        <Tooltip
          content={
            hasKeptChange(live.rounds)
              ? 'Ends training; the best version so far takes the final test and becomes your agent.'
              : 'Ends training. No change is kept yet, so this run makes no agent.'
          }
        >
          <Button size="md" onClick={onStop}>
            <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
            Stop
          </Button>
        </Tooltip>
      )}
    </>
  );
}

/**
 * Stopping ends training after the step in progress. The engine then runs the locked test on the
 * last kept version when a change was kept, and that version graduates; with nothing kept, the
 * run just ends.
 */
export function StopDialog({
  open,
  live,
  onClose,
}: {
  open: boolean;
  live: LiveRun;
  onClose: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const { mentor, student } = modelNames(live.job);
  const kept = hasKeptChange(live.rounds);
  const test = live.job.splits.test;

  const stop = async () => {
    setStopping(true);
    await attempt("Couldn't stop training", () => architect().runs.stop(live.run.id));
    setStopping(false);
    onClose();
  };

  const best = setupOf(live, live.run.currentVersion);
  const copy = kept
    ? {
        title: 'Stop training?',
        description: `Training ends after the step in progress. ${live.job.name} keeps its best version so far (${best}), ${student} takes the ${test}-task final test with ${mentor} disconnected, and you get the report card and your agent.`,
        confirm: 'Stop and run the final test',
      }
    : {
        title: 'Stop training?',
        description:
          "Training ends after the step in progress. No change has been kept yet, so there's nothing to test and this run makes no agent.",
        confirm: 'Stop training',
      };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent title={copy.title} description={copy.description}>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Keep training</Button>
          </DialogClose>
          <Button
            size="md"
            variant={kept ? 'primary' : 'danger'}
            loading={stopping}
            onClick={() => void stop()}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
