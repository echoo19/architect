import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  GuardError,
  TaskSchema,
  type Organization,
  type SealedHashes,
  type Task,
} from '@architect/shared';
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
/** The sealed calibration split of a certified job (decision 077). */
const CERTIFY_FILE = 'certify.jsonl';
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
   * as test content in the fingerprint of its tasks. `certify` is a certified job's calibration
   * split (decision 077), sealed beside the test and held to the same leak detector.
   */
  seal(
    jobId: string,
    testTasks: readonly Task[],
    otherTasks: readonly Task[],
    data: readonly string[],
    transfer: readonly TransferOrganization[] = [],
    certify: readonly Task[] = [],
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
    const calibration = certify.map((task) => TaskSchema.parse(task));
    const calibrationIds = new Set(calibration.map((task) => task.id));
    const crossed = [...tests, ...otherTasks].find((task) => calibrationIds.has(task.id));
    if (crossed || calibrationIds.size !== calibration.length) {
      throw new GuardError(
        'split',
        `Task ${crossed?.id ?? 'of the calibration split'} is in the calibration split and in another split.`,
      );
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
    let certified: Fingerprint['certify'];
    if (calibration.length > 0) {
      const lines = `${calibration.map((task) => JSON.stringify(task)).join('\n')}\n`;
      // Its prints leave out only what the splits the mentor sees hold, as the test's do.
      const prints = fingerprintTests(jobId, calibration, otherTasks, data, sha256(lines));
      writeFileAtomic(join(dir, CERTIFY_FILE), lines);
      certified = { fileSha256: sha256(lines), tasks: prints.tasks };
    }
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
    const sealed = {
      ...fingerprint,
      ...(kept.length === 0 ? {} : { transfer: kept }),
      ...(certified === undefined ? {} : { certify: certified }),
    };
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

  /** How many calibration tasks are sealed for a certificate; 0 for a job without them. */
  calibrationCount(jobId: string): number {
    return this.isSealed(jobId) ? (this.fingerprint(jobId).certify?.tasks.length ?? 0) : 0;
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

  /**
   * Each sealed organization by name and kind, with how many files it holds, for the person's
   * own view of their field. No id, file name or task leaves, and nothing here may reach a
   * mentor: the leak gate holds every request to not naming one.
   */
  sealedOrganizations(jobId: string): { name: string; synthetic: boolean; files: number }[] {
    if (!this.isSealed(jobId)) return [];
    return (this.fingerprint(jobId).transfer ?? []).map(({ org, files }) => ({
      name: org.name,
      synthetic: org.synthetic,
      files: files.length,
    }));
  }

  /**
   * The sealed part of a job by hash only, for a field export's evaluation manifest: the locked
   * test file with its task count, and each sealed organization hashed over its files' names and
   * hashes, in no telling order. No id, name, file name or task leaves.
   */
  sealedHashes(jobId: string): SealedHashes {
    const fingerprint = this.fingerprint(jobId);
    const organizations = (fingerprint.transfer ?? [])
      .map(({ files }) => ({
        sha256: sha256(
          [...files]
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .map((file) => `${file.name}\t${file.sha256}\n`)
            .join(''),
        ),
        files: files.length,
      }))
      .sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1));
    return {
      lockedTest: { sha256: fingerprint.testFileSha256, tasks: fingerprint.tasks.length },
      organizations,
    };
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
   * The calibration tasks of a certified job, for the run that certifies the frozen graduate
   * after the mentor is released (decision 077). None for a job without them. A file that changed
   * since it was sealed is refused like a changed test split.
   */
  openCalibration(jobId: string, proof: MentorReleased): Task[] {
    if (!isMentorReleased(proof)) {
      throw new GuardError(
        'split',
        'The calibration split opens only after the mentor has been released.',
      );
    }
    const sealed = this.fingerprint(jobId).certify;
    if (sealed === undefined) return [];
    const content = readFileSync(join(this.dir(jobId), CERTIFY_FILE), 'utf8');
    if (sha256(content) !== sealed.fileSha256) {
      throw new GuardError(
        'split',
        `The calibration split of job ${jobId} changed after it was sealed.`,
      );
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

  /**
   * Writes a job's sealed part into a job folder a comparison imports (decision 074, amended Oct
   * 30): the locked test's tasks, the sealed organizations' among them, and a certified job's
   * calibration split appended to `<dir>/tasks.jsonl`, and each sealed organization's files in
   * `<dir>/orgs/<id>/data/`, as a job folder holds them before it is imported. Returns the sealed
   * organizations, so the folder's job file lists them again. A file changed since it was sealed
   * is refused. Only the comparisons runner's source is staged this way: it imports the folder,
   * which seals it again in its own vault, and removes it; nothing of it goes to a mentor.
   */
  stageSealed(jobId: string, dir: string): Organization[] {
    const fingerprint = this.fingerprint(jobId);
    const tests = readFileSync(join(this.dir(jobId), TEST_FILE), 'utf8');
    if (sha256(tests) !== fingerprint.testFileSha256) {
      throw new GuardError('split', `The locked test of job ${jobId} changed after it was sealed.`);
    }
    let calibration = '';
    if (fingerprint.certify !== undefined) {
      calibration = readFileSync(join(this.dir(jobId), CERTIFY_FILE), 'utf8');
      if (sha256(calibration) !== fingerprint.certify.fileSha256) {
        throw new GuardError(
          'split',
          `The calibration split of job ${jobId} changed after it was sealed.`,
        );
      }
    }
    const transfer = fingerprint.transfer ?? [];
    for (const { org, files } of transfer) {
      const target = join(dir, 'orgs', org.id, 'data');
      for (const file of files) {
        const content = readFileSync(join(this.transferDir(jobId, org.id), file.name));
        if (sha256(content) !== file.sha256) {
          throw new GuardError(
            'split',
            `A sealed organization's file of job ${jobId} changed after it was sealed.`,
          );
        }
        mkdirSync(dirname(join(target, file.name)), { recursive: true });
        writeFileSync(join(target, file.name), content);
      }
    }
    appendFileSync(join(dir, 'tasks.jsonl'), `${tests}${calibration}`);
    return transfer.map(({ org }) => org);
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
