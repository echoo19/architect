import type { Job, Method, Round } from '@architect/shared';
import type { LiveRun } from './run-state';

/**
 * Whether a round wrote a whole draft of the agent's instructions instead of one watched change
 * (decision 026): the one-shot method's only round, and the first round of a run that starts from
 * a blank harness. A draft makes no practice attempts and is kept without a keep check. Round 1 of
 * a blank start that did practice is from before drafts, and stays an ordinary change.
 */
export function isDraftRound(
  round: Pick<Round, 'index' | 'status' | 'train'>,
  method: Method,
  job: Pick<Job, 'startingHarness'>,
): boolean {
  if (round.status === 'attempting' || round.train.total > 0) return false;
  if (method === 'one_shot') return true;
  return (
    round.index === 1 &&
    job.startingHarness.kind === 'blank' &&
    (method === 'architect' || method === 'self_reflection')
  );
}

/** The index of the run's draft round, or null when it has none. */
export function draftRoundOf({ rounds, run, job }: LiveRun): number | null {
  return rounds.find((round) => isDraftRound(round, run.method, job))?.index ?? null;
}
