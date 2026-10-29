import { studentPricing, type Job, type StudentTarget } from '@architect/shared';
import { aboutUsd, formatAbout, testSeconds, testUsd } from './estimates';

/** What the agent is called afterwards, said once for each place the final test can run. */
export const FINAL_TEST_MARKS: Record<StudentTarget, string> = {
  local: 'The agent is marked ready when it passes.',
  hosted: 'The agent is marked as tested online. You can test it on this computer later.',
};

function tasks(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

/**
 * How long the final test takes where it runs, and what it costs: "About 2.5 hours for 60 tasks ·
 * Free" on this computer, "About 15 minutes for 60 tasks · About $0.20" on the online copy. A copy
 * with no price says no price, rather than a cost it can't know.
 */
export function finalTestFacts(job: Job, place: StudentTarget): string {
  const time = `${formatAbout(testSeconds(job, place))} for ${tasks(job.splits.test)}`;
  if (place === 'local') return `${time} · Free`;
  const pricing = job.student.hosted ? studentPricing(job.student.hosted) : undefined;
  return pricing === undefined ? time : `${time} · ${aboutUsd(testUsd(job, pricing))}`;
}
