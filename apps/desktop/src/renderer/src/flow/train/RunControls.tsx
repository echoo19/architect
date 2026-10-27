import { useState } from 'react';
import type { RunStatus } from '@architect/shared';
import { Button, Dialog, DialogClose, DialogContent, DialogFooter, Spinner } from '@architect/ui';
import { ArrowRight, Pause, Play, Square } from 'lucide-react';
import { architect } from '../../api/client';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { modelNames } from '../names';
import { hasKeptChange, type LiveRun } from './run-state';

export type StopIntent = 'stop' | 'skip';

interface Request {
  action: 'pause' | 'resume';
  /** The status the run had when asked; the request is pending until that changes. */
  from: RunStatus;
}

/** Pause or resume and stop while training; the way forward once it has ended. */
export function RunControls({
  live,
  onStop,
}: {
  live: LiveRun;
  onStop: (intent: StopIntent) => void;
}) {
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
      )}
      {run.status !== 'testing' && (
        <Button size="md" onClick={() => onStop('stop')}>
          <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
          Stop
        </Button>
      )}
    </>
  );
}

/**
 * Stopping ends training after the current step. The engine then runs the locked test when a
 * change was kept, so "Skip to graduation" and "Stop" lead to the same place.
 */
export function StopDialog({
  intent,
  open,
  live,
  onClose,
}: {
  /** What the user asked for; kept while the dialog animates closed. */
  intent: StopIntent | null;
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

  const copy =
    intent === 'skip'
      ? {
          title: 'Skip to graduation?',
          description: `Training stops after the current step. Then ${student} takes the ${test}-task final test with ${mentor} disconnected, and you get the report card.`,
          confirm: 'Skip to the final test',
        }
      : kept
        ? {
            title: 'Stop training?',
            description: `Training stops after the current step. ${student} still takes the final test with what it has learned so far, so you get a report card.`,
            confirm: 'Stop training',
          }
        : {
            title: 'Stop training?',
            description:
              "Training stops after the current step. No change has been kept yet, so there's nothing to test and no report card.",
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
