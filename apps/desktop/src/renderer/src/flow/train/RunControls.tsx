import { useState } from 'react';
import type { RunStatus } from '@architect/shared';
import { Button, Dialog, DialogClose, DialogContent, DialogFooter, Spinner } from '@architect/ui';
import { ArrowRight, Pause, Play, Square } from 'lucide-react';
import { architect } from '../../api/client';
import { attempt } from '../../lib/notify';
import { navigate, paths } from '../../lib/router';
import { useAgentSettingsUi } from '../../workspace/settings/agentSettingsUi';
import { modelNames } from '../names';
import { setupOf } from './draft';
import { hasKeptChange, type LiveRun } from './run-state';

interface Request {
  action: 'pause' | 'resume';
  /** The status the run had when asked; the request is pending until that changes. */
  from: RunStatus;
}

/**
 * Pause or resume and stop while training; the way forward once it has ended. An improvement
 * can be stopped at any point, even while it writes its new version, and ends on what changed.
 */
export function RunControls({ live, onStop }: { live: LiveRun; onStop: () => void }) {
  const { run, improves } = live;
  const [request, setRequest] = useState<Request | null>(null);
  const pending = request?.from === run.status ? request.action : null;
  const showSettings = useAgentSettingsUi((state) => state.show);

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
      return improves ? (
        <Button size="md" variant="primary" onClick={() => navigate(paths.improvement(run.id))}>
          See what changed
          <ArrowRight size={15} strokeWidth={2} aria-hidden />
        </Button>
      ) : (
        <Button size="md" variant="primary" onClick={() => navigate(paths.report(run.id))}>
          See the results
          <ArrowRight size={15} strokeWidth={2} aria-hidden />
        </Button>
      );
    case 'stopped':
    case 'failed':
      return improves ? (
        <Button
          size="md"
          onClick={() => {
            navigate(paths.home());
            showSettings(improves.graduateId, 'teaching');
          }}
        >
          Back to Teaching
        </Button>
      ) : (
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
      {(run.status !== 'testing' || improves) && (
        <Button size="md" onClick={onStop}>
          <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
          Stop
        </Button>
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
        description: `Training ends after the step in progress. ${live.job.name} keeps its best version so far (${best}), and ${student} takes the ${test}-task final test without ${mentor}.`,
        confirm: 'Stop and run the final test',
      }
    : {
        title: 'Stop training?',
        description:
          'Training ends after the step in progress. No change is kept yet, so this run makes no agent.',
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
