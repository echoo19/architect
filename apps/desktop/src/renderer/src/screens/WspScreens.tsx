import { CodedError } from '@architect/shared';
import { Button, EmptyState, Skeleton } from '@architect/ui';
import { SearchX } from 'lucide-react';
import { useWspExperiment } from '../api/wsp';
import { ProblemState } from '../components/ProblemState';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';
import { WorkspaceShell } from '../shell/WorkspaceShell';
import { ExperimentView } from '../wsp/ExperimentView';
import { inBrief } from '../wsp/model';
import { BriefFlow, NewExperiment } from '../wsp/NewExperiment';

export { WspHome as WspHomeScreen } from '../wsp/WspHome';

/** A new experiment, in the flow's own window, from its model to its brief. */
export function WspNewScreen() {
  return <NewExperiment />;
}

/**
 * An experiment by its id: its brief in the flow until it starts, then its run and results beside
 * the sidebar. An id that isn't kept says so and leads back.
 */
export function WspExperimentScreen({ experimentId }: { experimentId: string }) {
  const experiment = useWspExperiment(experimentId);
  const route = { name: 'wsp-experiment', experimentId } as const;
  if (experiment.data && inBrief(experiment.data)) {
    return <BriefFlow key={experiment.data.id} experiment={experiment.data} />;
  }
  let page;
  if (experiment.data) {
    page = <ExperimentView experiment={experiment.data} />;
  } else if (experiment.status === 'error') {
    const back = () => navigate(paths.home());
    const missing =
      experiment.error instanceof CodedError && experiment.error.code === 'experiment_not_found';
    page = (
      <PlacePage title="Experiment">
        {missing ? (
          <EmptyState
            icon={<SearchX aria-hidden />}
            title="This experiment isn't here"
            description={`Nothing on this computer is called ${experimentId}.`}
            className="pt-16"
            actions={
              <Button size="md" onClick={back}>
                All experiments
              </Button>
            }
          />
        ) : (
          <ProblemState
            error={experiment.error}
            title="Couldn't load this experiment"
            onRetry={experiment.reload}
            exit={{ label: 'All experiments', onClick: back }}
          />
        )}
      </PlacePage>
    );
  } else {
    page = (
      <PlacePage title="Experiment">
        <Skeleton className="h-64 rounded-card" />
      </PlacePage>
    );
  }
  return <WorkspaceShell route={route}>{page}</WorkspaceShell>;
}
