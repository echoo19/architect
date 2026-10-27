import { describe, expect, it } from 'vitest';
import { OUT_OF_TIME_ROUND, planNextStep, STOPPED_ROUND, type PlanInput } from '../src/loop/plan';

const base: PlanInput = {
  method: 'architect',
  status: 'running',
  phase: 'attempting',
  stopRequested: false,
  pauseRequested: false,
  devBaseline: { pass: 3, total: 10 },
  devCurrent: { pass: 3, total: 10 },
  frozen: false,
  rounds: [],
  maxRounds: 5,
  patience: 2,
  passRateTarget: 0.8,
  wallClockSpent: false,
};

const plan = (patch: Partial<PlanInput>) => planNextStep({ ...base, ...patch });

describe('planNextStep', () => {
  it('does nothing for a run that has ended', () => {
    for (const status of ['finished', 'stopped', 'failed'] as const) {
      expect(plan({ status })).toEqual({ kind: 'done' });
    }
  });

  it('prepares, then takes the dev baseline', () => {
    expect(plan({ phase: 'preparing', devBaseline: null })).toEqual({ kind: 'prepare' });
    expect(plan({ phase: 'baseline', devBaseline: null })).toEqual({ kind: 'baseline' });
  });

  it('continues an open round from its status', () => {
    const round = (status: 'attempting' | 'diagnosing' | 'evaluating') => [
      { index: 1, status: 'decided' as const, decision: 'kept' as const },
      { index: 2, status },
    ];
    expect(plan({ rounds: round('attempting') })).toEqual({ kind: 'attempt_train', round: 2 });
    expect(plan({ rounds: round('diagnosing') })).toEqual({ kind: 'author', round: 2 });
    expect(plan({ rounds: round('evaluating') })).toEqual({ kind: 'evaluate_candidate', round: 2 });
  });

  it('starts the next round while the budget and patience allow', () => {
    const rounds = [{ index: 1, status: 'decided' as const, decision: 'kept' as const }];
    expect(plan({ rounds })).toEqual({ kind: 'start_round', round: 2 });
  });

  it('stops training when dev meets the target', () => {
    expect(plan({ devCurrent: { pass: 8, total: 10 } })).toEqual({
      kind: 'finish_training',
      reason: 'target_met',
    });
  });

  it('stops after patience changes in a row are measured and reverted', () => {
    const rounds = [
      { index: 1, status: 'decided' as const, decision: 'kept' as const },
      { index: 2, status: 'decided' as const, decision: 'reverted' as const },
      { index: 3, status: 'failed' as const, rejected: true },
      { index: 4, status: 'decided' as const, decision: 'reverted' as const },
    ];
    expect(plan({ rounds })).toEqual({ kind: 'finish_training', reason: 'patience' });
  });

  it('does not let a rejected round use up patience', () => {
    const rounds = [
      { index: 1, status: 'decided' as const, decision: 'reverted' as const },
      { index: 2, status: 'failed' as const, rejected: true },
    ];
    expect(plan({ rounds })).toEqual({ kind: 'start_round', round: 3 });
  });

  it('ends training after two rejected rounds in a row, and only in a row', () => {
    const rejected = { status: 'failed' as const, rejected: true };
    expect(
      plan({
        rounds: [
          { index: 1, ...rejected },
          { index: 2, ...rejected },
        ],
      }),
    ).toEqual({
      kind: 'finish_training',
      reason: 'rejected',
    });
    const apart = [
      { index: 1, ...rejected },
      { index: 2, status: 'decided' as const, decision: 'reverted' as const },
      { index: 3, ...rejected },
    ];
    expect(plan({ rounds: apart })).toEqual({ kind: 'start_round', round: 4 });
  });

  it('stops when every round in the budget is used', () => {
    const rounds = [
      { index: 1, status: 'decided' as const, decision: 'kept' as const },
      { index: 2, status: 'decided' as const, decision: 'kept' as const },
    ];
    expect(plan({ rounds, maxRounds: 2 })).toEqual({ kind: 'finish_training', reason: 'rounds' });
  });

  it('abandons the open round when the wall clock runs out, then ends training', () => {
    const open = [{ index: 1, status: 'evaluating' as const }];
    expect(plan({ rounds: open, wallClockSpent: true })).toEqual({
      kind: 'abandon_round',
      round: 1,
      reason: OUT_OF_TIME_ROUND,
    });
    expect(plan({ wallClockSpent: true, devBaseline: null })).toEqual({
      kind: 'finish_training',
      reason: 'wall_clock',
    });
  });

  it('on a stop, abandons the open round and skips to the end of training', () => {
    const open = [{ index: 1, status: 'attempting' as const }];
    expect(plan({ rounds: open, stopRequested: true })).toEqual({
      kind: 'abandon_round',
      round: 1,
      reason: STOPPED_ROUND,
    });
    expect(plan({ stopRequested: true })).toEqual({ kind: 'finish_training', reason: 'user' });
    expect(plan({ phase: 'preparing', stopRequested: true })).toEqual({
      kind: 'finish_training',
      reason: 'user',
    });
  });

  it('parks on a pause, but a stop wins while training', () => {
    expect(plan({ pauseRequested: true })).toEqual({ kind: 'park' });
    expect(plan({ pauseRequested: true, stopRequested: true })).toEqual({
      kind: 'finish_training',
      reason: 'user',
    });
  });

  it('runs the methods without rounds straight to the end of training', () => {
    expect(plan({ method: 'bare' })).toEqual({ kind: 'finish_training' });
    expect(plan({ method: 'one_shot' })).toEqual({ kind: 'start_round', round: 1 });
    expect(
      plan({ method: 'one_shot', rounds: [{ index: 1, status: 'decided', decision: 'kept' }] }),
    ).toEqual({ kind: 'finish_training' });
  });

  it('freezes the graduate before the locked test, and the test can be paused', () => {
    const testing = { phase: 'testing' as const, status: 'testing' as const };
    expect(plan(testing)).toEqual({ kind: 'freeze' });
    expect(plan({ ...testing, frozen: true })).toEqual({ kind: 'locked_test' });
    expect(plan({ ...testing, frozen: true, pauseRequested: true })).toEqual({ kind: 'park' });
  });

  it('never goes back to training once the graduate is being tested', () => {
    const testing = {
      phase: 'testing' as const,
      status: 'testing' as const,
      frozen: true,
      stopRequested: true,
      wallClockSpent: true,
      devCurrent: { pass: 0, total: 10 },
      rounds: [{ index: 1, status: 'attempting' as const }],
    };
    expect(plan(testing)).toEqual({ kind: 'locked_test' });
  });
});
