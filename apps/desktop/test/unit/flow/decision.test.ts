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

  it('says what the first check found and what both checks added up to', () => {
    const checkedTwice = (index: number, decision: 'kept' | 'reverted', pooled: [number, number]) =>
      ({
        ...decided(index, pooled[0], pooled[1]),
        devBefore: { pass: pooled[0], total: 80 },
        devAfter: { pass: pooled[1], total: 80 },
        firstMeasurement: { devBefore: { pass: 23, total: 40 }, devAfter: { pass: 31, total: 40 } },
        decision,
      }) satisfies Round;
    expect(
      decisionSentence(
        checkedTwice(3, 'kept', [46, 62]),
        lineage([{ type: 'invoice', before: 18, after: 30 }]),
        job,
      ),
    ).toBe(
      '8 more check tasks passed on the first check (23 to 31 of 40). Checked again on new ' +
        'seeds: 16 more over both checks (46 to 62 of 80), and no task type got worse.',
    );
    expect(decisionSentence(checkedTwice(5, 'reverted', [46, 49]), undefined, job)).toBe(
      '8 more check tasks passed on the first check (23 to 31 of 40). Checked again on new ' +
        'seeds: 3 more over both checks (46 to 49 of 80). A change needs at least four more ' +
        'over both to stay.',
    );
    expect(
      decisionSentence(
        checkedTwice(6, 'reverted', [46, 52]),
        lineage([{ type: 'scheduling', before: 14, after: 11 }]),
        job,
      ),
    ).toBe(
      '8 more check tasks passed on the first check (23 to 31 of 40). Checked again on new ' +
        'seeds: 6 more over both checks (46 to 52 of 80), but Scheduling lost three. No task ' +
        'type may lose more than two.',
    );
  });

  it('has nothing to say before the round is decided', () => {
    expect(decisionSentence(makeRound(4, { status: 'evaluating' }), undefined, job)).toBeNull();
  });
});

describe('predictionCheck', () => {
  const predicted = { devDeltaMin: 5, devDeltaMax: 9, rationale: 'Every invoice depends on it.' };

  it('compares the measured change with the predicted range', () => {
    expect(predictionCheck(predicted, 8, 'Spark')).toBe(
      "The result was inside Spark's predicted range.",
    );
    expect(predictionCheck(predicted, 3, 'Spark')).toBe(
      "The result fell short of Spark's predicted range.",
    );
    expect(predictionCheck(predicted, 11, 'Spark')).toBe(
      "The result beat Spark's predicted range.",
    );
    expect(predictionCheck(predicted, 6, 'Spark', 'The first check')).toBe(
      "The first check was inside Spark's predicted range.",
    );
  });
});
