import type { ArmRow, ExperimentInput, OrgTypeResult } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  countIn,
  defaultInput,
  groupsOf,
  inputProblem,
  points,
  preregisterProblem,
  primaryGroup,
  primaryText,
  skillIn,
  verdictOf,
  wilson,
  withArmCap,
  withArms,
} from '../../../src/renderer/src/experiments/model';

function result(org: string, seen: boolean, synthetic: boolean, type: string, pass: number) {
  return {
    type,
    label: type,
    org,
    orgName: org.toUpperCase(),
    seen,
    synthetic,
    pass,
    total: 4,
  } satisfies OrgTypeResult;
}

function row(perOrg?: OrgTypeResult[]): ArmRow {
  return {
    arm: 'targeted',
    label: 'Targeted mentoring',
    runId: 'run_1',
    configuration: null,
    seed: 101,
    scenarios: { pass: 57, total: 60, rate: 0.95, wilson95: { low: 0.863, high: 0.983 } },
    passTarget: { passRate: 0.95, needed: 57, of: 60, met: true },
    perType: [
      { type: 'refund', label: 'Refunds', pass: 19, total: 20, rate: 0.95, wilson95: null },
    ],
    ...(perOrg ? { perOrg } : {}),
    refusals: 0,
    latencyMs: null,
    coldStartMs: null,
    peakMemory: null,
    harnessHash: null,
    adapterSha256: null,
    sampling: null,
    complete: true,
  };
}

describe('experiment results', () => {
  it("matches the report's Wilson interval, and has none for nothing counted", () => {
    const interval = wilson(57, 60);
    expect(interval?.low).toBeCloseTo(0.863, 3);
    expect(interval?.high).toBeCloseTo(0.983, 3);
    expect(wilson(0, 0)).toBeNull();
  });

  it('applies the gain rule: only an interval wholly above zero is a gain', () => {
    expect(verdictOf({ rate: 0.23, low: 0.12, high: 0.35 })).toBe('gain');
    expect(verdictOf({ rate: 0.08, low: -0.01, high: 0.19 })).toBe('none');
    expect(verdictOf({ rate: 0, low: 0, high: 0.1 })).toBe('none');
    expect(verdictOf({ rate: -0.2, low: -0.3, high: -0.05 })).toBe('loss');
  });

  it('writes a difference as signed whole points with a true minus', () => {
    expect(points(0.23333)).toBe('+23');
    expect(points(-0.0125)).toBe('\u22121');
    expect(points(0)).toBe('0');
  });

  it('reads a one-organization test as one group, from the report its interval', () => {
    const [all] = groupsOf([row()]);
    expect(all).toEqual({ key: 'all', label: '' });
    expect(countIn(row(), all!)).toEqual({ pass: 57, total: 60, low: 0.863, high: 0.983 });
  });

  it('splits a field into the organizations taught on together, then each one never seen', () => {
    const perOrg = [
      result('north', true, true, 'refund', 4),
      result('south', true, true, 'refund', 3),
      result('harbor', false, true, 'refund', 2),
      result('real', false, false, 'refund', 1),
    ];
    const groups = groupsOf([row(perOrg)]);
    expect(groups.map((group) => group.label)).toEqual([
      'Organizations it was taught on',
      'HARBOR, never seen',
      'REAL, real, never seen',
    ]);
    expect(countIn(row(perOrg), groups[0]!)).toMatchObject({ pass: 7, total: 8 });
    expect(skillIn(row(perOrg), groups[2]!, 'refund')).toEqual({ pass: 1, total: 4 });
    expect(skillIn(row(perOrg), groups[2]!, 'pickup')).toBeNull();
    expect(countIn(row(perOrg), primaryGroup('unseen'))).toMatchObject({ pass: 3, total: 8 });
    expect(countIn(row(perOrg), primaryGroup('seen'))).toMatchObject({ pass: 7, total: 8 });
  });
});

describe('experiment plans', () => {
  const input = defaultInput({ jobId: 'desk' }, 'Desk');

  it('keeps chosen arms in the runner order with their own caps', () => {
    const capped = withArmCap(input, 'targeted', 'sparkUsd', 5);
    const next = withArms(capped, ['repeat', 'targeted', 'bare']);
    expect(next.arms).toEqual([
      { arm: 'bare' },
      { arm: 'targeted', sparkUsd: 5 },
      { arm: 'repeat' },
    ]);
    expect(withArmCap(next, 'targeted', 'sparkUsd', undefined).arms[1]).toEqual({
      arm: 'targeted',
    });
  });

  it('says what keeps a plan from being sent', () => {
    expect(inputProblem(input)).toBeNull();
    expect(inputProblem({ ...input, name: ' ' })).toBe('Name the experiment.');
    expect(inputProblem({ ...input, arms: [] })).toBe('Choose at least one arm.');
    expect(inputProblem({ ...input, rounds: 11 })).toBe('One of the settings is out of range.');
    expect(inputProblem({ ...input, jobDir: 'C:/fields/desk' })).toBe(
      'One of the settings is out of range.',
    );
  });

  it('asks for a hypothesis and a primary comparison of chosen arms before preregistering', () => {
    const groups = ['all', 'seen', 'unseen'] as const;
    expect(preregisterProblem(input, groups)).toBe('State the hypothesis.');
    const stated = { ...input, hypothesis: 'Mentoring beats the bare student on unseen desks.' };
    expect(preregisterProblem(stated, groups)).toBe('Choose the primary comparison.');
    const primary: ExperimentInput = {
      ...stated,
      primaryComparison: { a: 'targeted', b: 'bare', group: 'unseen' },
    };
    expect(preregisterProblem(primary, groups)).toBeNull();
    expect(preregisterProblem(primary, ['all'])).toBe(
      'Choose a part of the final test this field has.',
    );
    expect(primaryText(primary)).toBe(
      'Targeted mentoring minus Glimmer alone, on the organizations it has never seen',
    );
    // Taking an arm of the comparison out clears it, to be chosen again.
    expect(withArms(primary, ['bare', 'draft']).primaryComparison).toBeUndefined();
    expect(withArms(primary, ['bare', 'targeted']).primaryComparison).toEqual({
      a: 'targeted',
      b: 'bare',
      group: 'unseen',
    });
  });
});
