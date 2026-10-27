import type { Migration } from './database';

/**
 * Schema history. Never edit an applied migration; add a new one. Traces are JSON files under
 * the run folder and lineage lives in each run's `lineage.jsonl`; these tables index them.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'core loop',
    sql: `
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        summary TEXT,
        path TEXT NOT NULL,
        task_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        method TEXT NOT NULL,
        seed INTEGER NOT NULL,
        seeds TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        today TEXT NOT NULL,
        locked_test_on TEXT NOT NULL,
        stop_requested INTEGER NOT NULL,
        current_version INTEGER NOT NULL,
        dev_baseline TEXT,
        dev_current TEXT,
        totals TEXT NOT NULL,
        stop_reason TEXT,
        error TEXT,
        freeze TEXT,
        graduate_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX runs_by_job ON runs (job_id, created_at);
      CREATE INDEX runs_by_status ON runs (status);

      CREATE TABLE rounds (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        status TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        train TEXT NOT NULL,
        reply TEXT,
        hypothesis TEXT,
        title TEXT,
        diagnosis TEXT,
        predicted TEXT,
        files TEXT NOT NULL,
        candidate_version INTEGER,
        dev_before TEXT,
        dev_after TEXT,
        decision TEXT,
        decision_reason TEXT,
        cost_usd REAL NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        PRIMARY KEY (run_id, idx)
      );

      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        round INTEGER,
        split TEXT NOT NULL,
        harness_version INTEGER NOT NULL,
        task_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        target TEXT NOT NULL,
        seed INTEGER NOT NULL,
        pass INTEGER NOT NULL,
        reason TEXT NOT NULL,
        details TEXT,
        stop_reason TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER,
        cached_input_tokens INTEGER,
        answer_summary TEXT,
        expected_summary TEXT,
        trace_path TEXT,
        created_at TEXT NOT NULL
      );
      -- One attempt per task per evaluation; rounds are NULL outside a round, hence coalesce.
      CREATE UNIQUE INDEX attempts_once
        ON attempts (run_id, split, harness_version, target, task_id, coalesce(round, 0));
      CREATE INDEX attempts_by_run ON attempts (run_id, created_at);

      CREATE TABLE lineage (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        title TEXT NOT NULL,
        decision TEXT NOT NULL,
        delta INTEGER NOT NULL,
        version_from INTEGER NOT NULL,
        version_to INTEGER NOT NULL,
        at TEXT NOT NULL,
        UNIQUE (run_id, round)
      );

      CREATE TABLE costs (
        id INTEGER PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        model TEXT NOT NULL,
        round INTEGER,
        attempt_id TEXT,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        reasoning_tokens INTEGER,
        cached_input_tokens INTEGER,
        usd REAL,
        at TEXT NOT NULL
      );
      CREATE INDEX costs_by_run ON costs (run_id);

      CREATE TABLE reports (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        card TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE graduates (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        manifest TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX graduates_by_run ON graduates (run_id);

      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        graduate_id TEXT NOT NULL REFERENCES graduates(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        running INTEGER NOT NULL,
        waiting INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX chats_by_graduate ON chats (graduate_id, updated_at);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX messages_by_chat ON messages (chat_id, created_at);
    `,
  },
];
