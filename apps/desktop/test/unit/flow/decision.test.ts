import { describe, expect, it } from 'vitest';
import type { LineageEntry, Round } from '@architect/shared';
import { decisionSentence, predictionCheck } from '../../../src/renderer/src/flow/train/decision';
import { decided, makeJob, makeRound } from './factories';

const job = makeJob();

function lineage(perType: LineageEntry['measured']['perType']): LineageEntry {
  return { measured: { perType } } as LineageEntry;
}

describe('decisionSentence', () => {
  it('says how many more check tasks passed and that no type paid for it', () => {
    const round = decided(3, 23, 31);
    expect(
      decisionSentence(
        round,
        lineage([
          { type: 'invoice', before: 9, after: 14 },
          { type: 'overdue', before: 8, after: 10 },
          { type: 'scheduling', before: 6, after: 7 },
        ]),
        job,
      ),
    ).toBe('8 more check tasks passed (23 to 31 of 40), and no task type got worse.');
    expect(decisionSentence(round, undefined, job)).toBe(
      '8 more check tasks passed (23 to 31 of 40), and no task type lost more than one.',
    );
  });

  it('says why a change was reverted: too small a gain, or a task type that lost', () => {
    expect(decisionSentence(decided(2, 23, 22), undefined, job)).toBe(
      '1 fewer check task passed (23 to 22 of 40). A change needs at least two more to stay.',
    );
    expect(decisionSentence(decided(2, 23, 23), undefined, job)).toBe(
      'The same number of check tasks passed (23 to 23 of 40). A change needs at least two more to stay.',
    );
    const traded: Round = { ...decided(5, 30, 34), decision: 'reverted' };
    expect(
      decisionSentence(
        traded,
        lineage([
          { type: 'invoice', before: 10, after: 16 },
          { type: 'scheduling', before: 9, after: 7 },
        ]),
        job,
      ),
    ).toBe(
      '4 more check tasks passed (30 to 34 of 40), but Scheduling lost two. No task type may lose more than one.',
    );
  });

  it('adds up repeated runs of the check tasks', () => {
    const repeated = makeJob({ evaluation: { ...job.evaluation, devRepeats: 2 } });
    const round: Round = {
      ...decided(1, 40, 46),
      devBefore: { pass: 40, total: 80 },
      devAfter: { pass: 46, total: 80 },
    };
    expect(decisionSentence(round, undefined, repeated)).toBe(
      '6 more check tasks passed (40 to 46 of 80, adding up 2 runs), and no task type lost more than two.',
    );
  });

  it('has nothing to say before the round is decided', () => {
    expect(decisionSentence(makeRound(4, { status: 'evaluating' }), undefined, job)).toBeNull();
  });
});

describe('predictionCheck', () => {
  const predicted = { devDeltaMin: 5, devDeltaMax: 9, rationale: 'Every invoice depends on it.' };

  it('compares the measured change with the predicted range', () => {
    expect(predictionCheck(predicted, 8, 'Spark')).toBe("Inside Spark's prediction");
    expect(predictionCheck(predicted, 3, 'Spark')).toBe("Below Spark's prediction");
    expect(predictionCheck(predicted, 11, 'Spark')).toBe('Better than Spark predicted');
  });
});
