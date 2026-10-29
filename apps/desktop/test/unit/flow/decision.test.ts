import { describe, expect, it } from 'vitest';
import type { Experiment, Intervention, LineageEntry, Round } from '@architect/shared';
import {
  decisionSentence,
  harmSentence,
  outcomeNote,
  predictionCheck,
  refusalSentence,
} from '../../../src/renderer/src/flow/train/decision';
import { AT, decided, makeJob, makeRound } from './factories';

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
    ).toBe('8 more check tasks passed (23 → 31 of 40), and no task type got worse.');
    expect(decisionSentence(round, undefined, job)).toBe(
      '8 more check tasks passed (23 → 31 of 40), and no task type lost more than one.',
    );
  });

  it('says why a change was reverted: too small a gain, or a task type that lost', () => {
    expect(decisionSentence(decided(2, 23, 22), undefined, job)).toBe(
      '1 fewer check task passed (23 → 22 of 40). A change needs at least two more to stay.',
    );
    expect(decisionSentence(decided(2, 23, 23), undefined, job)).toBe(
      'The same number of check tasks passed (23 → 23 of 40). A change needs at least two more to stay.',
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
      '4 more check tasks passed (30 → 34 of 40), but Scheduling went from 9 to 7. No task type may lose more than one.',
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
      '6 more check tasks passed (40 → 46 of 80, adding up 2 runs), and no task type lost more than two.',
    );
  });

  it('says what the first measurement found and what both added up to', () => {
    const measuredTwice = (
      index: number,
      decision: 'kept' | 'reverted',
      pooled: [number, number],
    ) =>
      ({
        ...decided(index, pooled[0], pooled[1]),
        devBefore: { pass: pooled[0], total: 80 },
        devAfter: { pass: pooled[1], total: 80 },
        firstMeasurement: { devBefore: { pass: 23, total: 40 }, devAfter: { pass: 31, total: 40 } },
        decision,
      }) satisfies Round;
    expect(
      decisionSentence(
        measuredTwice(3, 'kept', [46, 62]),
        lineage([{ type: 'invoice', before: 18, after: 30 }]),
        job,
      ),
    ).toBe(
      '8 more check tasks passed (23 → 31 of 40). Measured again to rule out luck: 16 more over ' +
        'both (46 → 62 of 80), and no task type got worse.',
    );
    expect(decisionSentence(measuredTwice(5, 'reverted', [46, 49]), undefined, job)).toBe(
      '8 more check tasks passed (23 → 31 of 40). Measured again to rule out luck: 3 more over ' +
        'both (46 → 49 of 80). A change needs at least four more over both to stay.',
    );
    expect(
      decisionSentence(
        measuredTwice(6, 'reverted', [46, 52]),
        lineage([{ type: 'scheduling', before: 14, after: 11 }]),
        job,
      ),
    ).toBe(
      '8 more check tasks passed (23 → 31 of 40). Measured again to rule out luck: 6 more over ' +
        'both (46 → 52 of 80), but Scheduling went from 14 to 11. No task type may lose more than two.',
    );
  });

  it('has nothing to say before the round is decided', () => {
    expect(decisionSentence(makeRound(4, { status: 'evaluating' }), undefined, job)).toBeNull();
  });
});

const rejected = (
  regressions: Experiment['regressions'],
  before: number,
  after: number,
  gates: Experiment['gates'] = [],
) =>
  ({
    disposition: 'rejected',
    devBefore: { pass: before, total: 9 },
    devAfter: { pass: after, total: 9 },
    regressions,
    gates,
    seeds: { dev: [101], train: 7 },
  }) as Experiment;

describe('harmSentence', () => {
  it('names the task type that lost more than the job allows, with its passes', () => {
    expect(harmSentence(rejected([{ type: 'scheduling', before: 3, after: 0 }], 7, 6), job)).toBe(
      '1 fewer check task passed (7 → 6 of 9), and Scheduling went from 3 to 0. No task type may lose more than one.',
    );
  });

  it('says a change that loses check tasks in all is rejected', () => {
    expect(harmSentence(rejected([{ type: 'invoice', before: 3, after: 2 }], 7, 6), job)).toBe(
      '1 fewer check task passed (7 → 6 of 9). A change that loses check tasks is rejected.',
    );
  });
});

describe('outcomeNote', () => {
  const ended = (disposition: Experiment['disposition']) =>
    ({ ...rejected([], 7, 7), disposition }) as Experiment;

  it('adds nothing where the outcome says it all', () => {
    for (const disposition of ['kept', 'reverted', 'invalid', 'stopped'] as const) {
      expect(outcomeNote(ended(disposition), job)).toBeNull();
    }
  });

  it('names what a rejected change harmed, or the check it failed', () => {
    expect(outcomeNote(rejected([{ type: 'scheduling', before: 3, after: 0 }], 7, 6), job)).toBe(
      'Scheduling 3 → 0',
    );
    expect(outcomeNote(rejected([{ type: 'invoice', before: 3, after: 2 }], 7, 6), job)).toBe(
      '1 fewer check task passed',
    );
    expect(
      outcomeNote(
        rejected([], 7, 9, [
          { gate: 'device', passed: false, detail: 'Too slow on this computer' },
        ]),
        job,
      ),
    ).toBe('Failed the answer time check');
  });
});

describe('predictionCheck', () => {
  const predicted = { devDeltaMin: 5, devDeltaMax: 9, rationale: 'Every invoice depends on it.' };

  it('compares the measured change with the predicted range', () => {
    expect(predictionCheck(predicted, 8)).toBe('Measured within this range');
    expect(predictionCheck(predicted, 5)).toBe('Measured within this range');
    expect(predictionCheck(predicted, 3)).toBe('Measured below this range');
    expect(predictionCheck(predicted, 11)).toBe('Measured above this range');
  });
});

function chosen(type: Intervention['type']): Intervention {
  return {
    id: 'itv_1',
    runId: 'run_1',
    round: 2,
    type,
    title: 'Count with a tool',
    hypothesis: 'The sums are done by hand.',
    findings: [],
    setAside: [],
    edits: [],
    workedExamples: [],
    practicePerFinding: 0,
    predicted: { devDeltaMin: 1, devDeltaMax: 3, rationale: 'Three check tasks.' },
    estimatedCost: { mentorUsd: 0, computeUsd: 0, minutes: 0 },
    verificationPlan: '',
    parent: { harnessVersion: 1, adapter: null },
    status: 'invalid',
    createdAt: AT,
  };
}

describe('refusalSentence', () => {
  it('names a kind the person turned off as theirs, and says where to turn it on', () => {
    const noTools = makeJob({ interventions: ['procedure', 'retrieval', 'weights'] });
    expect(refusalSentence(chosen('helper'), noTools)).toBe(
      'Spark chose "Small tools", which is turned off for this job under Teacher in Advanced settings. Nothing changed.',
    );
    // Weights get the same words, not the line for what this computer can't do.
    const noWeights = makeJob({ interventions: ['procedure', 'clarification'] });
    expect(refusalSentence(chosen('weights'), noWeights)).toContain('"Its weights"');
    expect(
      refusalSentence(chosen('clarification'), makeJob({ interventions: ['helper'] })),
    ).toContain('"Questions for you"');
  });

  it("says nothing of a refusal that was not the person's choice", () => {
    expect(refusalSentence(chosen('helper'), makeJob())).toBeNull();
    expect(refusalSentence(chosen('weights'), makeJob({ interventions: ['weights'] }))).toBeNull();
    expect(refusalSentence(undefined, makeJob({ interventions: ['procedure'] }))).toBeNull();
  });
});
