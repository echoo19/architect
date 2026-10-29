import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GuardError, TaskSchema, type Task } from '@architect/shared';
import { writeFileAtomic } from '../data/atomic-write';
import {
  createLeakDetector,
  fingerprintTests,
  FingerprintSchema,
  type Fingerprint,
  type LeakDetector,
} from './fingerprint';
import { isMentorReleased, type MentorReleased } from './gate';

const TEST_FILE = 'test.jsonl';
/** Written last, so its presence is what makes a job's vault sealed. */
const FINGERPRINT_FILE = 'fingerprint.json';
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Holds each job's locked test split under `<root>/vault/<jobId>/`. This is the only code that
 * reads or writes it: the rest of the engine gets a count, a leak detector that never returns
 * test content, and the tasks themselves only for the locked test, after the mentor is released.
 */
export class Vault {
  constructor(private readonly rootDir: string) {}

  /**
   * Seals a job's test tasks. `otherTasks` are every task outside the test split and `data` the
   * text of the job's data files: wording and values they share with test tasks (templates,
   * records every attempt reads) are left out of the fingerprint.
   */
  seal(
    jobId: string,
    testTasks: readonly Task[],
    otherTasks: readonly Task[],
    data: readonly string[],
  ): void {
    const dir = this.dir(jobId);
    if (this.isSealed(jobId)) {
      throw new GuardError(
        'split',
        `The test split of job ${jobId} is already sealed; reset it before sealing a new one.`,
      );
    }
    if (testTasks.length === 0) throw new Error('There are no test tasks to seal.');
    const tests = testTasks.map((task) => TaskSchema.parse(task));
    const ids = new Set(tests.map((task) => task.id));
    if (ids.size !== tests.length) throw new Error('Two test tasks share an id.');
    const shared = otherTasks.find((task) => ids.has(task.id));
    if (shared) {
      throw new GuardError('split', `Task ${shared.id} is in the test split and in another split.`);
    }

    const content = `${tests.map((task) => JSON.stringify(task)).join('\n')}\n`;
    const fingerprint = fingerprintTests(jobId, tests, otherTasks, data, sha256(content));
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(join(dir, TEST_FILE), content);
    writeFileAtomic(join(dir, FINGERPRINT_FILE), `${JSON.stringify(fingerprint)}\n`);
  }

  isSealed(jobId: string): boolean {
    return existsSync(join(this.dir(jobId), FINGERPRINT_FILE));
  }

  /** How many tasks are sealed; 0 when nothing is. */
  count(jobId: string): number {
    return this.isSealed(jobId) ? this.fingerprint(jobId).tasks.length : 0;
  }

  /**
   * How many sealed tasks there are of each type. Only the counts leave: the tasks stay in the
   * vault, and a file that changed since it was sealed is refused like it is for the locked test.
   */
  typeCounts(jobId: string): Record<string, number> {
    if (!this.isSealed(jobId)) return {};
    const fingerprint = this.fingerprint(jobId);
    const content = readFileSync(join(this.dir(jobId), TEST_FILE), 'utf8');
    if (sha256(content) !== fingerprint.testFileSha256) {
      throw new GuardError('split', `The locked test of job ${jobId} changed after it was sealed.`);
    }
    const counts: Record<string, number> = {};
    for (const line of content.split('\n')) {
      if (line === '') continue;
      const { type } = TaskSchema.parse(JSON.parse(line));
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  }

  /** Removes a job's sealed split so a new one can be sealed. */
  reset(jobId: string): void {
    rmSync(this.dir(jobId), { recursive: true, force: true });
  }

  /** Checks text bound for the mentor against the sealed test tasks' fingerprints. */
  leakDetector(jobId: string): LeakDetector {
    return createLeakDetector(this.fingerprint(jobId));
  }

  /** The locked test tasks, for the one run that happens after the mentor is released. */
  openForLockedTest(jobId: string, proof: MentorReleased): Task[] {
    if (!isMentorReleased(proof)) {
      throw new GuardError(
        'split',
        'The locked test opens only after the mentor has been released.',
      );
    }
    const fingerprint = this.fingerprint(jobId);
    const content = readFileSync(join(this.dir(jobId), TEST_FILE), 'utf8');
    if (sha256(content) !== fingerprint.testFileSha256) {
      throw new GuardError('split', `The locked test of job ${jobId} changed after it was sealed.`);
    }
    return content
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => TaskSchema.parse(JSON.parse(line)));
  }

  private dir(jobId: string): string {
    if (!JOB_ID.test(jobId)) throw new Error(`"${jobId}" is not a valid job id.`);
    return join(this.rootDir, 'vault', jobId);
  }

  private fingerprint(jobId: string): Fingerprint {
    if (!this.isSealed(jobId)) {
      throw new GuardError('split', `The test split of job ${jobId} has not been sealed.`);
    }
    const raw = readFileSync(join(this.dir(jobId), FINGERPRINT_FILE), 'utf8');
    return FingerprintSchema.parse(JSON.parse(raw));
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
