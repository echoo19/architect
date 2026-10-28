import { Button, ErrorState } from '@architect/ui';
import { isFinal, problemOf } from '../lib/problems';

export interface ProblemStateProps {
  error: Error;
  /** What couldn't be done, for a failure that may pass: "Couldn't load this training run". */
  title: string;
  onRetry?: (() => void) | undefined;
  /** Where to go when asking again can't help, such as back to the agents. */
  exit?: { label: string; onClick: () => void } | undefined;
  layout?: 'block' | 'inline';
  className?: string;
}

/**
 * A failure said plainly: the cause as one sentence and the next step that helps. Something that
 * is gone leads with that and offers the way out, never a Try again that can't help; a failure
 * that passes says so and offers Try again. The precise message waits under Details, and a failure
 * without a code keeps its own message, which the engine writes for the person using the app.
 */
export function ProblemState({
  error,
  title,
  onRetry,
  exit,
  layout = 'block',
  className,
}: ProblemStateProps) {
  const problem = problemOf(error);
  const way = exit && (
    <Button size="md" onClick={exit.onClick}>
      {exit.label}
    </Button>
  );
  const shared = { layout, ...(className === undefined ? {} : { className }) } as const;
  if (problem === null) {
    return (
      <ErrorState
        title={title}
        message={error.message}
        {...(onRetry ? { onRetry } : {})}
        {...(way ? { secondaryAction: way } : {})}
        {...shared}
      />
    );
  }
  if (isFinal(problem)) {
    return (
      <ErrorState
        title={problem.cause}
        details={error.message}
        {...(way ? { secondaryAction: way } : {})}
        {...shared}
      />
    );
  }
  return (
    <ErrorState
      title={title}
      message={`${problem.cause} ${problem.next}`}
      details={error.message}
      {...(onRetry ? { onRetry } : {})}
      {...(way ? { secondaryAction: way } : {})}
      {...shared}
    />
  );
}
