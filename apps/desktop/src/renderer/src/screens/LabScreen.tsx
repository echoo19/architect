import type { GraduateSummary, JobSummary } from '@architect/shared';
import { Button, EmptyState, Skeleton, Stagger } from '@architect/ui';
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
          title={failed === graduates ? "Couldn't load your agents" : "Couldn't load your runs"}
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

/**
 * Two columns, a wide one and a narrower one, each a stack of cards at its own height: what needs
 * the person, what finished and the fields at the left; what runs, what it cost and the agents at
 * the right. A short card never stretches to match the one beside it.
 */
const COLUMN = 'flex min-w-0 flex-col gap-4';

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
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Stagger className={COLUMN}>
        <NeedsYouCard jobs={jobs} graduates={graduates} />
        <FinishedCard rows={finished} />
        <FieldsCard jobs={jobs} />
      </Stagger>
      <Stagger className={COLUMN}>
        <RunningCard rows={running} />
        <SpendCard rows={[...running, ...finished].slice(0, 3)} />
        <AgentsCard graduates={graduates} />
      </Stagger>
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

/**
 * A fresh install: nothing made, nothing running. One line says what a field is and who the two
 * models are; each way in starts the flow.
 */
function NothingYet() {
  const settings = useSettings();
  const pitch =
    settings.status === 'success'
      ? `A field is one kind of work that many organizations do, like tutoring at academies. ${mentorName(
          settings.data.defaultMentor,
        )}, the teacher model, teaches ${studentName(
          settings.data.defaultStudent,
        )}, the small model on this computer, to do it, then tests it on organizations it never saw.`
      : 'A field is one kind of work that many organizations do. Architect teaches an agent to do it, then tests it on organizations it never saw.';
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
          <SampleJobButton size="md" sample="sweep-desk" />
          <SampleJobButton size="md" />
          <ReadyMadeAgentButton size="md" />
        </>
      }
    />
  );
}
