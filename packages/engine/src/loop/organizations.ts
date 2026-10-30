import { join } from 'node:path';
import { CodedError, trainOrganizations, type Job, type Task } from '@architect/shared';

/**
 * What is wrong with a job's organizations and its tasks' `org`, in a sentence, or null when
 * nothing is (decision 068). A job without organizations takes no task with one; a job with them
 * needs one it trains on, a known organization on every task, and families that stay in one.
 */
export function organizationProblem(job: Job, tasks: readonly Task[]): string | null {
  const orgs = job.organizations;
  if (orgs === undefined) {
    const named = tasks.find((task) => task.org !== undefined);
    return named === undefined
      ? null
      : `Task "${named.id}" names the organization "${named.org}", but the job lists no organizations.`;
  }
  if (trainOrganizations(job).length === 0) {
    return 'The job lists no organization to train on; give at least one the role "train".';
  }
  const ids = new Set(orgs.map((org) => org.id));
  const familyOrg = new Map<string, string>();
  for (const task of tasks) {
    if (task.org === undefined) {
      return `Task "${task.id}" names no organization; every task of a job with organizations needs one.`;
    }
    if (!ids.has(task.org)) {
      return `Task "${task.id}" names the organization "${task.org}", which the job doesn't list.`;
    }
    const before = familyOrg.get(task.family);
    if (before !== undefined && before !== task.org) {
      return `The family "${task.family}" has tasks of both "${before}" and "${task.org}"; a family stays in one organization.`;
    }
    familyOrg.set(task.family, task.org);
  }
  const untested = orgs.find(
    (org) => org.role === 'transfer' && !tasks.some((task) => task.org === org.id),
  );
  if (untested !== undefined) {
    return `${untested.name} is an organization the job never trains on, but no task is for it, so nothing would test it.`;
  }
  return null;
}

/** Refuses a job whose organizations and tasks don't fit together, saying why. */
export function checkOrganizations(job: Job, tasks: readonly Task[]): void {
  const problem = organizationProblem(job, tasks);
  if (problem !== null) throw new CodedError('not_a_job', problem);
}

/** An organization's files in a job folder: `orgs/<id>/data/`. */
export function orgDataDir(jobDir: string, orgId: string): string {
  return join(jobDir, 'orgs', orgId, 'data');
}

/**
 * The folder whose files stand for the job's data where one folder is needed: a new graduate's
 * own copy and its table columns. The job's `data/`, or its first train organization's files.
 */
export function primaryDataDir(jobDir: string, job: Pick<Job, 'organizations'>): string {
  const [first] = trainOrganizations(job);
  return first === undefined ? join(jobDir, 'data') : orgDataDir(jobDir, first.id);
}

/**
 * The folder a task's `data/` binds to: the job's `data/`, or its organization's files. `sealed`
 * holds the folders of organizations the job never trains on, which only the locked test has.
 */
export function taskDataDir(
  jobDir: string,
  task: Pick<Task, 'org'>,
  sealed?: Readonly<Record<string, string>>,
): string {
  if (task.org === undefined) return join(jobDir, 'data');
  const own = sealed !== undefined && Object.hasOwn(sealed, task.org);
  return own ? (sealed[task.org] as string) : orgDataDir(jobDir, task.org);
}
