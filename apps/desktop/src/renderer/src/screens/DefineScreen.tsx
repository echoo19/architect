import { useState } from 'react';
import type { Job } from '@architect/shared';
import { Badge, Button, ErrorState, Heading, Skeleton, Stat } from '@architect/ui';
import { Check, CircleMinus, HardDrive } from 'lucide-react';
import { architect } from '../api/client';
import { useJob } from '../api/hooks';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

/** Step two: the drafted job, what the agent will and won't do, and when it counts as ready. */
export function DefineScreen({ jobId }: { jobId: string }) {
  const job = useJob(jobId);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    const run = await attempt("Couldn't start training", () =>
      architect().runs.start(jobId, { method: 'architect' }),
    );
    setStarting(false);
    if (run) navigate(paths.train(run.id));
  };

  return (
    <FlowShell
      title={job.status === 'success' ? job.data.name : 'New agent'}
      step="Define"
      footer={
        job.status === 'success' && (
          <div className="mx-auto flex max-w-[880px] justify-end gap-2">
            <Button onClick={() => navigate(paths.newAgent())}>Back</Button>
            <Button variant="primary" loading={starting} onClick={start}>
              Start training
            </Button>
          </div>
        )
      }
    >
      <div className="mx-auto box-content flex max-w-[880px] flex-col gap-12 px-8 pb-10 pt-14">
        {job.status === 'loading' && <DefineSkeleton />}
        {job.status === 'error' && (
          <ErrorState
            title="Couldn't open this job"
            message={job.error.message}
            onRetry={job.reload}
            secondaryAction={
              <Button size="md" onClick={() => navigate(paths.home())}>
                Back to agents
              </Button>
            }
            className="min-h-[60vh]"
          />
        )}
        {job.status === 'success' && <JobOverview job={job.data} />}
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
    </div>
  );
}

function JobOverview({ job }: { job: Job }) {
  const { passRate, p95LatencyMs } = job.requirements;
  return (
    <>
      <div className="flex flex-col gap-3.5">
        <Heading as="h1" size="display">
          {job.name}
        </Heading>
        <p className="m-0 max-w-[620px] text-xl text-fg-secondary text-pretty">
          {job.summary ?? job.description}
        </p>
        <Badge
          tone="neutral"
          size="lg"
          icon={<HardDrive size={14} strokeWidth={1.6} aria-hidden />}
          className="self-start"
        >
          Runs offline on {deviceInSentence(currentPlatform())}
        </Badge>
      </div>

      {(job.does.length > 0 || job.doesNot.length > 0) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] overflow-hidden rounded-3xl border border-line-card bg-card">
          <ul
            aria-label="It will"
            className="m-0 flex list-none flex-col gap-3.5 px-7 py-[26px] text-md"
          >
            {job.does.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
          <ul
            aria-label="It won't"
            className="m-0 flex list-none flex-col gap-3.5 border-l border-line-card bg-list px-7 py-[26px] text-md text-fg-secondary"
          >
            {job.doesNot.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CircleMinus
                  size={18}
                  strokeWidth={1.8}
                  className="mt-0.5 shrink-0 text-fg-muted"
                  aria-hidden
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="flex flex-col gap-[18px]">
        <Heading>Ready when</Heading>
        <div className="flex flex-wrap gap-10">
          <Stat size="lg" value={`${Math.round(passRate * 100)}%`} label="of new tasks right" />
          {p95LatencyMs !== undefined && (
            <Stat size="lg" value={`<${Math.ceil(p95LatencyMs / 1000)}s`} label="per answer" />
          )}
        </div>
      </section>
    </>
  );
}
