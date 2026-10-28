import { GuardError, type TrainingJobRecord, type TrainingJobState } from '@architect/shared';
import { formatUsd } from '../loop/budget';

/**
 * A job that has stopped running costs what it ran for, whether or not its outputs have been
 * downloaded yet; one still running may cost up to its whole authorization.
 */
const ENDED: ReadonlySet<TrainingJobState> = new Set(['succeeded', 'ready', 'failed', 'cancelled']);

/** One scope's compute spending: the line next to mentor dollars. */
export interface ComputeUsage {
  maxUsd: number;
  /** What jobs that stopped running cost. */
  spentUsd: number;
  /** What running jobs may still cost: each one's authorization until it ends. */
  reservedUsd: number;
  leftUsd: number;
  seconds: number;
  jobs: number;
}

const USD_EPSILON = 1e-9;

/** Compute spent and held in a scope, from the job records themselves. */
export function computeUsage(
  records: readonly TrainingJobRecord[],
  scope: string,
  maxUsd: number,
): ComputeUsage {
  let spentUsd = 0;
  let reservedUsd = 0;
  let seconds = 0;
  let jobs = 0;
  for (const record of records) {
    if (record.scope !== scope) continue;
    jobs += 1;
    seconds += record.compute.seconds;
    if (ENDED.has(record.state)) spentUsd += record.compute.usd;
    else reservedUsd += Math.max(record.compute.authorizedUsd, record.compute.usd);
  }
  return {
    maxUsd,
    spentUsd,
    reservedUsd,
    leftUsd: Math.max(0, maxUsd - spentUsd - reservedUsd),
    seconds,
    jobs,
  };
}

export interface ComputeAuthorization {
  seconds: number;
  usd: number;
}

/**
 * How long a new job may run: what it asks for, cut to what the budget has left at the
 * hardware's price. Throws `GuardError('budget')` when that is shorter than a useful job, so a
 * job that can't be paid for never starts. The provider stops the job at this limit too, so a
 * job can't spend past it even if this app is closed.
 */
export function authorizeCompute(
  usage: ComputeUsage,
  pricePerHourUsd: number,
  wantSeconds: number,
  minSeconds: number,
  flavorLabel: string,
): ComputeAuthorization {
  if (pricePerHourUsd === 0) return { seconds: wantSeconds, usd: 0 };
  const affordable = Math.floor(((usage.leftUsd + USD_EPSILON) / pricePerHourUsd) * 3600);
  const seconds = Math.min(wantSeconds, affordable);
  if (seconds < minSeconds) {
    throw new GuardError(
      'budget',
      `The compute budget has ${formatUsd(usage.leftUsd)} left, ${Math.floor(affordable / 60)} minutes on ${flavorLabel}; a training job needs at least ${Math.ceil(minSeconds / 60)}.`,
    );
  }
  return { seconds, usd: (seconds * pricePerHourUsd) / 3600 };
}

/** What a job has cost so far, from the time it has run. */
export function costOf(seconds: number, pricePerHourUsd: number): number {
  return (seconds * pricePerHourUsd) / 3600;
}
