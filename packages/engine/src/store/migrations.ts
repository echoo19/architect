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
        settings TEXT,
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
  {
    version: 2,
    name: 'rejected rounds',
    sql: 'ALTER TABLE rounds ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0;',
  },
  {
    version: 3,
    name: 'dev repeats',
    sql: `
      -- A dev evaluation attempts every task under each of its seeds, once per seed.
      DROP INDEX attempts_once;
      CREATE UNIQUE INDEX attempts_once
        ON attempts (run_id, split, harness_version, target, task_id, coalesce(round, 0), seed);
    `,
  },
  {
    version: 4,
    name: 'report per target',
    sql: `
      -- A run keeps one report card per student endpoint its graduate was tested on. Every card
      -- so far came from the run's own locked test, so it is filed, and labelled, under that.
      CREATE TABLE reports_by_target (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        card TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, target)
      );
      INSERT INTO reports_by_target (run_id, target, card, created_at)
        SELECT reports.run_id, runs.locked_test_on,
               json_set(reports.card, '$.testedOn', runs.locked_test_on), reports.created_at
        FROM reports JOIN runs ON runs.id = reports.run_id;
      DROP TABLE reports;
      ALTER TABLE reports_by_target RENAME TO reports;
    `,
  },
  {
    version: 5,
    name: 'retests',
    sql: `
      -- A finished run's locked test taken again on its other student endpoint, once per target.
      CREATE TABLE retests (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        PRIMARY KEY (run_id, target)
      );
    `,
  },
  {
    version: 6,
    name: 'first measurement',
    sql: `
      -- A round whose change cleared the keep limits is measured again; this keeps the first
      -- measurement, while dev_before and dev_after add up both.
      ALTER TABLE rounds ADD COLUMN first_measurement TEXT;
    `,
  },
  {
    version: 7,
    name: 'draft rounds',
    sql: `
      -- A round whose author wrote a whole harness: a blank start's first round, or one-shot's.
      ALTER TABLE rounds ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
    `,
  },
];
