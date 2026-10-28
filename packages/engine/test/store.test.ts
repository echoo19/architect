import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emptyTotals, type ReportCard, type StudentTarget } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/store/database';
import { createEngineStore, openEngineStore, type EngineStore } from '../src/store/engine-store';
import { MIGRATIONS } from '../src/store/migrations';
import type {
  JobRecord,
  StoredAttempt,
  StoredRetest,
  StoredRound,
  StoredRun,
} from '../src/store/records';

const AT = '2026-10-27T14:00:00.000Z';
const LATER = '2026-10-28T09:00:00.000Z';
let dir: string;
let store: EngineStore;

function file() {
  return join(dir, 'architect.db');
}

function card(runId: string, testedOn: StudentTarget, createdAt = AT): ReportCard {
  return {
    jobId: 'job_1',
    runId,
    method: 'architect',
    name: 'Service desk',
    createdAt,
    student: { label: 'Glimmer', model: 'glimmer:test', runtime: 'ollama' },
    testedOn,
    mentor: { label: 'Spark', model: 'fake-mentor-1' },
    test: {
      score: { pass: 3, total: 6 },
      perType: [],
      latencyMs: { p50: 1000, p95: 2000 },
      refusals: 0,
      ranOffline: testedOn === 'local',
    },
    dev: { baseline: null, final: null, curve: [] },
    cost: { mentorUsd: 0, mentorInputTokens: 0, mentorOutputTokens: 0, rounds: 0, wallMs: 0 },
    refusedTypes: [],
    topInterventions: [],
    requirements: { passRate: { target: 0.9, actual: 0.5, met: false } },
    overclaim: null,
  };
}

function storedRun(id = 'run_1'): StoredRun {
  return {
    run: {
      id,
      jobId: 'job_1',
      method: 'architect',
      seed: 7,
      status: 'running',
      phase: 'attempting',
      createdAt: AT,
      updatedAt: AT,
      currentVersion: 1,
      devBaseline: { pass: 3, total: 9 },
      devCurrent: { pass: 5, total: 9 },
      totals: { ...emptyTotals(), rounds: 1, attempts: 12, mentorUsd: 0.01 },
      stopReason: 'rounds',
    },
    seeds: { trainBatch: 11, trainStudent: 12, devPanel: 13, test: 14, mentor: 15 },
    today: '2026-10-27',
    lockedTestOn: 'local',
    stopRequested: true,
    freeze: {
      graduateId: 'grd_1',
      harnessVersion: 1,
      harnessHash: 'sha256-abc',
      student: { model: 'glimmer:test', digest: 'sha256:fake' },
      frozenAt: AT,
    },
  };
}

function attempt(id: string, round: number | null, split: 'dev' | 'test' = 'dev'): StoredAttempt {
  return {
    id,
    runId: 'run_1',
    round,
    taskId: 'dev-invoice-1',
    taskType: 'invoice',
    split,
    harnessVersion: 0,
    check: { pass: true, reason: 'The answer matches.', details: { total: 1200 } },
    latencyMs: 1500,
    usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
    answerSummary: '{"ok":true}',
    expectedSummary: '{"ok":true}',
    target: 'local',
    seed: 11,
    stopReason: 'answer',
    tracePath: split === 'test' ? null : `jobs/job_1/runs/run_1/traces/${id}.json`,
    createdAt: AT,
  };
}

const JOB: JobRecord = {
  id: 'job_1',
  name: 'Service desk',
  path: 'jobs/job_1',
  taskCount: 21,
  createdAt: AT,
  updatedAt: AT,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-store-'));
  store = openEngineStore(file());
  store.jobs.insert(JOB);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('opens in WAL mode with foreign keys on and records each migration once', () => {
    store.close();
    store = openEngineStore(file());
    const db = new DatabaseSync(file());
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('SELECT version, name FROM migrations ORDER BY version').all()).toEqual(
      MIGRATIONS.map(({ version, name }) => ({ version, name })),
    );
    db.close();
    const fresh = openDatabase(join(dir, 'other.db'), MIGRATIONS);
    expect(fresh.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    fresh.close();
  });

  it('lets two processes open the same fresh database without applying anything twice', () => {
    const shared = join(dir, 'shared.db');
    const first = new DatabaseSync(shared);
    first.exec('PRAGMA journal_mode = WAL');
    const second = openDatabase(shared, MIGRATIONS);
    expect(() => migrate(first, MIGRATIONS)).not.toThrow();
    expect(first.prepare('SELECT count(*) AS n FROM migrations').get()).toEqual({
      n: MIGRATIONS.length,
    });
    first.close();
    second.close();
  });

  it('applies only the migrations a database has not seen', () => {
    store.close();
    const next = MIGRATIONS.length + 1;
    const later = [
      ...MIGRATIONS,
      { version: next, name: 'notes', sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY)' },
    ];
    openDatabase(file(), later).close();
    const db = openDatabase(file(), later);
    expect(db.prepare('SELECT version FROM migrations ORDER BY version').all()).toEqual(
      later.map(({ version }) => ({ version })),
    );
    expect(db.prepare('SELECT count(*) AS n FROM jobs').get()).toEqual({ n: 1 });
    db.close();
    store = openEngineStore(file());
  });

  it('files each earlier report card under the endpoint its run tested on', () => {
    const earlier = join(dir, 'earlier.db');
    const db = openDatabase(
      earlier,
      MIGRATIONS.filter(({ version }) => version <= 3),
    );
    const old = createEngineStore(db);
    old.jobs.insert(JOB);
    old.runs.insert(storedRun('run_1'));
    old.runs.insert({ ...storedRun('run_2'), lockedTestOn: 'hosted' });
    const insert = db.prepare('INSERT INTO reports (run_id, card, created_at) VALUES (?, ?, ?)');
    for (const [runId, target] of [
      ['run_1', 'local'],
      ['run_2', 'hosted'],
    ] as const) {
      const { testedOn: _, ...written } = card(runId, target);
      insert.run(runId, JSON.stringify(written), AT);
    }
    db.close();

    const migrated = openEngineStore(earlier);
    expect(migrated.reports.targets('run_1')).toEqual(['local']);
    expect(migrated.reports.get('run_1', 'local')).toEqual(card('run_1', 'local'));
    expect(migrated.reports.targets('run_2')).toEqual(['hosted']);
    expect(migrated.reports.get('run_2', 'hosted')).toEqual(card('run_2', 'hosted'));
    expect(migrated.reports.get('run_2', 'local')).toBeNull();
    migrated.close();
  });

  it('marks the only round of earlier one-shot runs as a draft', () => {
    const earlier = join(dir, 'drafts.db');
    const db = openDatabase(
      earlier,
      MIGRATIONS.filter(({ version }) => version <= 7),
    );
    const old = createEngineStore(db);
    old.jobs.insert(JOB);
    const oneShot = storedRun('run_one_shot');
    old.runs.insert({ ...oneShot, run: { ...oneShot.run, method: 'one_shot' } });
    old.runs.insert(storedRun('run_architect'));
    const roundOf = (runId: string): StoredRound => ({
      round: {
        runId,
        index: 1,
        status: 'decided',
        train: { pass: 0, total: 0 },
        files: [],
        costUsd: 0,
        startedAt: AT,
      },
      baseVersion: 1,
      reply: null,
      hypothesis: null,
      rejected: false,
    });
    old.rounds.insert(roundOf('run_one_shot'));
    old.rounds.insert(roundOf('run_architect'));
    db.close();

    const migrated = openEngineStore(earlier);
    expect(migrated.rounds.get('run_one_shot', 1)?.round.draft).toBe(true);
    expect(migrated.rounds.get('run_architect', 1)?.round.draft).toBeUndefined();
    migrated.close();
  });

  it('rolls back a migration that fails, leaving the database as it was', () => {
    store.close();
    const broken = [
      ...MIGRATIONS,
      { version: MIGRATIONS.length + 1, name: 'broken', sql: 'CREATE TABLE x (; nonsense' },
    ];
    expect(() => openDatabase(file(), broken)).toThrow();
    store = openEngineStore(file());
    expect(store.jobs.list()).toHaveLength(1);
  });
});

describe('repositories', () => {
  it('round-trips jobs and runs', () => {
    expect(store.jobs.get('job_1')?.name).toBe('Service desk');
    const record = storedRun();
    store.runs.insert(record);
    expect(store.runs.get('run_1')).toEqual(record);
    const updated: StoredRun = {
      ...record,
      run: { ...record.run, status: 'paused', error: 'Ollama is not running.' },
      stopRequested: false,
      freeze: null,
    };
    store.runs.update(updated);
    expect(store.runs.get('run_1')).toEqual(updated);
    expect(store.runs.withStatus(['paused']).map((r) => r.run.id)).toEqual(['run_1']);
    expect(store.runs.withStatus(['running'])).toEqual([]);
    expect(store.runs.list('job_1')).toHaveLength(1);
  });

  it('round-trips rounds with their reply and hypothesis', () => {
    store.runs.insert(storedRun());
    const round: StoredRound = {
      round: {
        runId: 'run_1',
        index: 1,
        status: 'evaluating',
        train: { pass: 2, total: 6 },
        title: 'Add the invoice procedure',
        diagnosis: 'No pricing rule.',
        predicted: { devDeltaMin: 1, devDeltaMax: 3, rationale: 'Three tasks.' },
        files: ['AGENTS.md'],
        candidateVersion: 1,
        costUsd: 0.004,
        startedAt: AT,
      },
      baseVersion: 0,
      reply: {
        text: '{}',
        json: { title: 'x' },
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.004,
        model: 'fake-mentor-1',
        latencyMs: 5,
        fix: 0,
      },
      hypothesis: {
        title: 'Add the invoice procedure',
        diagnosis: 'No pricing rule.',
        edits: [{ op: 'write', path: 'AGENTS.md', content: 'fix:invoice' }],
        causeTaskIds: ['train-invoice-1'],
        predicted: { devDeltaMin: 1, devDeltaMax: 3, rationale: 'Three tasks.' },
        readyClaim: true,
      },
      rejected: false,
    };
    store.rounds.insert(round);
    expect(store.rounds.get('run_1', 1)).toEqual(round);
    const decided: StoredRound = {
      ...round,
      round: { ...round.round, status: 'decided', decision: 'kept', decisionReason: 'Dev up.' },
    };
    store.rounds.update(decided);
    expect(store.rounds.list('run_1')).toEqual([decided]);
    const rejected: StoredRound = {
      ...round,
      round: { ...round.round, index: 2, status: 'failed', error: 'tools/x.json: bad name.' },
      hypothesis: null,
      rejected: true,
    };
    store.rounds.insert(rejected);
    expect(store.rounds.get('run_1', 2)).toEqual(rejected);
  });

  it('keeps one attempt per task per seed of an evaluation, rounds or not', () => {
    store.runs.insert(storedRun());
    store.attempts.insert(attempt('att_1', null));
    store.attempts.insert(attempt('att_2', 1));
    expect(() => store.attempts.insert(attempt('att_3', null))).toThrow(/UNIQUE/);
    expect(() => store.attempts.insert(attempt('att_4', 1))).toThrow(/UNIQUE/);
    expect(store.attempts.get('att_1')).toEqual(attempt('att_1', null));
    expect(store.attempts.list({ runId: 'run_1', round: null }).map((a) => a.id)).toEqual([
      'att_1',
    ]);
    expect(store.attempts.list({ runId: 'run_1', round: 1 }).map((a) => a.id)).toEqual(['att_2']);
    store.attempts.insert(attempt('att_5', null, 'test'));
    expect(store.attempts.get('att_5')?.tracePath).toBeNull();
    expect(store.attempts.recent('run_1', ['dev'], 10).map((a) => a.id)).toEqual([
      'att_2',
      'att_1',
    ]);
    store.attempts.insert({ ...attempt('att_6', 1), seed: 12 });
    expect(store.attempts.list({ runId: 'run_1', round: 1 }).map((a) => a.seed)).toEqual([11, 12]);
  });

  it('keeps one re-test per run and target, and finds the ones still testing', () => {
    store.runs.insert(storedRun('run_1'));
    store.runs.insert(storedRun('run_2'));
    const first: StoredRetest = {
      runId: 'run_1',
      target: 'local',
      status: 'testing',
      startedAt: AT,
    };
    store.retests.insert(first);
    store.retests.insert({ ...first, runId: 'run_2', startedAt: LATER });
    expect(() => store.retests.insert(first)).toThrow(/UNIQUE/);
    expect(store.retests.get('run_1', 'local')).toEqual(first);
    expect(store.retests.get('run_1', 'hosted')).toBeNull();

    const paused: StoredRetest = { ...first, status: 'paused', error: 'Ollama is not running.' };
    store.retests.update(paused);
    expect(store.retests.get('run_1', 'local')).toEqual(paused);
    expect(store.retests.withStatus('testing').map((retest) => retest.runId)).toEqual(['run_2']);
    store.retests.update({ ...first, status: 'testing' });
    expect(store.retests.withStatus('testing').map((retest) => retest.runId)).toEqual([
      'run_1',
      'run_2',
    ]);
    expect(store.retests.get('run_1', 'local')?.error).toBeUndefined();
  });

  it('keeps one report card per run and student endpoint', () => {
    store.runs.insert(storedRun());
    store.reports.put(card('run_1', 'hosted'));
    store.reports.put(card('run_1', 'local', LATER));
    expect(store.reports.targets('run_1')).toEqual(['hosted', 'local']);
    expect(store.reports.get('run_1', 'hosted')).toEqual(card('run_1', 'hosted'));
    expect(store.reports.get('run_1', 'local')).toEqual(card('run_1', 'local', LATER));

    const rescored = card('run_1', 'hosted');
    rescored.test.score = { pass: 4, total: 6 };
    store.reports.put(rescored);
    expect(store.reports.targets('run_1')).toEqual(['hosted', 'local']);
    expect(store.reports.get('run_1', 'hosted')?.test.score).toEqual({ pass: 4, total: 6 });
    expect(store.reports.targets('run_2')).toEqual([]);
  });

  it('parses every row it reads, so a malformed row is an error, not bad data', () => {
    store.runs.insert(storedRun());
    store.reports.put({ runId: 'run_1', testedOn: 'local', createdAt: AT } as ReportCard);
    expect(() => store.reports.get('run_1', 'local')).toThrow(/expected/);
  });

  it('rolls back a transaction that throws', () => {
    store.runs.insert(storedRun());
    expect(() =>
      store.transaction(() => {
        store.attempts.insert(attempt('att_1', null));
        throw new Error('crash');
      }),
    ).toThrow('crash');
    expect(store.attempts.list({ runId: 'run_1' })).toEqual([]);
  });

  it('round-trips lineage, costs, reports, graduates, chats and messages', () => {
    store.runs.insert(storedRun());
    const lineage = {
      id: 'chg_1',
      runId: 'run_1',
      round: 1,
      title: 'Add the invoice procedure',
      decision: 'kept' as const,
      delta: 3,
      versionFrom: 0,
      versionTo: 1,
      at: AT,
    };
    store.lineage.insert(lineage);
    expect(store.lineage.list('run_1')).toEqual([lineage]);

    const cost = {
      runId: 'run_1',
      role: 'mentor' as const,
      model: 'fake-mentor-1',
      round: 1,
      attemptId: null,
      usage: { inputTokens: 2000, outputTokens: 500 },
      usd: 0.004625,
      at: AT,
    };
    store.costs.insert(cost);
    store.costs.insert({ ...cost, role: 'student', usd: null, attemptId: 'att_1' });
    expect(store.costs.list('run_1')).toEqual([
      cost,
      { ...cost, role: 'student', usd: null, attemptId: 'att_1' },
    ]);

    const manifest = {
      format: 1 as const,
      id: 'grd_1',
      name: 'Service desk',
      jobId: 'job_1',
      runId: 'run_1',
      method: 'architect' as const,
      createdAt: AT,
      student: {
        label: 'Glimmer',
        runtime: 'ollama' as const,
        baseUrl: 'http://127.0.0.1:11434',
        model: 'glimmer:test',
        contextLength: 16_384,
      },
      harness: { version: 1, hash: 'sha256-abc' },
      requirements: { passRate: { target: 0.9, actual: 0.5, met: false } },
      test: { score: { pass: 3, total: 6 }, perType: [] },
      mentor: { label: 'Spark', model: 'fake-mentor-1' },
    };
    const graduate = {
      id: 'grd_1',
      runId: 'run_1',
      name: 'Service desk',
      path: 'graduates/grd_1',
      manifest,
      settings: { writeMode: 'allow' as const },
      createdAt: AT,
    };
    store.graduates.insert(graduate);
    expect(store.graduates.forRun('run_1')).toEqual(graduate);

    const chat = {
      id: 'cht_1',
      graduateId: 'grd_1',
      title: 'Close out today',
      createdAt: AT,
      updatedAt: AT,
      running: false,
      waiting: true,
    };
    store.chats.insert(chat);
    const message = {
      id: 'msg_1',
      chatId: 'cht_1',
      role: 'agent' as const,
      createdAt: AT,
      text: 'Done.',
      steps: [],
      blocks: [{ kind: 'note' as const, text: 'Invoice 1042 created.' }],
      status: 'done' as const,
    };
    store.messages.insert(message);
    expect(store.chats.list('grd_1')).toEqual([chat]);
    expect(store.messages.list('cht_1')).toEqual([message]);
    store.messages.update({ ...message, text: 'Done, twice.' });
    expect(store.messages.list('cht_1')[0]?.text).toBe('Done, twice.');

    store.graduates.remove('grd_1');
    expect(store.graduates.list()).toEqual([]);
    expect(store.chats.list('grd_1')).toEqual([]);
  });
});
