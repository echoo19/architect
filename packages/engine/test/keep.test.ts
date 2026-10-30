import type { TypeScore } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { confirmKeep, decideKeep, decideLearned } from '../src/loop/keep';

const types = (invoice: number, overdue: number, scheduling: number): TypeScore[] => [
  { type: 'invoice', pass: invoice, total: 10 },
  { type: 'overdue', pass: overdue, total: 10 },
  { type: 'scheduling', pass: scheduling, total: 10 },
];

const sum = (scores: TypeScore[]) => ({
  pass: scores.reduce((total, score) => total + score.pass, 0),
  total: 30,
});

describe('decideKeep', () => {
  const cases: {
    name: string;
    before: TypeScore[];
    after: TypeScore[];
    margin?: { minDevGain: number; maxTypeRegression: number; runs: number };
    keep: boolean;
    reason: string;
  }[] = [
    {
      name: 'keeps a gain at the margin with no type losing more than one',
      before: types(4, 5, 5),
      after: types(7, 4, 6),
      keep: true,
      reason: 'Dev 14/30 → 17/30, no type lost more than one',
    },
    {
      name: 'keeps a gain exactly at the margin',
      before: types(4, 5, 5),
      after: types(6, 5, 5),
      keep: true,
      reason: 'Dev 14/30 → 16/30, no type lost more than one',
    },
    {
      name: 'reverts a gain below the margin',
      before: types(4, 5, 5),
      after: types(5, 5, 5),
      keep: false,
      reason: 'Dev 14/30 → 15/30, short of the +2 margin',
    },
    {
      name: 'reverts no change',
      before: types(4, 5, 5),
      after: types(5, 4, 5),
      keep: false,
      reason: 'Dev 14/30 → 14/30, no change',
    },
    {
      name: 'reverts a loss',
      before: types(4, 5, 5),
      after: types(3, 4, 4),
      keep: false,
      reason: 'Dev 14/30 → 11/30, down 3',
    },
    {
      name: 'reverts a net gain when one type loses more than allowed',
      before: types(4, 5, 5),
      after: types(10, 3, 5),
      keep: false,
      reason: 'Dev 14/30 → 18/30, but overdue lost 2 passes',
    },
    {
      name: 'names the type that lost most',
      before: types(4, 5, 5),
      after: types(12, 3, 2),
      keep: false,
      reason: 'Dev 14/30 → 17/30, but scheduling lost 3 passes',
    },
    {
      name: 'allows no regression at all when the job says so',
      before: types(4, 5, 5),
      after: types(8, 4, 5),
      margin: { minDevGain: 2, maxTypeRegression: 0, runs: 1 },
      keep: false,
      reason: 'Dev 14/30 → 17/30, but overdue lost 1 pass',
    },
    {
      name: 'says so when no type lost a pass and none may',
      before: types(4, 5, 5),
      after: types(7, 5, 5),
      margin: { minDevGain: 3, maxTypeRegression: 0, runs: 1 },
      keep: true,
      reason: 'Dev 14/30 → 17/30, no type lost a pass',
    },
    {
      name: 'uses a larger margin',
      before: types(4, 5, 5),
      after: types(7, 5, 5),
      margin: { minDevGain: 4, maxTypeRegression: 1, runs: 1 },
      keep: false,
      reason: 'Dev 14/30 → 17/30, short of the +4 margin',
    },
    {
      name: 'scales the margin with the repeats, reverting a gain one run could make by luck',
      before: types(4, 5, 5),
      after: types(7, 5, 5),
      margin: { minDevGain: 2, maxTypeRegression: 1, runs: 2 },
      keep: false,
      reason: 'Dev 14/30 → 17/30 over 2 runs, short of the +4 margin',
    },
    {
      name: 'keeps a gain that holds across the repeats, with the type-loss limit scaled too',
      before: types(4, 5, 5),
      after: types(9, 3, 6),
      margin: { minDevGain: 2, maxTypeRegression: 1, runs: 2 },
      keep: true,
      reason: 'Dev 14/30 → 18/30 over 2 runs, no type lost more than two',
    },
    {
      name: 'reverts a type loss past the scaled limit',
      before: types(4, 5, 5),
      after: types(10, 2, 6),
      margin: { minDevGain: 2, maxTypeRegression: 1, runs: 2 },
      keep: false,
      reason: 'Dev 14/30 → 18/30 over 2 runs, but overdue lost 3 passes',
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const { runs, ...evaluation } = testCase.margin ?? {
        minDevGain: 2,
        maxTypeRegression: 1,
        runs: 1,
      };
      const decision = decideKeep({
        before: sum(testCase.before),
        after: sum(testCase.after),
        beforePerType: testCase.before,
        afterPerType: testCase.after,
        evaluation,
        runs,
      });
      expect(decision).toEqual({ keep: testCase.keep, reason: testCase.reason });
    });
  }

  it('counts a type missing after the change as having lost all its passes', () => {
    const decision = decideKeep({
      before: { pass: 6, total: 30 },
      after: { pass: 9, total: 30 },
      beforePerType: [{ type: 'invoice', pass: 3, total: 10 }],
      afterPerType: [{ type: 'overdue', pass: 9, total: 10 }],
      evaluation: { minDevGain: 2, maxTypeRegression: 1 },
      runs: 1,
    });
    expect(decision.keep).toBe(false);
    expect(decision.reason).toContain('invoice lost 3 passes');
  });
});

describe('confirmKeep', () => {
  const measured = (before: TypeScore[], after: TypeScore[]) => ({
    before: sum(before),
    after: sum(after),
    beforePerType: before,
    afterPerType: after,
  });
  const twice = (scores: TypeScore[], again: TypeScore[]) =>
    scores.map((score, index) => ({
      ...score,
      pass: score.pass + (again[index]?.pass ?? 0),
      total: score.total * 2,
    }));
  const total60 = (scores: TypeScore[]) => ({ ...sum(scores), total: 60 });
  const first = measured(types(4, 5, 5), types(7, 5, 5));
  const evaluation = { minDevGain: 2, maxTypeRegression: 1 };

  it('keeps a change that still clears the doubled limits over both measurements', () => {
    const before = twice(types(4, 5, 5), types(5, 5, 4));
    const after = twice(types(7, 5, 5), types(7, 4, 5));
    const decision = confirmKeep({
      first,
      both: { ...measured(before, after), before: total60(before), after: total60(after) },
      evaluation,
      runs: 1,
    });
    expect(decision).toEqual({
      keep: true,
      reason:
        'Dev 14/30 → 17/30, measured again on new seeds: 28/60 → 33/60 over 2 runs, no type lost more than two',
    });
  });

  it("reverts a first gain that the second measurement doesn't repeat", () => {
    const before = twice(types(4, 5, 5), types(5, 5, 5));
    const after = twice(types(7, 5, 5), types(5, 4, 5));
    const decision = confirmKeep({
      first,
      both: { ...measured(before, after), before: total60(before), after: total60(after) },
      evaluation,
      runs: 1,
    });
    expect(decision).toEqual({
      keep: false,
      reason:
        'Dev 14/30 → 17/30, measured again on new seeds: 29/60 → 31/60 over 2 runs, short of the +4 margin',
    });
  });

  it('reverts when a type loses more than the doubled limit over both measurements', () => {
    const before = twice(types(4, 5, 5), types(4, 6, 5));
    const after = twice(types(7, 5, 5), types(10, 3, 5));
    const decision = confirmKeep({
      first,
      both: { ...measured(before, after), before: total60(before), after: total60(after) },
      evaluation,
      runs: 1,
    });
    expect(decision.keep).toBe(false);
    expect(decision.reason).toBe(
      'Dev 14/30 → 17/30, measured again on new seeds: 29/60 → 35/60 over 2 runs, but overdue lost 3 passes',
    );
  });

  it("counts runs from the job's repeats, so two repeats measure again over four", () => {
    const decision = confirmKeep({
      first: { ...first, before: { pass: 14, total: 60 }, after: { pass: 18, total: 60 } },
      both: { ...first, before: { pass: 28, total: 120 }, after: { pass: 36, total: 120 } },
      evaluation,
      runs: 2,
    });
    expect(decision).toEqual({
      keep: true,
      reason:
        'Dev 14/60 → 18/60 over 2 runs, measured again on new seeds: 28/120 → 36/120 over 4 runs, no type lost more than four',
    });
  });
});

describe('decideLearned', () => {
  const evaluation = { minDevGain: 2, maxTypeRegression: 1 };
  const learn = (before: TypeScore[], after: TypeScore[], passes: boolean[]) =>
    decideLearned({
      before: sum(before),
      after: sum(after),
      beforePerType: before,
      afterPerType: after,
      evaluation,
      runs: 1,
      learned: passes.map((pass, n) => ({ taskId: `train-overdue-${n}`, type: 'overdue', pass })),
    });

  it('keeps a change the student learned from at its ceiling, with no gain on dev', () => {
    expect(learn(types(10, 9, 10), types(10, 9, 10), [true, true, true])).toEqual({
      keep: true,
      reason: 'Learned: passed 3 of 3 tasks it had failed; check tasks held 29/30 → 29/30',
    });
  });

  it("keeps no change the student didn't learn from, whatever dev gained", () => {
    expect(learn(types(4, 5, 5), types(9, 5, 9), [true, false])).toEqual({
      keep: false,
      reason: 'Not learned: passed 1 of 2 tasks it had failed; check tasks 14/30 → 23/30',
    });
  });

  it('keeps nothing when no task could check the lessons', () => {
    expect(learn(types(4, 5, 5), types(9, 5, 9), [])).toEqual({
      keep: false,
      reason:
        "Not verified: it failed no task of its lessons' types in this round; check tasks 14/30 → 23/30",
    });
  });

  it('keeps no change that did harm on dev, as isHarmful judges it', () => {
    expect(learn(types(10, 8, 10), types(10, 10, 8), [true])).toEqual({
      keep: false,
      reason:
        'Learned: passed 1 of 1 task it had failed, but scheduling lost 2 passes; check tasks 28/30 → 28/30',
    });
    expect(learn(types(10, 9, 10), types(9, 9, 10), [true]).reason).toBe(
      'Learned: passed 1 of 1 task it had failed, but check tasks fell 29/30 → 28/30',
    );
  });
});
