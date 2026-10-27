import type { Job } from '@architect/shared';

/**
 * The date the agent works as of, YYYY-MM-DD: the job's business date when it has one (its
 * records are a snapshot from that day), otherwise the local calendar date at `now`. Training,
 * evaluation and the workspace all go through this, so they always agree.
 */
export function todayFor(job: Pick<Job, 'businessDate'>, now: Date = new Date()): string {
  if (job.businessDate !== undefined) return job.businessDate;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
