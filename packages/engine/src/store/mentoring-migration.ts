import type { Migration } from './database';

/**
 * Everything failure-specific mentoring adds to the database, in one migration so it is renumbered
 * in one place if another branch takes its number first. Runs, rounds and attempts made before it
 * read as they did: the job's student with no adapter, in a run nobody was asked to answer.
 */
export const MENTORING_MIGRATION: Migration = {
  version: 14,
  name: 'lessons, interventions, experiments and corrections',
  sql: `
    -- Who made an attempt and how, beside its harness version: the student or Spark as a
    -- reference, the backend, and any adapter at its scale. Older attempts were all 'student'.
    ALTER TABLE attempts ADD COLUMN config TEXT NOT NULL DEFAULT 'student';
    DROP INDEX attempts_once;
    CREATE UNIQUE INDEX attempts_once
      ON attempts (run_id, split, harness_version, target, config, task_id, coalesce(round, 0), seed);

    ALTER TABLE runs ADD COLUMN interactive INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE runs ADD COLUMN current_adapter TEXT;
    ALTER TABLE rounds ADD COLUMN candidate_adapter TEXT;

    -- A job's failure vocabulary. An id never changes; a slug names one category per job.
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      task_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (job_id, slug)
    );

    -- One intervention per round, accepted or refused, with its findings and teaching plan.
    CREATE TABLE interventions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, round)
    );

    -- Corrections the runner tried to verify, verified or rejected. Workspace corrections have no run.
    CREATE TABLE lessons (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE CASCADE,
      round INTEGER,
      category_id TEXT,
      task_type TEXT NOT NULL,
      task_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX lessons_by_run ON lessons (run_id, round);
    CREATE INDEX lessons_by_job ON lessons (job_id, status);

    -- The record every round ends in, whatever happened to it.
    CREATE TABLE experiments (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      kind TEXT NOT NULL,
      disposition TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, round)
    );

    -- Spark run as the agent for comparison, one per run and split.
    CREATE TABLE reference_runs (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      split TEXT NOT NULL,
      status TEXT NOT NULL,
      body TEXT NOT NULL,
      started_at TEXT NOT NULL,
      PRIMARY KEY (run_id, split)
    );

    -- A run that improves an agent from its queued lessons: the agent, its starting version and
    -- the lessons it took. Null for every other run.
    ALTER TABLE runs ADD COLUMN improves TEXT;

    -- Teach this: one person's correction of one reply, its proposed lesson and where it went.
    CREATE TABLE corrections (
      id TEXT PRIMARY KEY,
      graduate_id TEXT NOT NULL REFERENCES graduates(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      run_id TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX corrections_by_graduate ON corrections (graduate_id, created_at);
  `,
};
