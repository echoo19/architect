import type { Certificate } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  finalTestAttempts,
  testSeconds,
  SECONDS_PER_TASK,
} from '../../../src/renderer/src/flow/define/estimates';
import {
  boundPercent,
  certificateBasis,
  certificateFigure,
  certificateSentence,
  checkCounts,
  checkPlace,
  noCertificateSentence,
} from '../../../src/renderer/src/flow/report/certificate-words';
import { makeJob } from './factories';

const point = { votes: 4, answered: 60, errors: 1, coverage: 60 / 77, bound: 0.0766 };
const issued: Extract<Certificate, { issued: true }> = {
  issued: true,
  n: 77,
  k: 5,
  delta: 0.05,
  epsilon: 0.1,
  curve: [point],
  assumption: 'Requests like the calibration ones.',
  threshold: point,
  checks: [],
};

describe('a certificate in words (decision 077)', () => {
  it('says the bound rounded up, the confidence and what it handed on', () => {
    expect(certificateSentence(issued, 'Phil')).toBe(
      'When Phil answers, it is wrong on at most 8% of requests like these, with 95% confidence. It handed 22% to a person.',
    );
    expect(boundPercent(0.07)).toBe(7);
    expect(boundPercent(0.0701)).toBe(8);
    const all = { ...issued, threshold: { ...point, coverage: 1 } };
    expect(certificateSentence(all, 'Phil')).toContain('It answered every one.');
  });

  it('states n, k, the rule, ε and δ', () => {
    expect(certificateBasis(issued)).toBe(
      'Measured on 77 calibration tasks it was never taught on, 5 attempts each: it answers when 4 of 5 agree; target 10% at 95% confidence.',
    );
    expect(certificateBasis({ ...issued, k: 1 })).toContain('it answers every request');
  });

  it('says why there is none, and how many tasks would do', () => {
    const none = { ...issued, issued: false as const, needed: 120, reason: 'too_few' as const };
    expect(noCertificateSentence(none)).toBe(
      "No certificate: 77 calibration tasks can't show a bound of 10%; about 120 would.",
    );
    expect(noCertificateSentence({ ...none, needed: null })).not.toContain('about');
    expect(noCertificateSentence({ ...none, reason: 'error_rate' })).toContain(
      'wrong on more than 10%',
    );
    expect(noCertificateSentence({ ...none, reason: 'none_answered' })).toContain('never agreed');
    expect(certificateFigure(none)).toBeNull();
    expect(certificateFigure(undefined)).toBeNull();
    expect(certificateFigure(issued)).toBe('≤ 8%');
  });

  it('names where the bound was checked, with its counts', () => {
    const check = {
      seen: false,
      synthetic: false,
      tasks: 30,
      answered: 21,
      errors: 3,
      held: false,
    };
    expect(checkPlace({ ...check, orgName: 'Real academy' })).toBe('Real academy');
    expect(checkPlace({ ...check, seen: true })).toBe('Final test, organizations it was taught on');
    expect(checkCounts(check)).toBe('Answered 21 of 30, 3 wrong');
    expect(checkCounts({ ...check, answered: 0, errors: 0 })).toBe('Handed all 30 to a person');
  });
});

describe('what a certificate costs before a run', () => {
  it('tries every final-test and calibration task k times', () => {
    const job = makeJob();
    expect(finalTestAttempts(job)).toBe(job.splits.test);
    const certified = makeJob({
      evaluation: {
        ...job.evaluation,
        certify: { k: 5, epsilon: 0.1, delta: 0.05, calibration: 40 },
      },
    });
    expect(finalTestAttempts(certified)).toBe(5 * (job.splits.test + 40));
    expect(testSeconds(certified, 'local')).toBe(
      5 * (job.splits.test + 40) * SECONDS_PER_TASK.local,
    );
    const planned = makeJob({
      evaluation: { ...job.evaluation, certify: { k: 3, epsilon: 0.1, delta: 0.05 } },
    });
    expect(finalTestAttempts(planned)).toBe(3 * (job.splits.test + 30));
  });
});
