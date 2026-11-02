import type { GraduateSummary, JobSummary } from '@architect/shared';
import { Button, EmptyState, Skeleton, Stagger } from '@architect/ui';
import { LayoutGrid } from 'lucide-react';
import { useExperiments } from '../api/experiments';
import { useGraduates, useJobs, useSettings } from '../api/hooks';
import { useTeams } from '../api/teams';
import { ProblemState } from '../components/ProblemState';
import { newField } from '../fields/new-field';
import { SampleJobButton, ScienceLabButton } from '../flow/describe/SampleJobButton';
import { ReadyMadeAgentButton } from '../import/ReadyMadeAgentButton';
import {
  ExperimentsCard,
  FieldsCard,
  FinishedCard,
  HeroResultCard,
  NeedsYouCard,
  RunningCard,
  SpendCard,
} from '../lab/cards';
import { finishedRuns, runningExperiments, runningRuns } from '../lab/items';
import { mentorName, studentName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';

/**
 * What Architect does, in one line under the Lab's title, with the two models introduced by role
 * where they first appear.
 */
function useStory(): string | undefined {
  const settings = useSettings();
  if (settings.status !== 'success') return undefined;
  const mentor = mentorName(settings.data.defaultMentor);
  const student = studentName(settings.data.defaultStudent);
  return `${mentor}, a frontier model, engineers the harness of ${student}, a small open model, and fine-tunes it on your organizations' work; each specialist is judged on tests sealed from both and runs on-premise.`;
}

/**
 * The Lab: the newest result first, then what waits for the person and what is running side by
 * side, what else finished, the fields, the experiments and what it cost. A fresh install shows
 * the ways in.
 */
export function LabScreen() {
  const graduates = useGraduates();
  const jobs = useJobs();
  const story = useStory();
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
    <PlacePage title="Lab" lede={story}>
      <LabBoard jobs={jobs.data} graduates={graduates.data} />
    </PlacePage>
  );
}

/**
 * The newest result across the page, then two columns, a wide one and a narrower one, each a
 * stack of cards at its own height: what needs the person, what else finished and the fields at
 * the left; what runs, the experiments and what it cost at the right. A short card never
 * stretches to match the one beside it. The agents are in the sidebar, so not here again.
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
  const [newest, ...earlier] = finished;
  const settings = useSettings();
  const mentor =
    settings.status === 'success' ? mentorName(settings.data.defaultMentor) : undefined;
  // The Lab still shows the rest when experiments can't be read; their card says why.
  const experiments = useExperiments();
  const records = experiments.data ?? [];
  // A team that can't be read is said so in the sidebar; the Lab shows the rest without it.
  const teams = useTeams().data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {newest && (
        <Stagger>
          <HeroResultCard row={newest} mentor={mentor} />
        </Stagger>
      )}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Stagger className={COLUMN}>
          <NeedsYouCard jobs={jobs} graduates={graduates} teams={teams} experiments={records} />
          {(earlier.length > 0 || !newest) && <FinishedCard rows={earlier} />}
          <FieldsCard jobs={jobs} />
        </Stagger>
        <Stagger className={COLUMN}>
          <RunningCard rows={running} experiments={runningExperiments(records)} />
          <ExperimentsCard
            experiments={experiments.data}
            error={experiments.status === 'error' ? experiments.error : null}
            onRetry={experiments.reload}
          />
          <SpendCard rows={[...running, ...finished].slice(0, 3)} />
        </Stagger>
      </div>
    </div>
  );
}

function LabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the lab" className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-56 rounded-card" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-44 rounded-card" />
        <Skeleton className="h-44 rounded-card" />
      </div>
    </div>
  );
}

/**
 * A fresh install: nothing made, nothing running. One short line says what to do next and who
 * does the engineering; each way in starts the flow.
 */
function NothingYet() {
  const settings = useSettings();
  const mentor =
    settings.status === 'success' ? mentorName(settings.data.defaultMentor) : 'Architect';
  const pitch = `Describe a field, and ${mentor} engineers a specialist for it.`;
  return (
    <EmptyState
      icon={<LayoutGrid aria-hidden />}
      title="Nothing in the lab yet"
      description={pitch}
      className="pt-20"
      actions={
        <>
          <Button variant="primary" size="md" onClick={newField}>
            Describe a field
          </Button>
          <SampleJobButton size="md" sample="academy" />
          <ScienceLabButton size="md" />
          <SampleJobButton size="md" />
          <ReadyMadeAgentButton size="md" />
        </>
      }
    />
  );
}
