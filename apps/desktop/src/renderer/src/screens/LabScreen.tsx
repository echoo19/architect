import type { GraduateSummary, JobSummary } from '@architect/shared';
import { Button, CardGrid, cn, EmptyState, Skeleton } from '@architect/ui';
import { LayoutGrid } from 'lucide-react';
import { useGraduates, useJobs, useSettings } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { SampleJobButton } from '../flow/describe/SampleJobButton';
import { ReadyMadeAgentButton } from '../import/ReadyMadeAgentButton';
import {
  AgentsCard,
  FieldsCard,
  FinishedCard,
  NeedsYouCard,
  RunningCard,
  SpendCard,
} from '../lab/cards';
import { finishedRuns, runningRuns } from '../lab/items';
import { mentorName, studentName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';

/**
 * The Lab: what waits for the person and what is running, side by side as the focal point, then
 * what just finished, what it cost, the fields and the agents. A fresh install shows the ways in.
 */
export function LabScreen() {
  const graduates = useGraduates();
  const jobs = useJobs();
  const failed = graduates.status === 'error' ? graduates : jobs.status === 'error' ? jobs : null;

  if (failed?.error) {
    return (
      <PlacePage title="Lab">
        <ProblemState
          error={failed.error}
          title="Couldn't load the lab"
          onRetry={() => {
            graduates.reload();
            jobs.reload();
          }}
          exit={{ label: 'New agent', onClick: () => navigate(paths.newAgent()) }}
          className="pt-16"
        />
      </PlacePage>
    );
  }
  if (!graduates.data || !jobs.data) {
    return (
      <PlacePage title="Lab">
        <LabSkeleton />
      </PlacePage>
    );
  }
  if (graduates.data.length === 0 && jobs.data.length === 0) {
    return (
      <PlacePage title="Lab">
        <NothingYet />
      </PlacePage>
    );
  }
  return (
    <PlacePage title="Lab">
      <LabBoard jobs={jobs.data} graduates={graduates.data} />
    </PlacePage>
  );
}

/** Both rows share one set of columns, so their edges line up: a wide one and a narrower one. */
const COLUMNS =
  'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';

function LabBoard({
  jobs,
  graduates,
}: {
  jobs: readonly JobSummary[];
  graduates: readonly GraduateSummary[];
}) {
  const running = runningRuns(jobs);
  const finished = finishedRuns(jobs);
  return (
    <div className="flex flex-col gap-4">
      <CardGrid className={cn(COLUMNS, 'items-stretch')}>
        <NeedsYouCard jobs={jobs} graduates={graduates} />
        <RunningCard rows={running} />
      </CardGrid>
      <CardGrid className={COLUMNS}>
        <FinishedCard rows={finished} />
        <SpendCard rows={[...running, ...finished].slice(0, 3)} />
        <FieldsCard jobs={jobs} />
        <AgentsCard graduates={graduates} />
      </CardGrid>
    </div>
  );
}

function LabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the lab" className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-56 rounded-card" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-44 rounded-card" />
        <Skeleton className="h-44 rounded-card" />
      </div>
    </div>
  );
}

/** A fresh install: nothing made, nothing running. Each way in starts the flow. */
function NothingYet() {
  const settings = useSettings();
  const pitch =
    settings.status === 'success'
      ? `Describe a field, and ${mentorName(settings.data.defaultMentor)} teaches ${studentName(
          settings.data.defaultStudent,
        )} to work in it, then tests it on organizations it never saw.`
      : 'Describe a field, and Architect teaches an agent to work in it.';
  return (
    <EmptyState
      icon={<LayoutGrid aria-hidden />}
      title="Nothing in the lab yet"
      description={pitch}
      className="pt-20"
      actions={
        <>
          <Button variant="primary" size="md" onClick={() => navigate(paths.newAgent())}>
            Describe a field
          </Button>
          <SampleJobButton size="md" sample="academy" />
          <SampleJobButton size="md" />
          <ReadyMadeAgentButton size="md" />
        </>
      }
    />
  );
}
