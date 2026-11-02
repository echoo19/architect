import type { Job } from '@architect/shared';
import { minutesForHalfRounds, minutesForOneRound, trainsTooSlow } from './estimates';
import { withIntervention } from './teacher-menu';

/**
 * A job as it is first made, drafted or from a sample, with defaults that fit it, so its Define
 * opens ready to train. Its time limit is raised where the place it trains can't fit a round in
 * it, to one Budget has nothing to say about, and retraining the student is left off where the
 * job has no compute to spend on it. A job that already fits comes back as it was, the same
 * object. Changes the person makes later are theirs: the callout and Budget say what they cost.
 */
export function withFittingDefaults(job: Job): Job {
  let next = job;
  if (trainsTooSlow(job)) {
    const place = job.student.trainOn;
    const minutes = minutesForHalfRounds(job, place) ?? minutesForOneRound(job, place);
    if (minutes !== null) next = { ...next, budget: { ...next.budget, maxWallMinutes: minutes } };
  }
  // A job that never chose what the teacher may change allows everything, retraining included.
  if (job.interventions === undefined && (job.budget.maxComputeUsd ?? 0) <= 0) {
    next = withIntervention(next, 'weights', false);
  }
  return next;
}
