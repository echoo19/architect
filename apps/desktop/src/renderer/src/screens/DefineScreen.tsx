import { useEffect, useState } from 'react';
import type { Job, Method } from '@architect/shared';
import { Button, Skeleton, toast } from '@architect/ui';
import { SlidersHorizontal } from 'lucide-react';
import { flowApi } from '../api/client';
import { useJob, useJobs, useSecretsStatus, useSettings } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { resetDraft, useDraftStore } from '../flow/describe/draft-store';
import { AdvancedDialog, tabWithIssue, type AdvancedTab } from '../flow/define/AdvancedDialog';
import { hostedAvailability, type KeyStatus } from '../flow/define/hosted';
import { Capabilities, FilePermissions, JobHeader, ReadyWhen } from '../flow/define/JobOverview';
import { TrainingPlace } from '../flow/define/TrainingPlace';
import { useJobEditor } from '../flow/define/use-job-editor';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

const BASELINES: readonly Method[] = ['bare', 'one_shot', 'self_reflection'];

/** Step two: the drafted job, what it will and won't do, when it's ready, and where it trains. */
export function DefineScreen({ jobId }: { jobId: string }) {
  const job = useJob(jobId);
  if (job.status === 'success') return <DefineEditor key={job.data.id} initial={job.data} />;
  return (
    <FlowShell title="New agent" step="Define">
      <div className="mx-auto box-content flex max-w-[880px] flex-col gap-12 px-8 pb-10 pt-14">
        {job.status === 'loading' ? (
          <DefineSkeleton />
        ) : (
          <ProblemState
            error={job.error}
            title="Couldn't open this job"
            onRetry={job.reload}
            exit={{ label: 'Back to agents', onClick: () => navigate(paths.home()) }}
            className="min-h-[60vh]"
          />
        )}
      </div>
    </FlowShell>
  );
}

function DefineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the job" className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-4 w-[520px] max-w-full" />
        <Skeleton shape="pill" className="h-[30px] w-48" />
      </div>
      <Skeleton className="h-[188px] w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-12">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-[118px] w-full rounded-2xl" />
    </div>
  );
}

function keyStatus(query: ReturnType<typeof useSecretsStatus>): KeyStatus {
  if (query.status === 'success') return query.data;
  return query.status;
}

function DefineEditor({ initial }: { initial: Job }) {
  const summaries = useJobs();
  const taskCount = summaries.data?.find((summary) => summary.id === initial.id)?.taskCount ?? null;
  const editor = useJobEditor(initial, taskCount);
  const { job } = editor;
  const settings = useSettings();
  const secrets = useSecretsStatus();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tab, setTab] = useState<AdvancedTab>('tasks');
  const [withBaselines, setWithBaselines] = useState(false);
  const [starting, setStarting] = useState(false);

  const comparisonMode = settings.data?.comparisonMode === true;
  const hosted = hostedAvailability(job.student, keyStatus(secrets));

  // Keys can be added in Settings at any time, so check again whenever a job opens.
  const { reload: reloadKeys } = secrets;
  useEffect(() => reloadKeys(), [reloadKeys]);

  // A conversation that didn't draft this job is abandoned once another job is open.
  useEffect(() => {
    const { saved, entries } = useDraftStore.getState().conversation;
    if (entries.length > 0 && saved?.jobId !== initial.id) resetDraft();
  }, [initial.id]);

  const openAdvanced = (at: AdvancedTab) => {
    setTab(at);
    setAdvancedOpen(true);
  };

  const start = async () => {
    if (job.student.trainOn === 'hosted' && !hosted.available) {
      toast({
        tone: 'danger',
        title: "Can't train on the hosted copy yet",
        description: hosted.reason,
      });
      return;
    }
    setStarting(true);
    const saved = await editor.flush();
    if (!saved) {
      setStarting(false);
      const problem = tabWithIssue(editor.issues);
      if (problem) {
        toast({ tone: 'danger', title: 'Fix the marked fields in Advanced settings first' });
        openAdvanced(problem);
      }
      return;
    }
    const run = await attempt("Couldn't start training", () =>
      flowApi.startRun(saved.id, { method: 'architect' }),
    );
    if (run && comparisonMode && withBaselines) {
      // The baselines reuse the Architect run's seed, so the four runs compare like for like.
      await attempt("Couldn't start the comparison baselines", () =>
        Promise.all(
          BASELINES.map((method) => flowApi.startRun(saved.id, { method, seed: run.seed })),
        ),
      );
    }
    setStarting(false);
    if (!run) return;
    resetDraft();
    navigate(paths.train(run.id));
  };

  return (
    <FlowShell
      title={job.name}
      step="Define"
      footer={
        <div className="mx-auto flex max-w-[880px] flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" className="-ml-3" onClick={() => openAdvanced(tab)}>
            <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden />
            Advanced settings
          </Button>
          <div className="flex items-center gap-2">
            <span className="mr-2 text-sm text-fg-muted">Keep Architect open while it trains</span>
            <Button onClick={() => navigate(paths.newAgent())}>Back</Button>
            <Button variant="primary" loading={starting} onClick={() => void start()}>
              Start training
            </Button>
          </div>
        </div>
      }
    >
      <div className="mx-auto box-content flex max-w-[880px] flex-col gap-12 px-8 pb-10 pt-14">
        <JobHeader job={job} />
        <Capabilities job={job} />
        <TrainingPlace
          job={job}
          hosted={hosted}
          onPlaceChange={(trainOn) =>
            editor.change((current) => ({ ...current, student: { ...current.student, trainOn } }))
          }
          onCapChange={(maxMentorUsd) =>
            editor.change(
              (current) => ({ ...current, budget: { ...current.budget, maxMentorUsd } }),
              400,
            )
          }
          onRetryKeys={secrets.status === 'error' ? reloadKeys : undefined}
          onRaiseLimit={() => openAdvanced('budget')}
          baselines={
            comparisonMode
              ? { checked: withBaselines, onCheckedChange: setWithBaselines }
              : undefined
          }
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-12 border-t border-line-card pt-10">
          <ReadyWhen job={job} />
          <FilePermissions
            job={job}
            onChange={(permissions) => editor.change((current) => ({ ...current, permissions }))}
          />
        </div>
      </div>
      <AdvancedDialog
        open={advancedOpen}
        onOpenChange={(open) => {
          setAdvancedOpen(open);
          if (!open) void editor.flush();
        }}
        tab={tab}
        onTabChange={setTab}
        editor={editor}
        summaries={summaries}
      />
    </FlowShell>
  );
}
