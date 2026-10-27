import type { TypeScore } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { decideKeep } from '../src/loop/keep';

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
    margin?: { minDevGain: number; maxTypeRegression: number; devRepeats: number };
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
      margin: { minDevGain: 2, maxTypeRegression: 0, devRepeats: 1 },
      keep: false,
      reason: 'Dev 14/30 → 17/30, but overdue lost 1 pass',
    },
    {
      name: 'says so when no type lost a pass and none may',
      before: types(4, 5, 5),
      after: types(7, 5, 5),
      margin: { minDevGain: 3, maxTypeRegression: 0, devRepeats: 1 },
      keep: true,
      reason: 'Dev 14/30 → 17/30, no type lost a pass',
    },
    {
      name: 'uses a larger margin',
      before: types(4, 5, 5),
      after: types(7, 5, 5),
      margin: { minDevGain: 4, maxTypeRegression: 1, devRepeats: 1 },
      keep: false,
      reason: 'Dev 14/30 → 17/30, short of the +4 margin',
    },
    {
      name: 'scales the margin with the repeats, reverting a gain one run could make by luck',
      before: types(4, 5, 5),
      after: types(7, 5, 5),
      margin: { minDevGain: 2, maxTypeRegression: 1, devRepeats: 2 },
      keep: false,
      reason: 'Dev 14/30 → 17/30 over 2 runs, short of the +4 margin',
    },
    {
      name: 'keeps a gain that holds across the repeats, with the type-loss limit scaled too',
      before: types(4, 5, 5),
      after: types(9, 3, 6),
      margin: { minDevGain: 2, maxTypeRegression: 1, devRepeats: 2 },
      keep: true,
      reason: 'Dev 14/30 → 18/30 over 2 runs, no type lost more than two',
    },
    {
      name: 'reverts a type loss past the scaled limit',
      before: types(4, 5, 5),
      after: types(10, 2, 6),
      margin: { minDevGain: 2, maxTypeRegression: 1, devRepeats: 2 },
      keep: false,
      reason: 'Dev 14/30 → 18/30 over 2 runs, but overdue lost 3 passes',
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const decision = decideKeep({
        before: sum(testCase.before),
        after: sum(testCase.after),
        beforePerType: testCase.before,
        afterPerType: testCase.after,
        evaluation: testCase.margin ?? { minDevGain: 2, maxTypeRegression: 1, devRepeats: 1 },
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
      evaluation: { minDevGain: 2, maxTypeRegression: 1, devRepeats: 1 },
    });
    expect(decision.keep).toBe(false);
    expect(decision.reason).toContain('invoice lost 3 passes');
  });
});
