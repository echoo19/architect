import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskSchema, type Job, type Organization } from '@architect/shared';
import { agreementSeeds } from '../certify/agreement';
import { calibrationSize, certifyAttempts } from '../certify/settings';
import type { StoredAttempt } from '../store/records';

/**
 * A job's organizations as its own folder lists them (decision 068), read by the runner only:
 * the library's copy of the job drops the ones it never trains on, and they are sealed with the
 * locked test.
 */
export interface Field {
  /** Every organization the job file lists, the sealed ones included; none for a one-org job. */
  organizations: readonly Organization[];
  /** Each task's organization, by task id. */
  orgOf: ReadonlyMap<string, string>;
  /**
   * The locked test's tasks per run: the test split of the organizations it trains on, and every
   * task of each organization it never trains on.
   */
  lockedTests: number;
  /** What a certified job's locked test adds: its k attempts at each calibration and test task. */
  certifyAttempts: number;
}

/** Reads a job folder's organizations and its tasks' organizations. */
export function fieldOf(jobDir: string, job: Job): Field {
  const organizations = job.organizations ?? [];
  const tasks = readFileSync(join(jobDir, 'tasks.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => TaskSchema.parse(JSON.parse(line)));
  const sealed = new Set(
    organizations.filter((org) => org.role === 'transfer').map((org) => org.id),
  );
  const transferTasks = tasks.filter((task) => task.org !== undefined && sealed.has(task.org));
  const lockedTests = job.splits.test + transferTasks.length;
  return {
    organizations,
    orgOf: new Map(
      tasks.flatMap((task) => (task.org === undefined ? [] : [[task.id, task.org] as const])),
    ),
    lockedTests,
    certifyAttempts: certifyAttempts(
      job,
      lockedTests,
      calibrationSize(job, tasks.length - transferTasks.length),
    ),
  };
}

/** The locked test's tasks per run, as the runner set it from the job's folder. */
export function lockedTestsOf(job: Job, config: { lockedTests?: number }): number {
  return config.lockedTests ?? job.splits.test;
}

/** Every attempt a run's final test makes: its first seed's and a certified job's k attempts. */
export function finalTestAttemptsOf(
  job: Job,
  config: { lockedTests?: number; certifyAttempts?: number },
): number {
  return lockedTestsOf(job, config) + (config.certifyAttempts ?? 0);
}

/**
 * The attempts a frozen run's final test still has to make, given those it made: each locked-test
 * and sealed-calibration attempt under the first seed and, for a certified job, the k - 1
 * agreement seeds drawn from it (decision 077). A repeat's seeds are funded on their own.
 */
export function finalTestAttemptsLeft(
  job: Job,
  config: { lockedTests?: number; certifyAttempts?: number },
  firstSeed: number | undefined,
  made: readonly Pick<StoredAttempt, 'split' | 'seed'>[],
): number {
  if (firstSeed === undefined) return finalTestAttemptsOf(job, config);
  const seeds = agreementSeeds(firstSeed, job.evaluation.certify?.k ?? 1);
  const done = made.filter(
    (attempt) =>
      (attempt.split === 'test' || attempt.split === 'certify') && seeds.includes(attempt.seed),
  );
  return Math.max(0, finalTestAttemptsOf(job, config) - done.length);
}
