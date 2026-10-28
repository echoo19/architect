import { emptyTotals, type LineageEntry, type Round, type Run } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { computeReportCard, percentile, type ReportCardInput } from '../src/report/report-card';
import { defaultJob } from './fakes/job';

const AT = '2026-10-27T14:00:00.000Z';

function entry(round: number, decision: 'kept' | 'reverted', delta: number): LineageEntry {
  return {
    id: `chg_${round}`,
    runId: 'run_1',
    round,
    title: `Change ${round}`,
    diagnosis: 'A cause.',
    files: ['AGENTS.md'],
    causeTaskIds: [],
    predicted: { devDeltaMin: 1, devDeltaMax: 2, rationale: 'A guess.' },
    measured: {
      devBefore: { pass: 0, total: 9 },
      devAfter: { pass: delta, total: 9 },
      delta,
      perType: [],
    },
    decision,
    decisionReason: 'A reason.',
    versionFrom: round - 1,
    versionTo: round,
    mentor: { model: 'fake-mentor-1', costUsd: 0.01, inputTokens: 100, outputTokens: 50 },
    at: AT,
  };
}

function round(index: number, decision: 'kept' | 'reverted' | null, pass: number): Round {
  return {
    runId: 'run_1',
    index,
    status: decision ? 'decided' : 'failed',
    train: { pass: 1, total: 6 },
    files: [],
    costUsd: 0.01,
    startedAt: AT,
    ...(decision ? { decision, devAfter: { pass, total: 9 } } : {}),
  };
}

const run: Run = {
  id: 'run_1',
  jobId: 'service-desk',
  method: 'architect',
  seed: 7,
  status: 'testing',
  phase: 'testing',
  createdAt: AT,
  updatedAt: AT,
  currentVersion: 3,
  devBaseline: { pass: 2, total: 9 },
  devCurrent: { pass: 7, total: 9 },
  totals: {
    ...emptyTotals(),
    mentorUsd: 0.04,
    mentorInputTokens: 400,
    mentorOutputTokens: 200,
    rounds: 4,
    wallMs: 90_000,
  },
};

function input(overrides: Partial<ReportCardInput> = {}): ReportCardInput {
  return {
    job: defaultJob({ requirements: { passRate: 0.5, p95LatencyMs: 5_000 } }),
    run,
    rounds: [round(1, 'kept', 4), round(2, 'reverted', 3), round(3, null, 0), round(4, 'kept', 7)],
    lineage: [
      entry(1, 'kept', 2),
      entry(2, 'reverted', -1),
      entry(4, 'kept', 3),
      entry(5, 'kept', 1),
      entry(6, 'kept', 2),
    ],
    test: [
      { taskType: 'invoice', pass: true, latencyMs: 1_000, refused: false },
      { taskType: 'invoice', pass: true, latencyMs: 2_000, refused: false },
      { taskType: 'overdue', pass: false, latencyMs: 3_000, refused: true },
      { taskType: 'overdue', pass: true, latencyMs: 4_000, refused: false },
      { taskType: 'scheduling', pass: false, latencyMs: 100, refused: true },
      { taskType: 'scheduling', pass: false, latencyMs: 200, refused: true },
    ],
    guardrails: {
      refuse: [
        {
          taskType: 'scheduling',
          whenAny: ['book'],
          reason: 'Bookings were right 40% of the time.',
        },
        { taskType: 'scheduling', whenAny: ['slot'], reason: 'A second rule for the same type.' },
      ],
    },
    student: { label: 'Glimmer', model: 'glimmer:test', runtime: 'ollama' },
    testedOn: 'local',
    mentor: { label: 'Spark', model: 'fake-mentor-1' },
    readyClaimed: true,
    studentUsd: 0,
    ranOffline: true,
    createdAt: AT,
    ...overrides,
  };
}

describe('percentile', () => {
  it('uses the nearest rank', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([4, 1, 3, 2], 95)).toBe(4);
  });
});

describe('computeReportCard', () => {
  it('scores the locked test per type and flags the types the graduate refuses', () => {
    const card = computeReportCard(input());
    expect(card.test.score).toEqual({ pass: 3, total: 6 });
    expect(card.test.perType).toEqual([
      { type: 'invoice', label: 'Invoices', pass: 2, total: 2, refused: false },
      { type: 'overdue', label: 'Overdue balances', pass: 1, total: 2, refused: false },
      { type: 'scheduling', label: 'Scheduling', pass: 0, total: 2, refused: true },
    ]);
    expect(card.refusedTypes).toEqual([
      { type: 'scheduling', label: 'Scheduling', reason: 'Bookings were right 40% of the time.' },
    ]);
  });

  it('counts refusals on supported types as failures and reports them', () => {
    expect(computeReportCard(input()).test.refusals).toBe(1);
  });

  it('says which student endpoint took the test and whether it ran offline', () => {
    expect(computeReportCard(input())).toMatchObject({
      testedOn: 'local',
      test: { ranOffline: true },
    });
    expect(computeReportCard(input({ testedOn: 'hosted', ranOffline: false }))).toMatchObject({
      testedOn: 'hosted',
      test: { ranOffline: false },
    });
  });

  it('reports latency, cost, rounds and wall time', () => {
    const card = computeReportCard(input());
    expect(card.test.latencyMs).toEqual({ p50: 1_000, p95: 4_000 });
    expect(card.cost).toEqual({
      mentorUsd: 0.04,
      mentorInputTokens: 400,
      mentorOutputTokens: 200,
      rounds: 4,
      wallMs: 90_000,
    });
    expect(computeReportCard(input({ studentUsd: 0.81 })).cost.studentUsd).toBe(0.81);
  });

  it('draws the dev curve from the baseline and each decided round', () => {
    expect(computeReportCard(input()).dev).toEqual({
      baseline: { pass: 2, total: 9 },
      final: { pass: 7, total: 9 },
      curve: [
        { round: 0, score: { pass: 2, total: 9 }, decision: 'baseline' },
        { round: 1, score: { pass: 4, total: 9 }, decision: 'kept' },
        { round: 2, score: { pass: 3, total: 9 }, decision: 'reverted' },
        { round: 4, score: { pass: 7, total: 9 }, decision: 'kept' },
      ],
    });
  });

  it('lists the three kept changes that helped dev most', () => {
    expect(computeReportCard(input()).topInterventions).toEqual([
      { round: 4, title: 'Change 4', delta: 3 },
      { round: 1, title: 'Change 1', delta: 2 },
      { round: 6, title: 'Change 6', delta: 2 },
    ]);
  });

  it('checks each requirement and calls a ready claim an overclaim when the test missed', () => {
    const met = computeReportCard(input());
    expect(met.requirements).toEqual({
      passRate: { target: 0.5, actual: 0.5, met: true },
      p95LatencyMs: { target: 5_000, actual: 4_000, met: true },
    });
    expect(met.overclaim).toBe(false);

    const slow = computeReportCard(
      input({ job: defaultJob({ requirements: { passRate: 0.5, p95LatencyMs: 3_000 } }) }),
    );
    expect(slow.requirements.p95LatencyMs?.met).toBe(false);
    expect(slow.overclaim).toBe(true);

    expect(computeReportCard(input({ readyClaimed: false })).overclaim).toBeNull();
    const noLatency = computeReportCard(input({ job: defaultJob() }));
    expect(noLatency.requirements.p95LatencyMs).toBeUndefined();
  });
});
