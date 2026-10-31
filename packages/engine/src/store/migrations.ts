import type { Migration } from './database';
import { MENTORING_MIGRATION } from './mentoring-migration';

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
  {
    version: 8,
    name: 'earlier one-shot drafts',
    sql: `
      -- One-shot's only round was always a whole draft, including those made before migration 7.
      UPDATE rounds SET draft = 1
        WHERE idx = 1 AND run_id IN (SELECT id FROM runs WHERE method = 'one_shot');
    `,
  },
  {
    version: 9,
    name: 'graduate versions',
    sql: `
      -- A graduate is an agent with immutable versions (decision 039). Its graduates row is the
      -- agent; each version is a package folder under graduates/<id>/versions/. Rows made before
      -- this keep their format 1 manifest until the engine converts their folder to version 1.
      CREATE TABLE graduate_versions (
        graduate_id TEXT NOT NULL REFERENCES graduates(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        parent INTEGER,
        origin TEXT,
        path TEXT NOT NULL,
        manifest TEXT NOT NULL,
        digest TEXT NOT NULL,
        contract_version INTEGER NOT NULL,
        state TEXT NOT NULL,
        evaluation TEXT NOT NULL,
        run_id TEXT,
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        PRIMARY KEY (graduate_id, version)
      );
      CREATE INDEX graduate_versions_by_run ON graduate_versions (run_id);

      -- Acceptances, rejections, promotions and rollbacks, in the order they happened.
      CREATE TABLE graduate_events (
        id INTEGER PRIMARY KEY,
        graduate_id TEXT NOT NULL REFERENCES graduates(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        version INTEGER NOT NULL,
        from_version INTEGER,
        at TEXT NOT NULL
      );
      CREATE INDEX graduate_events_by_graduate ON graduate_events (graduate_id, id);

      -- The version chats run on; NULL while the agent has none that can.
      ALTER TABLE graduates ADD COLUMN active_version INTEGER;
    `,
  },
  {
    version: 10,
    name: 'installations',
    sql: `
      -- What this computer gave a graduate: folders for its logical resources, the permissions
      -- the user granted, and the local runtime that serves its model. Never exported.
      CREATE TABLE installations (
        graduate_id TEXT PRIMARY KEY REFERENCES graduates(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        bindings TEXT NOT NULL,
        grants TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- The last installation checks of each version here: compatibility and smoke results.
      CREATE TABLE installation_checks (
        graduate_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        reasons TEXT NOT NULL,
        checks TEXT NOT NULL,
        machine TEXT,
        measurements TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (graduate_id, version),
        FOREIGN KEY (graduate_id, version)
          REFERENCES graduate_versions (graduate_id, version) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 11,
    name: 'publications',
    sql: `
      -- A version published to a hub: the repository, its visibility and, once the upload
      -- finished, the immutable revision. Publishing itself comes later; this keeps its record.
      CREATE TABLE publications (
        id TEXT PRIMARY KEY,
        graduate_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        destination TEXT NOT NULL,
        repository TEXT NOT NULL,
        visibility TEXT NOT NULL,
        revision TEXT,
        url TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (graduate_id, version)
          REFERENCES graduate_versions (graduate_id, version) ON DELETE CASCADE
      );
      CREATE INDEX publications_by_version ON publications (graduate_id, version);
    `,
  },
  {
    version: 12,
    name: 'job contracts',
    sql: `
      -- Every version of each job's contract. A change to its scope or success criteria adds a
      -- version; job.json stays the editable job, and a graduate carries the version it met.
      CREATE TABLE job_contracts (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        contract TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (job_id, version)
      );
    `,
  },
  {
    version: 13,
    name: 'versions in chats',
    sql: `
      -- The version a chat started on, and the version that wrote each reply.
      ALTER TABLE chats ADD COLUMN graduate_version INTEGER;
      ALTER TABLE messages ADD COLUMN graduate_version INTEGER;
      -- Until now every graduate had one version, and it becomes version 1.
      UPDATE chats SET graduate_version = 1;
      UPDATE messages SET graduate_version = 1 WHERE role = 'agent';
    `,
  },
  MENTORING_MIGRATION,
  {
    version: 15,
    name: 'hub sources and publications',
    sql: `
      -- The hub repository and commit a version was installed from, when it came from one.
      ALTER TABLE graduate_versions ADD COLUMN source TEXT;
      -- The digest of the package a publication sent, and one record per version and repository,
      -- so trying a publication again updates its record instead of adding another.
      ALTER TABLE publications ADD COLUMN digest TEXT;
      CREATE UNIQUE INDEX publications_once
        ON publications (graduate_id, version, destination, repository);
    `,
  },
  {
    version: 16,
    name: 'comparison protocols, repeats and runtime measurements',
    sql: `
      -- What a comparison holds a run to beyond its job: its arm, a locked test held until
      -- released, deferred repeats, a fixed menu, an adopted harness, a one-shot adapter.
      ALTER TABLE runs ADD COLUMN protocol TEXT;

      -- A frozen graduate's locked test under the declared seeds it deferred, per target.
      CREATE TABLE repeats (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        PRIMARY KEY (run_id, target)
      );

      -- What the runtime serving a model held at most during a stretch of an evaluation, and
      -- how long a cold first reply took.
      CREATE TABLE runtime_measurements (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        split TEXT NOT NULL,
        target TEXT NOT NULL,
        config TEXT NOT NULL,
        harness_version INTEGER NOT NULL,
        seeds TEXT NOT NULL,
        backend TEXT NOT NULL,
        peak_process_bytes INTEGER,
        peak_gpu_bytes INTEGER,
        cold_start_ms INTEGER,
        samples INTEGER NOT NULL,
        sampler TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL
      );
      CREATE INDEX runtime_measurements_by_run ON runtime_measurements (run_id, started_at);
    `,
  },
  {
    version: 17,
    name: 'answer keys for certified answers',
    sql: `
      -- A hash of a sealed attempt's answer and file changes, salted by its run, so attempts at
      -- one task can be compared for agreement without keeping what they answered.
      ALTER TABLE attempts ADD COLUMN answer_key TEXT;
    `,
  },
  {
    version: 18,
    name: 'counterexamples',
    sql: `
      -- A failing helper call reduced to a small case, kept as the field's regression suite.
      CREATE TABLE counterexamples (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX counterexamples_by_job ON counterexamples (job_id, created_at);
      CREATE INDEX counterexamples_by_run ON counterexamples (run_id, round);
    `,
  },
  {
    version: 19,
    name: 'certifications',
    sql: `
      -- A frozen version certified after the fact, on tasks its run never saw (decision 079).
      CREATE TABLE certifications (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        graduate_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX certifications_once ON certifications (run_id, seq);
      CREATE INDEX certifications_by_version ON certifications (graduate_id, version, created_at);
    `,
  },
  {
    version: 20,
    name: 'qualifications',
    sql: `
      -- A model trained elsewhere, served on this computer, taking a finished run's locked test
      -- under the run's frozen harness (decision 086).
      CREATE TABLE qualifications (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX qualifications_by_job ON qualifications (job_id, created_at);
    `,
  },
  {
    version: 21,
    name: 'added_qualifications',
    sql: `
      -- A frozen version's test on an organization sealed after its job was made (decision 085).
      CREATE TABLE added_qualifications (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        org_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL,
        body TEXT NOT NULL,
        started_at TEXT NOT NULL,
        PRIMARY KEY (run_id, org_id)
      );
      CREATE UNIQUE INDEX added_qualifications_once ON added_qualifications (run_id, seq);
      -- The current check score at each organization a field is taught on.
      ALTER TABLE runs ADD COLUMN dev_by_org TEXT;
    `,
  },
  {
    version: 22,
    name: 'job_versions',
    sql: `
      -- A later version of a job, made by teaching on one of its never-seen organizations
      -- (decision 089): the job it came from, its number and the organization moved.
      ALTER TABLE jobs ADD COLUMN version_of TEXT;
    `,
  },
  {
    version: 23,
    name: 'run_hosts',
    sql: `
      -- Every host a run's adapters contacted, with how many requests went there and whether a
      -- closed network admitted all of them (decision 098). Never a path, a body or a key.
      CREATE TABLE run_hosts (
        run_id TEXT NOT NULL,
        host TEXT NOT NULL,
        requests INTEGER NOT NULL,
        inside INTEGER NOT NULL,
        first_at TEXT NOT NULL,
        PRIMARY KEY (run_id, host)
      );
    `,
  },
];
