import type { DatabaseSync } from 'node:sqlite';
import {
  ReportCardSchema,
  StudentTargetSchema,
  WorkspaceChatSchema,
  WorkspaceMessageSchema,
  type ReportCard,
  type RunStatus,
  type SplitName,
  type StudentTarget,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import { inTransaction, openDatabase, type Migration } from './database';
import { MIGRATIONS } from './migrations';
import {
  CostEntrySchema,
  GraduateRecordSchema,
  JobRecordSchema,
  LineageIndexSchema,
  StoredAttemptSchema,
  StoredRetestSchema,
  StoredRoundSchema,
  StoredRunSchema,
  type CostEntry,
  type GraduateRecord,
  type JobRecord,
  type LineageIndex,
  type RetestStatus,
  type StoredAttempt,
  type StoredRetest,
  type StoredRound,
  type StoredRun,
} from './records';
import {
  flag,
  fromJson,
  inList,
  json,
  jsonOrNull,
  orUndefined,
  Statements,
  type Params,
  type Row,
} from './sql';

export interface AttemptFilter {
  runId: string;
  split?: SplitName;
  version?: number;
  /** A round number, or null for attempts outside rounds (baseline dev, locked test). */
  round?: number | null;
  target?: StudentTarget;
}

/** Everything the engine persists. SQLite sits behind this so it can be swapped (decision 013). */
export interface EngineStore {
  /** Runs `fn` atomically. `fn` must be synchronous. */
  transaction<T>(fn: () => T): T;
  close(): void;
  jobs: {
    insert(job: JobRecord): void;
    update(job: JobRecord): void;
    get(id: string): JobRecord | null;
    list(): JobRecord[];
  };
  runs: {
    insert(record: StoredRun): void;
    update(record: StoredRun): void;
    get(id: string): StoredRun | null;
    /** Newest first. */
    list(jobId?: string): StoredRun[];
    /** Oldest first, so interrupted runs resume in the order they started. */
    withStatus(statuses: readonly RunStatus[]): StoredRun[];
  };
  rounds: {
    insert(record: StoredRound): void;
    update(record: StoredRound): void;
    get(runId: string, index: number): StoredRound | null;
    list(runId: string): StoredRound[];
  };
  attempts: {
    insert(attempt: StoredAttempt): void;
    get(id: string): StoredAttempt | null;
    /** Oldest first. */
    list(filter: AttemptFilter): StoredAttempt[];
    /** Newest first. */
    recent(runId: string, splits: readonly SplitName[], limit: number): StoredAttempt[];
  };
  lineage: {
    insert(row: LineageIndex): void;
    list(runId: string): LineageIndex[];
  };
  costs: {
    insert(entry: CostEntry): void;
    list(runId: string): CostEntry[];
  };
  /** One report card per run and student endpoint its graduate was tested on. */
  reports: {
    /** Files the card under its own run and `testedOn`, replacing any card already there. */
    put(card: ReportCard): void;
    get(runId: string, target: StudentTarget): ReportCard | null;
    /** The endpoints the run has a card from, oldest card first. */
    targets(runId: string): StudentTarget[];
  };
  retests: {
    /** Fails if the run already has a re-test on that target. */
    insert(retest: StoredRetest): void;
    update(retest: StoredRetest): void;
    get(runId: string, target: StudentTarget): StoredRetest | null;
    /** Oldest first, so interrupted re-tests resume in the order they started. */
    withStatus(status: RetestStatus): StoredRetest[];
  };
  graduates: {
    insert(record: GraduateRecord): void;
    update(record: GraduateRecord): void;
    get(id: string): GraduateRecord | null;
    forRun(runId: string): GraduateRecord | null;
    /** Newest first. */
    list(): GraduateRecord[];
    remove(id: string): void;
  };
  chats: {
    insert(chat: WorkspaceChat): void;
    update(chat: WorkspaceChat): void;
    get(id: string): WorkspaceChat | null;
    /** Most recently updated first. */
    list(graduateId: string): WorkspaceChat[];
  };
  messages: {
    insert(message: WorkspaceMessage): void;
    update(message: WorkspaceMessage): void;
    /** Oldest first. */
    list(chatId: string): WorkspaceMessage[];
  };
}

export function openEngineStore(
  file: string,
  migrations: readonly Migration[] = MIGRATIONS,
): EngineStore {
  return createEngineStore(openDatabase(file, migrations));
}

function jobParams(job: JobRecord): Params {
  return {
    id: job.id,
    name: job.name,
    summary: job.summary ?? null,
    path: job.path,
    task_count: job.taskCount,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

function jobFromRow(row: Row): JobRecord {
  return JobRecordSchema.parse({
    id: row.id,
    name: row.name,
    summary: orUndefined(row.summary),
    path: row.path,
    taskCount: row.task_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function runParams({ run, ...record }: StoredRun): Params {
  return {
    id: run.id,
    job_id: run.jobId,
    method: run.method,
    seed: run.seed,
    seeds: json(record.seeds),
    status: run.status,
    phase: run.phase,
    today: record.today,
    locked_test_on: record.lockedTestOn,
    stop_requested: flag(record.stopRequested),
    current_version: run.currentVersion,
    dev_baseline: jsonOrNull(run.devBaseline),
    dev_current: jsonOrNull(run.devCurrent),
    totals: json(run.totals),
    stop_reason: run.stopReason ?? null,
    error: run.error ?? null,
    freeze: jsonOrNull(record.freeze),
    graduate_id: run.graduateId ?? null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    ended_at: run.endedAt ?? null,
  };
}

function runFromRow(row: Row): StoredRun {
  return StoredRunSchema.parse({
    run: {
      id: row.id,
      jobId: row.job_id,
      method: row.method,
      seed: row.seed,
      status: row.status,
      phase: row.phase,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      endedAt: orUndefined(row.ended_at),
      currentVersion: row.current_version,
      devBaseline: fromJson(row.dev_baseline),
      devCurrent: fromJson(row.dev_current),
      totals: fromJson(row.totals),
      stopReason: orUndefined(row.stop_reason),
      error: orUndefined(row.error),
      graduateId: orUndefined(row.graduate_id),
    },
    seeds: fromJson(row.seeds),
    today: row.today,
    lockedTestOn: row.locked_test_on,
    stopRequested: row.stop_requested === 1,
    freeze: fromJson(row.freeze),
  });
}

function roundParams({ round, ...record }: StoredRound): Params {
  return {
    run_id: round.runId,
    idx: round.index,
    draft: flag(round.draft === true),
    status: round.status,
    base_version: record.baseVersion,
    train: json(round.train),
    reply: jsonOrNull(record.reply),
    hypothesis: jsonOrNull(record.hypothesis),
    rejected: flag(record.rejected),
    title: round.title ?? null,
    diagnosis: round.diagnosis ?? null,
    predicted: jsonOrNull(round.predicted),
    files: json(round.files),
    candidate_version: round.candidateVersion ?? null,
    dev_before: jsonOrNull(round.devBefore),
    dev_after: jsonOrNull(round.devAfter),
    first_measurement: jsonOrNull(round.firstMeasurement),
    decision: round.decision ?? null,
    decision_reason: round.decisionReason ?? null,
    cost_usd: round.costUsd,
    error: round.error ?? null,
    started_at: round.startedAt,
    ended_at: round.endedAt ?? null,
  };
}

function roundFromRow(row: Row): StoredRound {
  return StoredRoundSchema.parse({
    round: {
      runId: row.run_id,
      index: row.idx,
      ...(row.draft === 1 ? { draft: true } : {}),
      status: row.status,
      train: fromJson(row.train),
      title: orUndefined(row.title),
      diagnosis: orUndefined(row.diagnosis),
      predicted: orUndefined(fromJson(row.predicted)),
      files: fromJson(row.files),
      candidateVersion: orUndefined(row.candidate_version),
      devBefore: orUndefined(fromJson(row.dev_before)),
      devAfter: orUndefined(fromJson(row.dev_after)),
      firstMeasurement: orUndefined(fromJson(row.first_measurement)),
      decision: orUndefined(row.decision),
      decisionReason: orUndefined(row.decision_reason),
      costUsd: row.cost_usd,
      startedAt: row.started_at,
      endedAt: orUndefined(row.ended_at),
      error: orUndefined(row.error),
    },
    baseVersion: row.base_version,
    reply: fromJson(row.reply),
    hypothesis: fromJson(row.hypothesis),
    rejected: row.rejected === 1,
  });
}

function attemptParams(attempt: StoredAttempt): Params {
  return {
    id: attempt.id,
    run_id: attempt.runId,
    round: attempt.round,
    split: attempt.split,
    harness_version: attempt.harnessVersion,
    task_id: attempt.taskId,
    task_type: attempt.taskType,
    target: attempt.target,
    seed: attempt.seed,
    pass: flag(attempt.check.pass),
    reason: attempt.check.reason,
    details: jsonOrNull(attempt.check.details),
    stop_reason: attempt.stopReason,
    latency_ms: attempt.latencyMs,
    input_tokens: attempt.usage.inputTokens,
    output_tokens: attempt.usage.outputTokens,
    reasoning_tokens: attempt.usage.reasoningTokens ?? null,
    cached_input_tokens: attempt.usage.cachedInputTokens ?? null,
    answer_summary: attempt.answerSummary ?? null,
    expected_summary: attempt.expectedSummary ?? null,
    trace_path: attempt.tracePath,
    created_at: attempt.createdAt,
  };
}

function attemptFromRow(row: Row): StoredAttempt {
  return StoredAttemptSchema.parse({
    id: row.id,
    runId: row.run_id,
    round: row.round,
    taskId: row.task_id,
    taskType: row.task_type,
    split: row.split,
    harnessVersion: row.harness_version,
    check: {
      pass: row.pass === 1,
      reason: row.reason,
      details: orUndefined(fromJson(row.details)),
    },
    latencyMs: row.latency_ms,
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: orUndefined(row.reasoning_tokens),
      cachedInputTokens: orUndefined(row.cached_input_tokens),
    },
    answerSummary: orUndefined(row.answer_summary),
    expectedSummary: orUndefined(row.expected_summary),
    target: row.target,
    seed: row.seed,
    stopReason: row.stop_reason,
    tracePath: row.trace_path,
    createdAt: row.created_at,
  });
}

function lineageFromRow(row: Row): LineageIndex {
  return LineageIndexSchema.parse({
    id: row.id,
    runId: row.run_id,
    round: row.round,
    title: row.title,
    decision: row.decision,
    delta: row.delta,
    versionFrom: row.version_from,
    versionTo: row.version_to,
    at: row.at,
  });
}

function costFromRow(row: Row): CostEntry {
  return CostEntrySchema.parse({
    runId: row.run_id,
    role: row.role,
    model: row.model,
    round: row.round,
    attemptId: row.attempt_id,
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: orUndefined(row.reasoning_tokens),
      cachedInputTokens: orUndefined(row.cached_input_tokens),
    },
    usd: row.usd,
    at: row.at,
  });
}

function retestParams(retest: StoredRetest): Params {
  return {
    run_id: retest.runId,
    target: retest.target,
    status: retest.status,
    error: retest.error ?? null,
    started_at: retest.startedAt,
    ended_at: retest.endedAt ?? null,
  };
}

function retestFromRow(row: Row): StoredRetest {
  return StoredRetestSchema.parse({
    runId: row.run_id,
    target: row.target,
    status: row.status,
    error: orUndefined(row.error),
    startedAt: row.started_at,
    endedAt: orUndefined(row.ended_at),
  });
}

function graduateParams(record: GraduateRecord): Params {
  return {
    id: record.id,
    run_id: record.runId,
    name: record.name,
    path: record.path,
    manifest: json(record.manifest),
    settings: jsonOrNull(record.settings),
    created_at: record.createdAt,
  };
}

function graduateFromRow(row: Row): GraduateRecord {
  return GraduateRecordSchema.parse({
    id: row.id,
    runId: row.run_id,
    name: row.name,
    path: row.path,
    manifest: fromJson(row.manifest),
    settings: fromJson(row.settings),
    createdAt: row.created_at,
  });
}

function chatParams(chat: WorkspaceChat): Params {
  return {
    id: chat.id,
    graduate_id: chat.graduateId,
    title: chat.title,
    running: flag(chat.running),
    waiting: flag(chat.waiting),
    created_at: chat.createdAt,
    updated_at: chat.updatedAt,
  };
}

function chatFromRow(row: Row): WorkspaceChat {
  return WorkspaceChatSchema.parse({
    id: row.id,
    graduateId: row.graduate_id,
    title: row.title,
    running: row.running === 1,
    waiting: row.waiting === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function messageParams(message: WorkspaceMessage): Params {
  return {
    id: message.id,
    chat_id: message.chatId,
    role: message.role,
    status: message.status,
    body: json(message),
    created_at: message.createdAt,
  };
}

function attemptQuery(filter: AttemptFilter): { where: string; params: Params } {
  const clauses = ['run_id = :run_id'];
  const params: Params = { run_id: filter.runId };
  if (filter.split !== undefined) {
    clauses.push('split = :split');
    params.split = filter.split;
  }
  if (filter.version !== undefined) {
    clauses.push('harness_version = :version');
    params.version = filter.version;
  }
  if (filter.round === null) clauses.push('round IS NULL');
  else if (filter.round !== undefined) {
    clauses.push('round = :round');
    params.round = filter.round;
  }
  if (filter.target !== undefined) {
    clauses.push('target = :target');
    params.target = filter.target;
  }
  return { where: clauses.join(' AND '), params };
}

export function createEngineStore(db: DatabaseSync): EngineStore {
  const sql = new Statements(db);

  return {
    transaction: (fn) => inTransaction(db, fn),
    close: () => db.close(),

    jobs: {
      insert: (job) => sql.insert('jobs', jobParams(job)),
      update: (job) => sql.update('jobs', jobParams(job), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM jobs WHERE id = :id', { id });
        return row ? jobFromRow(row) : null;
      },
      list: () =>
        sql.all('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC').map(jobFromRow),
    },

    runs: {
      insert: (record) => sql.insert('runs', runParams(record)),
      update: (record) => sql.update('runs', runParams(record), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM runs WHERE id = :id', { id });
        return row ? runFromRow(row) : null;
      },
      list: (jobId) =>
        (jobId === undefined
          ? sql.all('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC')
          : sql.all(
              'SELECT * FROM runs WHERE job_id = :job_id ORDER BY created_at DESC, rowid DESC',
              { job_id: jobId },
            )
        ).map(runFromRow),
      withStatus: (statuses) => {
        if (statuses.length === 0) return [];
        const { placeholders, params } = inList('status', statuses);
        return sql
          .all(
            `SELECT * FROM runs WHERE status IN (${placeholders}) ORDER BY created_at, rowid`,
            params,
          )
          .map(runFromRow);
      },
    },

    rounds: {
      insert: (record) => sql.insert('rounds', roundParams(record)),
      update: (record) => sql.update('rounds', roundParams(record), ['run_id', 'idx']),
      get: (runId, index) => {
        const row = sql.one('SELECT * FROM rounds WHERE run_id = :run_id AND idx = :idx', {
          run_id: runId,
          idx: index,
        });
        return row ? roundFromRow(row) : null;
      },
      list: (runId) =>
        sql
          .all('SELECT * FROM rounds WHERE run_id = :run_id ORDER BY idx', { run_id: runId })
          .map(roundFromRow),
    },

    attempts: {
      insert: (attempt) => sql.insert('attempts', attemptParams(attempt)),
      get: (id) => {
        const row = sql.one('SELECT * FROM attempts WHERE id = :id', { id });
        return row ? attemptFromRow(row) : null;
      },
      list: (filter) => {
        const { where, params } = attemptQuery(filter);
        return sql
          .all(`SELECT * FROM attempts WHERE ${where} ORDER BY created_at, rowid`, params)
          .map(attemptFromRow);
      },
      recent: (runId, splits, limit) => {
        if (splits.length === 0) return [];
        const { placeholders, params } = inList('split', splits);
        return sql
          .all(
            `SELECT * FROM attempts WHERE run_id = :run_id AND split IN (${placeholders})
             ORDER BY created_at DESC, rowid DESC LIMIT :limit`,
            { ...params, run_id: runId, limit },
          )
          .map(attemptFromRow);
      },
    },

    lineage: {
      insert: (row) =>
        sql.insert('lineage', {
          id: row.id,
          run_id: row.runId,
          round: row.round,
          title: row.title,
          decision: row.decision,
          delta: row.delta,
          version_from: row.versionFrom,
          version_to: row.versionTo,
          at: row.at,
        }),
      list: (runId) =>
        sql
          .all('SELECT * FROM lineage WHERE run_id = :run_id ORDER BY round', { run_id: runId })
          .map(lineageFromRow),
    },

    costs: {
      insert: (entry) =>
        sql.insert('costs', {
          run_id: entry.runId,
          role: entry.role,
          model: entry.model,
          round: entry.round,
          attempt_id: entry.attemptId,
          input_tokens: entry.usage.inputTokens,
          output_tokens: entry.usage.outputTokens,
          reasoning_tokens: entry.usage.reasoningTokens ?? null,
          cached_input_tokens: entry.usage.cachedInputTokens ?? null,
          usd: entry.usd,
          at: entry.at,
        }),
      list: (runId) =>
        sql
          .all('SELECT * FROM costs WHERE run_id = :run_id ORDER BY id', { run_id: runId })
          .map(costFromRow),
    },

    reports: {
      put: (card) =>
        sql.insert(
          'reports',
          {
            run_id: card.runId,
            target: card.testedOn,
            card: json(card),
            created_at: card.createdAt,
          },
          'replace',
        ),
      get: (runId, target) => {
        const row = sql.one(
          'SELECT card FROM reports WHERE run_id = :run_id AND target = :target',
          { run_id: runId, target },
        );
        return row ? ReportCardSchema.parse(fromJson(row.card)) : null;
      },
      targets: (runId) =>
        sql
          .all('SELECT target FROM reports WHERE run_id = :run_id ORDER BY created_at, rowid', {
            run_id: runId,
          })
          .map((row) => StudentTargetSchema.parse(row.target)),
    },

    retests: {
      insert: (retest) => sql.insert('retests', retestParams(retest)),
      update: (retest) => sql.update('retests', retestParams(retest), ['run_id', 'target']),
      get: (runId, target) => {
        const row = sql.one('SELECT * FROM retests WHERE run_id = :run_id AND target = :target', {
          run_id: runId,
          target,
        });
        return row ? retestFromRow(row) : null;
      },
      withStatus: (status) =>
        sql
          .all('SELECT * FROM retests WHERE status = :status ORDER BY started_at, rowid', {
            status,
          })
          .map(retestFromRow),
    },

    graduates: {
      insert: (record) => sql.insert('graduates', graduateParams(record)),
      update: (record) => sql.update('graduates', graduateParams(record), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM graduates WHERE id = :id', { id });
        return row ? graduateFromRow(row) : null;
      },
      forRun: (runId) => {
        const row = sql.one('SELECT * FROM graduates WHERE run_id = :run_id', { run_id: runId });
        return row ? graduateFromRow(row) : null;
      },
      list: () =>
        sql
          .all('SELECT * FROM graduates ORDER BY created_at DESC, rowid DESC')
          .map(graduateFromRow),
      remove: (id) => {
        sql.run('DELETE FROM graduates WHERE id = :id', { id });
      },
    },

    chats: {
      insert: (chat) => sql.insert('chats', chatParams(chat)),
      update: (chat) => sql.update('chats', chatParams(chat), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM chats WHERE id = :id', { id });
        return row ? chatFromRow(row) : null;
      },
      list: (graduateId) =>
        sql
          .all(
            'SELECT * FROM chats WHERE graduate_id = :graduate_id ORDER BY updated_at DESC, rowid DESC',
            { graduate_id: graduateId },
          )
          .map(chatFromRow),
    },

    messages: {
      insert: (message) => sql.insert('messages', messageParams(message)),
      update: (message) => sql.update('messages', messageParams(message), ['id']),
      list: (chatId) =>
        sql
          .all('SELECT body FROM messages WHERE chat_id = :chat_id ORDER BY created_at, rowid', {
            chat_id: chatId,
          })
          .map((row) => WorkspaceMessageSchema.parse(fromJson(row.body))),
    },
  };
}
