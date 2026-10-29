import { useEffect, useState } from 'react';
import {
  isBaselineMethod,
  MethodSchema,
  type Job,
  type Method,
  type StudentTarget,
} from '@architect/shared';
import { Button, Skeleton, toast } from '@architect/ui';
import { SlidersHorizontal } from 'lucide-react';
import { flowApi } from '../api/client';
import { useJob, useJobs, useSettings, useTaskPlan } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { resetDraft, useDraftStore } from '../flow/describe/draft-store';
import { AdvancedDialog, tabWithIssue, type AdvancedTab } from '../flow/define/AdvancedDialog';
import { hostedAvailability } from '../flow/define/hosted';
import { Capabilities, FilePermissions, JobHeader, ReadyWhen } from '../flow/define/JobOverview';
import { RuleReview } from '../flow/define/RuleReview';
import { trainingWait, waitLine } from '../flow/define/rule-words';
import { RunNeeds } from '../flow/define/RunNeeds';
import { TrainingPlace } from '../flow/define/TrainingPlace';
import { useJobEditor } from '../flow/define/use-job-editor';
import { usePreflight } from '../flow/define/use-preflight';
import { AddKeyDialog } from '../settings/models/AddKeyDialog';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

/** The simpler versions a comparison trains beside the agent: every method but the agent's own. */
const BASELINES: readonly Method[] = MethodSchema.options.filter(isBaselineMethod);

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

function DefineEditor({ initial }: { initial: Job }) {
  const summaries = useJobs();
  // A job just made, imported or drafted isn't in a list read before it, and its task count says
  // whether its tasks were split: read the list again whenever a job opens.
  const { reload: reloadJobs } = summaries;
  useEffect(() => reloadJobs(), [reloadJobs]);
  const taskCount = summaries.data?.find((summary) => summary.id === initial.id)?.taskCount ?? null;
  const editor = useJobEditor(initial, taskCount);
  const taskPlan = useTaskPlan(initial.id);
  // Whether the job has a rule to confirm is in its plan, so training waits until it is read.
  const wait = trainingWait(taskPlan);
  const { job } = editor;
  const settings = useSettings();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tab, setTab] = useState<AdvancedTab>('tasks');
  const [withBaselines, setWithBaselines] = useState(false);
  const [starting, setStarting] = useState(false);
  // Where the final test runs belongs to the run, not to the job: on this computer unless chosen.
  const [testPlace, setTestPlace] = useState<StudentTarget>('local');

  const comparisonMode = settings.data?.comparisonMode === true;

  const openAdvanced = (at: AdvancedTab) => {
    setTab(at);
    setAdvancedOpen(true);
  };
  const preflight = usePreflight(job, testPlace, openAdvanced);
  const hosted = hostedAvailability(job.student, preflight.keys);

  // With no online copy there is nothing for the final test to run on.
  const hasCopy = job.student.hosted !== undefined;
  useEffect(() => {
    if (!hasCopy) setTestPlace('local');
  }, [hasCopy]);

  // The records can change under a confirmed rule, so read the plan again whenever a job opens.
  const { reload: reloadPlan } = taskPlan;
  useEffect(() => reloadPlan(), [reloadPlan]);

  // A conversation that didn't draft this job is abandoned once another job is open.
  useEffect(() => {
    const { saved, entries } = useDraftStore.getState().conversation;
    if (entries.length > 0 && saved?.jobId !== initial.id) resetDraft();
  }, [initial.id]);

  const start = async () => {
    if (preflight.blocked || wait !== null) return;
    setStarting(true);
    // The online copy is asked now, so a run that can't reach it stops here and says so, instead
    // of failing hours into its training.
    const usesCopy = job.student.trainOn === 'hosted' || testPlace === 'hosted';
    if (usesCopy && !(await preflight.askHosted())) {
      setStarting(false);
      return;
    }
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
    // Someone is here to answer, so Spark may stop to ask one question while it teaches.
    const run = await attempt("Couldn't start training", () =>
      flowApi.startRun(saved.id, {
        method: 'architect',
        lockedTestOn: testPlace,
        interactive: true,
      }),
    );
    if (run && comparisonMode && withBaselines) {
      // The baselines reuse the Architect run's seed and take the final test in the same place, so
      // the four runs compare like for like.
      await attempt("Couldn't start the comparison baselines", () =>
        Promise.all(
          BASELINES.map((method) =>
            flowApi.startRun(saved.id, { method, seed: run.seed, lockedTestOn: testPlace }),
          ),
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
            <span className="mr-2 text-sm text-fg-muted">
              {waitLine(wait) ??
                (preflight.needs.length > 0
                  ? preflight.summary
                  : 'Keep Architect open while it trains')}
            </span>
            <Button onClick={() => navigate(paths.newAgent())}>Back</Button>
            <Button
              variant="primary"
              loading={starting}
              disabled={preflight.blocked || wait !== null}
              onClick={() => void start()}
            >
              Start training
            </Button>
          </div>
        </div>
      }
    >
      <div className="mx-auto box-content flex max-w-[880px] flex-col gap-12 px-8 pb-10 pt-14">
        <JobHeader job={job} />
        <Capabilities job={job} />
        <RunNeeds needs={preflight.needs} onAction={preflight.act} busyId={preflight.busyId} />
        {taskPlan.status === 'error' && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-danger-line px-6 py-5"
          >
            <p className="m-0 max-w-[560px] text-pretty">
              {`Couldn't check whether this job has a rule to confirm: ${taskPlan.error.message} Training can't start until it is checked.`}
            </p>
            <Button onClick={taskPlan.reload}>Try again</Button>
          </div>
        )}
        {taskPlan.data && taskPlan.status !== 'error' && (
          <RuleReview job={job} plan={taskPlan.data} />
        )}
        <TrainingPlace
          job={job}
          hosted={hosted}
          testPlace={testPlace}
          onPlaceChange={(trainOn) =>
            editor.change((current) => ({ ...current, student: { ...current.student, trainOn } }))
          }
          onCapChange={(maxMentorUsd) =>
            editor.change(
              (current) => ({ ...current, budget: { ...current.budget, maxMentorUsd } }),
              400,
            )
          }
          onRetryKeys={preflight.keys === 'error' ? preflight.reloadKeys : undefined}
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
        taskCount={taskCount}
        finalTest={{ place: testPlace, onPlaceChange: setTestPlace, hosted }}
      />
      {preflight.adding !== null && (
        <AddKeyDialog
          key={preflight.adding}
          open
          onOpenChange={(open) => {
            if (!open) preflight.stopAdding();
          }}
          provider={preflight.adding}
        />
      )}
    </FlowShell>
  );
}
