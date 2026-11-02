import { describe, expect, it } from 'vitest';
import { allowedInterventions } from '@architect/shared';
import {
  capShortfalls,
  estimateTime,
  minutesForHalfRounds,
  trainsTooSlow,
} from '../../../src/renderer/src/flow/define/estimates';
import { withFittingDefaults } from '../../../src/renderer/src/flow/define/new-job';
import { makeJob } from './factories';

const names = { mentor: 'Spark', student: 'Glimmer' };

describe('the defaults a new job is made with', () => {
  it('finds the limit that fits half the rounds at their shortest, in whole hours', () => {
    const job = makeJob();
    // 40 check tasks, then six rounds of at least 92 tasks, at 2.5 minutes each: 24 h 40 min.
    expect(minutesForHalfRounds(job, 'local')).toBe(1500);
    // Online, 15 seconds a task: 2 h 28 min.
    expect(minutesForHalfRounds(job, 'hosted')).toBe(180);
    // 2,000 check tasks on this computer: not even a week.
    expect(minutesForHalfRounds(makeJob({ splits: { ...job.splits, dev: 2000 } }), 'local')).toBe(
      null,
    );
  });

  it('raises a limit no round fits in, so Define opens ready to train and Budget says nothing', () => {
    const job = makeJob();
    expect(trainsTooSlow(job)).toBe(true);
    const fitted = withFittingDefaults(job);
    expect(fitted.budget.maxWallMinutes).toBe(1500);
    expect(trainsTooSlow(fitted)).toBe(false);
    expect(estimateTime(fitted, 'local').rounds.most).toBeGreaterThanOrEqual(6);
    expect(capShortfalls(fitted, names)).toEqual([]);
  });

  it('leaves a limit that fits as it is, and a job that fits as the same object', () => {
    const online = makeJob({
      student: { ...makeJob().student, trainOn: 'hosted' },
      interventions: ['procedure'],
    });
    expect(withFittingDefaults(online)).toBe(online);
  });

  it('leaves retraining the student off where there is no compute for it', () => {
    const fitted = withFittingDefaults(makeJob());
    expect(allowedInterventions(fitted)).not.toContain('weights');
    expect(allowedInterventions(fitted)).toContain('procedure');
    // With compute to spend, or a choice the job already made, it is left as it was.
    const funded = makeJob({ budget: { ...makeJob().budget, maxComputeUsd: 20 } });
    expect(allowedInterventions(withFittingDefaults(funded))).toContain('weights');
    const chosen = makeJob({ interventions: ['procedure', 'weights'] });
    expect(withFittingDefaults(chosen).interventions).toEqual(['procedure', 'weights']);
  });
});
