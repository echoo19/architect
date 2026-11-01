import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TrainingJobRecordSchema, type TrainingJobRecord } from '@architect/shared';
import { writeFileAtomic } from '../data/atomic-write';
import { inTransaction } from '../store/database';

/**
 * Where training job records are kept. Files under the data folder for now; the interface is
 * what the worker needs, so the records can move into the database without touching it.
 */
export interface TrainingStore {
  list(): TrainingJobRecord[];
  get(id: string): TrainingJobRecord | null;
  /** Writes the whole record, so a crash leaves the old one or the new, never half. */
  put(record: TrainingJobRecord): void;
  /** The job's own folder: its inputs, artifacts and logs. */
  jobDir(id: string): string;
  /**
   * Runs `work` holding a lock that every process using these records takes first, so two can't
   * reserve the same compute or make the same job twice.
   */
  exclusive<T>(work: () => T): T;
}

const RECORD_FILE = 'record.json';
const LOCK_FILE = 'jobs.lock.db';
/** How long a process waits for another to finish reserving before it gives up. */
const LOCK_WAIT_MS = 30_000;

/** `<dataDir>/training/jobs/<id>/record.json`, one folder per job. */
export class FileTrainingStore implements TrainingStore {
  private readonly jobsDir: string;

  constructor(dataDir: string) {
    this.jobsDir = join(dataDir, 'training', 'jobs');
  }

  jobDir(id: string): string {
    if (!/^trn_[a-z0-9]+$/.test(id)) throw new Error(`"${id}" is not a training job id.`);
    return join(this.jobsDir, id);
  }

  list(): TrainingJobRecord[] {
    let names: string[];
    try {
      names = readdirSync(this.jobsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return names
      .filter((name) => /^trn_[a-z0-9]+$/.test(name))
      .flatMap((name) => {
        const record = this.get(name);
        return record ? [record] : [];
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  get(id: string): TrainingJobRecord | null {
    let text: string;
    try {
      text = readFileSync(join(this.jobDir(id), RECORD_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return TrainingJobRecordSchema.parse(JSON.parse(text));
  }

  /**
   * The lock is a write transaction on a small SQLite file beside the records, as the engine and
   * agent hosts share their database: SQLite holds it across processes and lets go of it when
   * its holder exits, so a crash never leaves it held.
   */
  exclusive<T>(work: () => T): T {
    mkdirSync(this.jobsDir, { recursive: true });
    const db = new DatabaseSync(join(this.jobsDir, LOCK_FILE), { timeout: LOCK_WAIT_MS });
    try {
      return inTransaction(db, work);
    } finally {
      db.close();
    }
  }

  put(record: TrainingJobRecord): void {
    const parsed = TrainingJobRecordSchema.parse(record);
    const dir = this.jobDir(parsed.id);
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(join(dir, RECORD_FILE), `${JSON.stringify(parsed, null, 2)}\n`);
  }
}
