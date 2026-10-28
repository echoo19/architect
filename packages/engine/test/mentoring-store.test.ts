import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyTotals,
  type Experiment,
  type Intervention,
  type Lesson,
  type ReferenceRecord,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/store/database';
import { createEngineStore, openEngineStore, type EngineStore } from '../src/store/engine-store';
import { stoppedFromRecords } from '../src/loop/teach';
import { MENTORING_MIGRATION } from '../src/store/mentoring-migration';
import { MIGRATIONS } from '../src/store/migrations';
import type { StoredAttempt, StoredRun } from '../src/store/records';

const AT = '2026-10-28T10:00:00.000Z';
let dir: string;
let store: EngineStore;

function run(id = 'run_1'): StoredRun {
  return {
    run: {
      id,
      jobId: 'job_1',
      method: 'architect',
      seed: 7,
      status: 'running',
      phase: 'teaching',
      createdAt: AT,
      updatedAt: AT,
      currentVersion: 1,
      devBaseline: null,
      devCurrent: null,
      totals: emptyTotals(),
    },
    seeds: { trainBatch: 1, trainStudent: 2, devPanel: 3, test: 4, mentor: 5 },
    today: '2026-11-24',
    lockedTestOn: 'hosted',
    stopRequested: false,
    freeze: null,
  };
}

function attempt(id: string, config?: string): StoredAttempt {
  return {
    id,
    runId: 'run_1',
    round: 1,
    taskId: 'dev-refund-1',
    taskType: 'refund',
    split: 'dev',
    harnessVersion: 1,
    check: { pass: true, reason: 'Recorded.' },
    latencyMs: 900,
    usage: { inputTokens: 10, outputTokens: 2 },
    target: 'hosted',
    ...(config === undefined ? {} : { config }),
    seed: 11,
    stopReason: 'answer',
    tracePath: `jobs/job_1/runs/run_1/traces/${id}.json`,
    createdAt: AT,
  };
}

function intervention(round: number, status: Intervention['status'] = 'accepted'): Intervention {
  return {
    id: `itv_${round}`,
    runId: 'run_1',
    round,
    type: 'weights',
    title: 'Train the date reading',
    hypothesis: 'Refunds fail where a delivery date is written month first.',
    findings: [
      {
        attemptId: 'att_1',
        taskId: 'train-refund-3',
        taskType: 'refund',
        failureTurn: 3,
        evidence: [{ turn: 2, note: 'Read 11/02/2026 as February 11.' }],
        cause: 'Dates written month first',
        categoryId: 'cat_dates',
      },
    ],
    setAside: [],
    edits: [],
    workedExamples: [],
    practicePerFinding: 1,
    predicted: { devDeltaMin: 1, devDeltaMax: 3, rationale: 'Three dev refunds turn on dates.' },
    estimatedCost: { mentorUsd: 0.4, computeUsd: 0, minutes: 20 },
    verificationPlan: 'Replay from turn 3, check the row and the refund.',
    parent: { harnessVersion: 1, adapter: null },
    status,
    createdAt: AT,
  };
}

function lesson(id: string, status: Lesson['status'], round = 1): Lesson {
  return {
    id,
    jobId: 'job_1',
    runId: 'run_1',
    round,
    interventionId: 'itv_1',
    status,
    reason: status === 'verified' ? 'The return row matches.' : 'The replay diverged at turn 2.',
    kind: 'replay_correction',
    categoryId: 'cat_dates',
    taskType: 'refund',
    source: { kind: 'attempt', attemptId: 'att_1', taskId: 'train-refund-3' },
    checkpoint: { turn: 3, replayedCalls: 2, fallback: 'none' },
    check: null,
    audit: null,
    turns: [],
    episode: null,
    actorModel: 'fake-mentor-1',
    cost: { usd: 0.01, inputTokens: 100, outputTokens: 20, calls: 1 },
    createdAt: AT,
  };
}

function experiment(round: number, disposition: Experiment['disposition']): Experiment {
  return {
    id: `exp_${round}`,
    runId: 'run_1',
    round,
    interventionId: `itv_${round}`,
    kind: 'harness',
    title: 'Read dates both ways',
    inputs: {
      baseVersion: 1,
      candidateVersion: 2,
      incumbentAdapter: null,
      candidateAdapter: null,
      lessonIds: [],
      datasetSha256: null,
      trainingJobId: null,
      trainingBackend: null,
    },
    recipe: null,
    seeds: { dev: [101], train: 7 },
    decoding: null,
    measurements: [],
    devBefore: { pass: 30, total: 45 },
    devAfter: { pass: 34, total: 45 },
    perType: [{ type: 'refund', before: 10, after: 14 }],
    regressions: [],
    gates: [],
    budget: {
      mentorUsd: 0.2,
      mentorInputTokens: 1000,
      mentorOutputTokens: 300,
      studentUsd: 0.9,
      studentInputTokens: 50_000,
      studentOutputTokens: 9_000,
      computeUsd: 0,
      computeMinutes: 0,
      examples: 0,
      trainedTokens: 0,
      attempts: 90,
      minutes: 12,
    },
    disposition,
    reason: 'Dev 30/45 to 34/45.',
    startedAt: AT,
    endedAt: AT,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-mentoring-store-'));
  store = openEngineStore(join(dir, 'architect.db'));
  store.jobs.insert({
    id: 'job_1',
    name: 'Returns desk',
    path: 'jobs/job_1',
    taskCount: 180,
    createdAt: AT,
    updatedAt: AT,
  });
  store.runs.insert(run());
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the mentoring migration', () => {
  it('is the last migration, so another branch can renumber it in one place', () => {
    expect(MIGRATIONS.at(-1)).toBe(MENTORING_MIGRATION);
    expect(MENTORING_MIGRATION.version).toBe(MIGRATIONS.length);
  });

  it('keeps runs and attempts from before it readable, as the student with no adapter', () => {
    const earlier = join(dir, 'earlier.db');
    const db = openDatabase(
      earlier,
      MIGRATIONS.filter(({ version }) => version < MENTORING_MIGRATION.version),
    );
    const old = createEngineStore(db);
    old.jobs.insert({
      id: 'job_1',
      name: 'Returns desk',
      path: 'jobs/job_1',
      taskCount: 180,
      createdAt: AT,
      updatedAt: AT,
    });
    db.prepare(
      `INSERT INTO runs (id, job_id, method, seed, seeds, status, phase, today, locked_test_on,
        stop_requested, current_version, totals, created_at, updated_at)
       VALUES ('run_old', 'job_1', 'architect', 7, :seeds, 'finished', 'done', '2026-11-24',
        'local', 0, 2, :totals, :at, :at)`,
    ).run({
      seeds: JSON.stringify(run().seeds),
      totals: JSON.stringify(emptyTotals()),
      at: AT,
    });
    db.prepare(
      `INSERT INTO attempts (id, run_id, round, split, harness_version, task_id, task_type, target,
        seed, pass, reason, stop_reason, latency_ms, input_tokens, output_tokens, created_at)
       VALUES ('att_old', 'run_old', 1, 'dev', 2, 'dev-refund-1', 'refund', 'local', 11, 1,
        'Recorded.', 'answer', 900, 10, 2, :at)`,
    ).run({ at: AT });
    db.close();

    const migrated = openEngineStore(earlier);
    const record = migrated.runs.get('run_old');
    expect(record?.interactive).toBeUndefined();
    expect(record?.run.currentAdapter).toBeUndefined();
    const read = migrated.attempts.get('att_old');
    expect(read?.config).toBeUndefined();
    expect(migrated.attempts.list({ runId: 'run_old', config: 'student' })).toHaveLength(1);
    expect(migrated.experiments.list('run_old')).toEqual([]);
    migrated.close();
  });
});

describe('the mentoring records', () => {
  it('keeps an attempt per configuration, so adapter-on and adapter-off never share one', () => {
    store.attempts.insert(attempt('att_student'));
    store.attempts.insert(attempt('att_adapter', 'student/llama.cpp/trn_1@1'));
    store.attempts.insert(attempt('att_off', 'student/llama.cpp/trn_1@0'));
    expect(() => store.attempts.insert(attempt('att_again', 'student/llama.cpp/trn_1@1'))).toThrow(
      /UNIQUE/,
    );
    expect(store.attempts.list({ runId: 'run_1', config: 'student' }).map((a) => a.id)).toEqual([
      'att_student',
    ]);
    expect(
      store.attempts.list({ runId: 'run_1', config: 'student/llama.cpp/trn_1@1' }).map((a) => a.id),
    ).toEqual(['att_adapter']);
    expect(store.attempts.list({ runId: 'run_1' })).toHaveLength(3);
  });

  it('round-trips a run that can be asked a question and the adapter it kept', () => {
    const adapter = {
      id: 'trn_abc',
      path: 'training/jobs/trn_abc/artifacts/adapter.gguf',
      sha256: 'a'.repeat(64),
      standIn: true,
      label: 'Stand-in: no model is trained',
    };
    const record = run('run_2');
    store.runs.insert({
      ...record,
      interactive: true,
      run: { ...record.run, currentAdapter: adapter },
    });
    expect(store.runs.get('run_2')?.interactive).toBe(true);
    expect(store.runs.get('run_2')?.run.currentAdapter).toEqual(adapter);
  });

  it('keeps one intervention per round, replaced as it changes', () => {
    store.interventions.put(intervention(1));
    store.interventions.put({ ...intervention(1), trainingJobId: 'trn_abc' });
    store.interventions.put(intervention(2, 'invalid'));
    expect(store.interventions.get('run_1', 1)?.trainingJobId).toBe('trn_abc');
    expect(store.interventions.list('run_1').map((item) => [item.round, item.status])).toEqual([
      [1, 'accepted'],
      [2, 'invalid'],
    ]);
  });

  it('writes a lesson once by its id, however often a retry writes it', () => {
    store.lessons.put(lesson('lsn_a', 'rejected'));
    store.lessons.put(lesson('lsn_b', 'verified'));
    store.lessons.put(lesson('lsn_b', 'verified'));
    store.lessons.put(lesson('lsn_c', 'verified', 2));
    expect(store.lessons.list({ runId: 'run_1' }).map((item) => item.id)).toEqual([
      'lsn_a',
      'lsn_b',
      'lsn_c',
    ]);
    expect(store.lessons.list({ runId: 'run_1', status: 'verified' })).toHaveLength(2);
    expect(store.lessons.list({ runId: 'run_1', round: 2 }).map((item) => item.id)).toEqual([
      'lsn_c',
    ]);
    expect(store.lessons.list({ jobId: 'job_1' })).toHaveLength(3);
    expect(store.lessons.get('lsn_a')?.reason).toBe('The replay diverged at turn 2.');
  });

  it('keeps one experiment per round, with every disposition', () => {
    store.experiments.put(experiment(1, 'kept'));
    store.experiments.put(experiment(2, 'invalid'));
    store.experiments.put(experiment(2, 'stopped'));
    expect(store.experiments.list('run_1').map((item) => [item.round, item.disposition])).toEqual([
      [1, 'kept'],
      [2, 'stopped'],
    ]);
    expect(store.experiments.get('run_1', 1)?.budget.studentUsd).toBe(0.9);
  });

  it('gives a category one slug per job and keeps its id', () => {
    const category = {
      id: 'cat_dates',
      jobId: 'job_1',
      slug: 'dates-written-another-way',
      label: 'Dates written another way',
      taskType: 'refund',
      createdAt: AT,
    };
    store.categories.insert(category);
    expect(() => store.categories.insert({ ...category, id: 'cat_other' })).toThrow(/UNIQUE/);
    expect(store.categories.list('job_1')).toEqual([category]);
    expect(store.categories.get('cat_dates')).toEqual(category);
  });

  it('keeps one reference per run and split, and finds the ones still running', () => {
    const reference: ReferenceRecord = {
      runId: 'run_1',
      split: 'test',
      harnessVersion: 2,
      model: 'fake-mentor-1',
      configKey: 'reference/fake-mentor-1',
      status: 'running',
      maxUsd: 4,
      spentUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      seed: 101,
      score: null,
      perType: [],
      latencyMs: null,
      startedAt: AT,
    };
    store.references.put(reference);
    store.references.put({ ...reference, split: 'dev', status: 'finished' });
    expect(store.references.withStatus('running').map((item) => item.split)).toEqual(['test']);
    expect(store.references.list('run_1')).toHaveLength(2);
    expect(store.references.get('run_1', 'dev')?.status).toBe('finished');
  });
});

describe('when teaching stops', () => {
  /** A round that taught the category `cat_dates` of refunds and ended as `disposition`. */
  function taughtRound(round: number, disposition: Experiment['disposition'], gain = 0) {
    store.interventions.put({ ...intervention(round), id: `itv_${round}` });
    store.experiments.put({
      ...experiment(round, disposition),
      devBefore: { pass: 30, total: 45 },
      devAfter: { pass: 30 + gain, total: 45 },
    });
  }

  it('stops a category after two rounds without a dev gain, and a type after four', () => {
    taughtRound(1, 'reverted');
    expect(stoppedFromRecords(store, 'run_1').categories.size).toBe(0);
    taughtRound(2, 'rejected');
    expect(stoppedFromRecords(store, 'run_1')).toEqual({
      categories: new Set(['cat_dates']),
      types: new Set(),
    });
    // A round refused before it taught or measured anything doesn't count.
    taughtRound(3, 'invalid');
    taughtRound(4, 'reverted');
    expect(stoppedFromRecords(store, 'run_1').types.size).toBe(0);
    taughtRound(5, 'reverted');
    expect(stoppedFromRecords(store, 'run_1').types).toEqual(new Set(['refund']));
  });

  it('starts the count again after a kept gain, and a stopped round never counts', () => {
    taughtRound(1, 'reverted');
    taughtRound(2, 'kept', 3);
    taughtRound(3, 'stopped');
    taughtRound(4, 'reverted');
    expect(stoppedFromRecords(store, 'run_1').categories.size).toBe(0);
    taughtRound(5, 'reverted');
    expect(stoppedFromRecords(store, 'run_1').categories).toEqual(new Set(['cat_dates']));
  });
});
