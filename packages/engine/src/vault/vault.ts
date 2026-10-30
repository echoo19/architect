import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GuardError, TaskSchema, type Organization, type Task } from '@architect/shared';
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
/** Where the organizations a job never trains on keep their files, inside the job's vault. */
const TRANSFER_DIR = 'transfer';

/**
 * An organization the job never trains on, with its files, sealed beside the test split
 * (decision 068). Its tasks are among the test tasks sealed with it.
 */
export interface TransferOrganization {
  org: Organization;
  files: readonly { name: string; content: string | Uint8Array }[];
}

/** The sealed organizations, opened for the locked test: each one's folder, by its id. */
export interface OpenedTransfer {
  organizations: Organization[];
  dataDirs: Record<string, string>;
}

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
   * records every attempt reads) are left out of the fingerprint. `transfer` are organizations
   * the job never trains on: their files are kept here, hashed, and each one's name and id count
   * as test content in the fingerprint of its tasks.
   */
  seal(
    jobId: string,
    testTasks: readonly Task[],
    otherTasks: readonly Task[],
    data: readonly string[],
    transfer: readonly TransferOrganization[] = [],
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
    const sealedOrgs = new Map(transfer.map(({ org }) => [org.id, org]));
    const fingerprint = fingerprintTests(
      jobId,
      tests,
      otherTasks,
      data,
      sha256(content),
      (task) => {
        const org = task.org === undefined ? undefined : sealedOrgs.get(task.org);
        return org === undefined ? [] : [org.id, org.name];
      },
    );
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(join(dir, TEST_FILE), content);
    const kept = transfer.map(({ org, files }) => {
      const folder = this.transferDir(jobId, org.id);
      return {
        org,
        files: files.map((file) => {
          const target = join(folder, file.name);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, file.content);
          return { name: file.name, sha256: sha256(file.content) };
        }),
      };
    });
    const sealed = kept.length === 0 ? fingerprint : { ...fingerprint, transfer: kept };
    writeFileAtomic(join(dir, FINGERPRINT_FILE), `${JSON.stringify(sealed)}\n`);
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

  /**
   * The id and name of each organization sealed away from the mentor, so a request bound for a
   * teacher can be held to not naming one. Nothing else of the organizations leaves.
   */
  transferIdentifiers(jobId: string): { id: string; name: string }[] {
    if (!this.isSealed(jobId)) return [];
    return (this.fingerprint(jobId).transfer ?? []).map(({ org }) => ({
      id: org.id,
      name: org.name,
    }));
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

  /**
   * The organizations the job never trains on, with the folder of each one's files, for the one
   * run that happens after the mentor is released. A file that changed since it was sealed is
   * refused like a changed test split.
   */
  openTransfer(jobId: string, proof: MentorReleased): OpenedTransfer {
    if (!isMentorReleased(proof)) {
      throw new GuardError(
        'split',
        'The sealed organizations open only after the mentor has been released.',
      );
    }
    const transfer = this.fingerprint(jobId).transfer ?? [];
    const dataDirs: Record<string, string> = {};
    for (const { org, files } of transfer) {
      const folder = this.transferDir(jobId, org.id);
      for (const file of files) {
        if (sha256(readFileSync(join(folder, file.name))) !== file.sha256) {
          throw new GuardError(
            'split',
            `A sealed organization's file of job ${jobId} changed after it was sealed.`,
          );
        }
      }
      dataDirs[org.id] = folder;
    }
    return { organizations: transfer.map(({ org }) => org), dataDirs };
  }

  private transferDir(jobId: string, orgId: string): string {
    return join(this.dir(jobId), TRANSFER_DIR, orgId, 'data');
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

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
