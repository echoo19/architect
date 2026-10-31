import type { ExperimentEnvironment } from '../../src/experiments/service';
import { systemClock } from '../../src/loop/deps';
import { comparisonWorld } from './comparison-world';
import { BRIEF, fieldJob, ORGANIZATIONS } from './field-comparison';

export interface ExperimentWorld {
  /** The returns desk as a field of four desks, two of them sealed, as a job folder. */
  jobDir: string;
  /** The names of the sealed desks, which nothing printed before a release may carry. */
  sealedNames: string[];
  /** The environment experiments run in: fakes only, so nothing calls a model or spends. */
  environment(dataDir: string, log: (line: string) => void): ExperimentEnvironment;
  close(): Promise<void>;
}

/**
 * Everything an experiment needs to run with fakes: a field folder, Spark's brief of its desks,
 * and the comparisons runner's fake environment. For tests in other packages (the command line's).
 */
export function experimentWorld(): ExperimentWorld {
  const world = comparisonWorld({ clock: systemClock });
  const drafting = world.mentor.script;
  world.mentor.script = (request, call) =>
    request.json?.name === 'study_brief' ? BRIEF : drafting(request, call);
  return {
    jobDir: fieldJob(world).dir,
    sealedNames: ORGANIZATIONS.filter((org) => org.role === 'transfer').map((org) => org.name),
    environment: () => ({ env: world.env, close: async () => undefined }),
    close: () => world.close(),
  };
}
