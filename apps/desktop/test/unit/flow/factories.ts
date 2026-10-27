import {
  emptyTotals,
  JobSchema,
  type Attempt,
  type Job,
  type Round,
  type Run,
  type RunDetail,
  type RunEvent,
} from '@architect/shared';

export const AT = '2026-10-27T15:00:00.000Z';

export function at(minutes: number): string {
  return new Date(Date.parse(AT) + minutes * 60_000).toISOString();
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  return JobSchema.parse({
    format: 1,
    id: 'job_desk',
    name: 'Service desk',
    description: 'Closes out the day for a home-services office.',
    createdAt: AT,
    taskTypes: [
      { id: 'invoice', label: 'Invoices' },
      { id: 'overdue', label: 'Overdue balances' },
      { id: 'scheduling', label: 'Scheduling' },
    ],
    data: { files: [{ name: 'invoices.csv', kind: 'table', access: 'read' }] },
    permissions: { writes: 'ask', unseenFiles: 'ask' },
    checker: { kind: 'builtin' },
    requirements: { passRate: 0.9 },
    budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 180 },
    mentor: {
      kind: 'model',
      provider: 'meta',
      label: 'Muse Spark 1.3',
      baseUrl: 'https://api.meta.ai/v1',
      model: 'muse-spark-1.3',
      secretRef: 'meta',
    },
    student: {
      label: 'Glimmer',
      local: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
    },
    startingHarness: { kind: 'blank' },
    splits: { seed: 7, calibration: 10, train: 60, dev: 40, test: 60 },
    evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1 },
    ...overrides,
  });
}

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run_1',
    jobId: 'job_desk',
    method: 'architect',
    seed: 7,
    status: 'running',
    phase: 'attempting',
    createdAt: AT,
    updatedAt: AT,
    currentVersion: 1,
    devBaseline: { pass: 16, total: 40 },
    devCurrent: { pass: 16, total: 40 },
    totals: emptyTotals(),
    ...overrides,
  };
}

export function makeRound(index: number, overrides: Partial<Round> = {}): Round {
  return {
    runId: 'run_1',
    index,
    status: 'decided',
    train: { pass: 7, total: 12 },
    files: [],
    costUsd: 0.05,
    startedAt: AT,
    ...overrides,
  };
}

/** A decided round that moved dev from `before` to `after` passes out of 40. */
export function decided(index: number, before: number, after: number): Round {
  return makeRound(index, {
    title: `Change ${index}`,
    devBefore: { pass: before, total: 40 },
    devAfter: { pass: after, total: 40 },
    decision: after - before >= 2 ? 'kept' : 'reverted',
  });
}

export function makeAttempt(id: string, overrides: Partial<Attempt> = {}): Attempt {
  return {
    id,
    runId: 'run_1',
    round: 1,
    taskId: `task_${id}`,
    taskType: 'invoice',
    split: 'train',
    harnessVersion: 1,
    check: { pass: true, reason: 'Total matches.' },
    latencyMs: 1000,
    usage: { inputTokens: 100, outputTokens: 20 },
    ...overrides,
  };
}

export function makeDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    run: makeRun(),
    job: makeJob(),
    rounds: [],
    recentAttempts: [],
    lineage: [],
    ...overrides,
  };
}

export function runUpdated(run: Run): RunEvent {
  return { type: 'run.updated', runId: run.id, at: run.updatedAt, run };
}

export function roundUpdated(round: Round): RunEvent {
  return { type: 'round.updated', runId: round.runId, at: AT, round };
}

export function attemptFinished(attempt: Attempt, prompt?: string): RunEvent {
  return {
    type: 'attempt.finished',
    runId: attempt.runId,
    at: AT,
    attempt,
    ...(prompt === undefined ? {} : { prompt }),
  };
}
