import { CodedError } from '@architect/shared';
import { Button, EmptyState, Skeleton } from '@architect/ui';
import { SearchX } from 'lucide-react';
import { useExperiment } from '../api/experiments';
import { ProblemState } from '../components/ProblemState';
import { ExperimentDesign } from '../experiments/Design';
import { ExperimentView } from '../experiments/Experiment';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';

export { ExperimentsScreen } from '../experiments/ExperimentList';

/** Designing an experiment starts from the field it runs on: `jobId`'s when one is named. */
export function NewExperimentScreen({ jobId }: { jobId?: string | undefined }) {
  return <ExperimentDesign detail={null} jobId={jobId} />;
}

/**
 * An experiment by its id: its design until it is preregistered, then its live state and, once
 * released, its results. An id that isn't kept says so and leads back.
 */
export function ExperimentScreen({ experimentId }: { experimentId: string }) {
  const detail = useExperiment(experimentId);
  if (detail.data) {
    const { experiment } = detail.data;
    return experiment.preregistration === null ? (
      <ExperimentDesign key={experiment.id} detail={detail.data} />
    ) : (
      <ExperimentView detail={detail.data} />
    );
  }
  if (detail.status === 'error') {
    const back = () => navigate(paths.experiments());
    const missing =
      detail.error instanceof CodedError && detail.error.code === 'experiment_not_found';
    return (
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
            error={detail.error}
            title="Couldn't load this experiment"
            onRetry={detail.reload}
            exit={{ label: 'All experiments', onClick: back }}
          />
        )}
      </PlacePage>
    );
  }
  return (
    <PlacePage title="Experiment">
      <Skeleton className="h-64 rounded-card" />
    </PlacePage>
  );
}
