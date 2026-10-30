import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskSchema, type Job, type Organization } from '@architect/shared';

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
  return {
    organizations,
    orgOf: new Map(
      tasks.flatMap((task) => (task.org === undefined ? [] : [[task.id, task.org] as const])),
    ),
    lockedTests: job.splits.test + transferTasks.length,
  };
}

/** The locked test's tasks per run, as the runner set it from the job's folder. */
export function lockedTestsOf(job: Job, config: { lockedTests?: number }): number {
  return config.lockedTests ?? job.splits.test;
}
