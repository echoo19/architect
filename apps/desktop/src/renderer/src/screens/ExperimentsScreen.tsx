import { Button, EmptyState } from '@architect/ui';
import { FlaskConical, Library, SearchX } from 'lucide-react';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';

/** Experiments: comparisons of ways of teaching, each designed, preregistered and run here. */
export function ExperimentsScreen() {
  return (
    <PlacePage title="Experiments">
      <EmptyState
        icon={<FlaskConical aria-hidden />}
        title="No experiments yet"
        description="Compare ways of teaching on one field, with the seeds and caps fixed before it runs."
        className="pt-16"
        actions={
          <Button variant="primary" size="md" onClick={() => navigate(paths.newExperiment())}>
            New experiment
          </Button>
        }
      />
    </PlacePage>
  );
}

/** Designing an experiment starts from the field it runs on. */
export function NewExperimentScreen() {
  return (
    <PlacePage title="New experiment">
      <EmptyState
        icon={<Library aria-hidden />}
        title="Choose a field to experiment on"
        description="An experiment compares arms on one field's organizations."
        className="pt-16"
        actions={
          <Button variant="primary" size="md" onClick={() => navigate(paths.fields())}>
            Open Fields
          </Button>
        }
      />
    </PlacePage>
  );
}

/** An experiment by its id. None is kept yet, so any id leads back to the list. */
export function ExperimentScreen({ experimentId }: { experimentId: string }) {
  return (
    <PlacePage title="Experiment">
      <EmptyState
        icon={<SearchX aria-hidden />}
        title="This experiment isn't here"
        description={`Nothing on this computer is called ${experimentId}.`}
        className="pt-16"
        actions={
          <Button size="md" onClick={() => navigate(paths.experiments())}>
            All experiments
          </Button>
        }
      />
    </PlacePage>
  );
}
