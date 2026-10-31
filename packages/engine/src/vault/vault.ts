import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  GuardError,
  OrganizationSchema,
  TaskSchema,
  type Organization,
  type SealedHashes,
  type Task,
} from '@architect/shared';
import { z } from 'zod';
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
/** Where the tasks of versions certified after the fact are sealed (decision 079). */
const CERTIFICATIONS_DIR = 'certifications';
/** Beside each certification's tasks, their prints for the leak detector. */
const PRINTS_SUFFIX = '.prints.json';
/** Where organizations sealed after the job was made keep their files and tasks (decision 085). */
const ADDED_DIR = 'added';
/** Written last in an added organization's folder, so its presence is what makes it sealed. */
const ADDED_SEAL = 'seal.json';
const ADDED_TASKS = 'tasks.jsonl';

/** An organization's seal beside the job's: its files' and tasks' hashes and its tasks' prints. */
const AddedSealSchema = z.object({
  org: OrganizationSchema,
  files: z.array(z.object({ name: z.string(), sha256: z.string() })),
  tasksSha256: z.string(),
  prints: FingerprintSchema.shape.tasks,
});
type AddedSeal = z.infer<typeof AddedSealSchema>;

/** The tasks a version is certified on after the fact: calibration, and each check by organization. */
export interface CertificationSets {
  calibration: Task[];
  checks: Record<string, Task[]>;
}

/**
 * An organization the job never trains on, with its files, sealed beside the test split
 * (decision 068). Its tasks are among the test tasks sealed with it.
 */
export interface TransferOrganization {
  org: Organization;
  files: readonly { name: string; content: string | Uint8Array }[];
}

/** A sealed organization with its files and its tasks, as they were sealed. */
export interface SealedOrganization extends TransferOrganization {
  tasks: Task[];
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
   * text of the job's data files, or of the organizations it trains on, with each table's rows as
   * the mentor is shown them: wording and values they share with test tasks (templates, records
   * every attempt reads, rows the mentor sees) are left out of the fingerprint (decision 082). A
   * sealed organization's files are never `data`: they hold test content. `transfer` are organizations
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
    const lines = `${calibration.map((task) => JSON.stringify(task)).join('\n')}\n`;
    // Its prints leave out only what the splits the mentor sees hold, as the test's do.
    const certified: Fingerprint['certify'] =
      calibration.length === 0
        ? undefined
        : {
            fileSha256: sha256(lines),
            tasks: fingerprintTests(jobId, calibration, otherTasks, data, sha256(lines)).tasks,
          };
    // A task with nothing of its own left to recognize it by could leak without the gate seeing.
    const blank = [...fingerprint.tasks, ...(certified?.tasks ?? [])].find(
      (print) => print.prompt === null && print.grams.length === 0 && print.values.length === 0,
    );
    if (blank !== undefined) {
      throw new GuardError(
        'split',
        `Task ${blank.id} can't be sealed: everything it says is also in the data or in other tasks, so a leak of it couldn't be recognized. Give it some wording or a value of its own, such as an id with digits.`,
      );
    }
    mkdirSync(dir, { recursive: true });
    writeFileAtomic(join(dir, TEST_FILE), content);
    if (certified !== undefined) writeFileAtomic(join(dir, CERTIFY_FILE), lines);
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
    const fingerprint = this.fingerprint(jobId);
    // Tasks a version was certified on after the fact are held to it like the test's (079).
    return createLeakDetector({
      ...fingerprint,
      tasks: [
        ...fingerprint.tasks,
        ...this.certificationPrints(jobId),
        ...this.added(jobId).flatMap((seal) => seal.prints),
      ],
    });
  }

  /**
   * The id and name of each organization sealed away from the mentor, so a request bound for a
   * teacher can be held to not naming one. Nothing else of the organizations leaves.
   */
  transferIdentifiers(jobId: string): { id: string; name: string }[] {
    if (!this.isSealed(jobId)) return [];
    return [...(this.fingerprint(jobId).transfer ?? []), ...this.added(jobId)].map(({ org }) => ({
      id: org.id,
      name: org.name,
    }));
  }

  /**
   * Each sealed organization by name and kind, with how many files it holds, for the person's
   * own view of their field. No id, file name or task leaves, and nothing here may reach a
   * mentor: the leak gate holds every request to not naming one.
   */
  sealedOrganizations(jobId: string): {
    name: string;
    synthetic: boolean;
    files: number;
    addedLater?: true;
    cohortOf?: string;
  }[] {
    if (!this.isSealed(jobId)) return [];
    return [
      ...(this.fingerprint(jobId).transfer ?? []).map(({ org, files }) => ({
        name: org.name,
        synthetic: org.synthetic,
        files: files.length,
        ...(org.cohortOf === undefined ? {} : { cohortOf: org.cohortOf }),
      })),
      ...this.added(jobId).map(({ org, files }) => ({
        name: org.name,
        synthetic: org.synthetic,
        files: files.length,
        addedLater: true as const,
        ...(org.cohortOf === undefined ? {} : { cohortOf: org.cohortOf }),
      })),
    ];
  }

  /**
   * Seals an organization the job never trains on after the job was made (decision 085), in its
   * own folder beside the job's seal, which is left exactly as it was. Its files are kept and
   * hashed; its tasks are fingerprinted as the test's are (decision 082), against `others`, the
   * tasks the mentor may see, and `data`, the taught organizations' files as the mentor is shown
   * them, with its id and name as test content, and their prints join the job's leak detector.
   * Refused when the job's test isn't sealed, when its id or name is taken, when a task is of
   * another organization or shares an id with a sealed or visible task, and when a task has
   * nothing of its own to be recognized by; nothing is written then.
   */
  addOrganization(
    jobId: string,
    organization: TransferOrganization,
    tasks: readonly Task[],
    others: readonly Task[],
    data: readonly string[],
  ): void {
    const { org, files } = organization;
    if (!this.isSealed(jobId)) {
      throw new GuardError('split', `The test split of job ${jobId} has not been sealed.`);
    }
    if (
      this.transferIdentifiers(jobId).some((item) => item.id === org.id || item.name === org.name)
    ) {
      throw new GuardError('split', `An organization called ${org.name} is already sealed.`);
    }
    if (tasks.length === 0) throw new Error(`${org.name} has no tasks to seal.`);
    const parsed = tasks.map((task) => TaskSchema.parse(task));
    const stranger = parsed.find((task) => task.org !== org.id);
    if (stranger !== undefined) {
      throw new GuardError('split', `Task ${stranger.id} isn't one of ${org.name}'s tasks.`);
    }
    const fingerprint = this.fingerprint(jobId);
    const taken = new Set([
      ...fingerprint.tasks.map((print) => print.id),
      ...(fingerprint.certify?.tasks ?? []).map((print) => print.id),
      ...this.added(jobId).flatMap((seal) => seal.prints.map((print) => print.id)),
      ...others.map((task) => task.id),
    ]);
    const ids = new Set<string>();
    for (const task of parsed) {
      if (taken.has(task.id) || ids.has(task.id)) {
        throw new GuardError(
          'split',
          `Task id ${task.id} is already taken in this field; give ${org.name}'s tasks ids of their own.`,
        );
      }
      ids.add(task.id);
    }
    const content = `${parsed.map((task) => JSON.stringify(task)).join('\n')}\n`;
    const prints = fingerprintTests(jobId, parsed, others, data, sha256(content), () => [
      org.id,
      org.name,
    ]).tasks;
    const blank = prints.find(
      (print) => print.prompt === null && print.grams.length === 0 && print.values.length === 0,
    );
    if (blank !== undefined) {
      throw new GuardError(
        'split',
        `Task ${blank.id} can't be sealed: everything it says is also in the data or in other tasks, so a leak of it couldn't be recognized. Give it some wording or a value of its own, such as an id with digits.`,
      );
    }
    const folder = this.addedDir(jobId, org.id);
    rmSync(folder, { recursive: true, force: true });
    const kept = files.map((file) => {
      const target = join(folder, 'data', file.name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
      return { name: file.name, sha256: sha256(file.content) };
    });
    writeFileAtomic(join(folder, ADDED_TASKS), content);
    const seal: AddedSeal = { org, files: kept, tasksSha256: sha256(content), prints };
    writeFileAtomic(join(folder, ADDED_SEAL), `${JSON.stringify(seal)}\n`);
  }

  /**
   * The organizations sealed after the job was made, for the engine alone: the runner looks one
   * up by the name the person gave it. Never for a mentor.
   */
  addedOrganizations(jobId: string): Organization[] {
    return this.isSealed(jobId) ? this.added(jobId).map(({ org }) => org) : [];
  }

  /**
   * An organization's tasks sealed after the job was made, for a frozen version's test on it
   * after the mentor is released. A file changed since it was sealed is refused.
   */
  openAdded(jobId: string, orgId: string, proof: MentorReleased): Task[] {
    if (!isMentorReleased(proof)) {
      throw new GuardError(
        'split',
        'A sealed organization opens only after the mentor has been released.',
      );
    }
    const seal = this.added(jobId).find(({ org }) => org.id === orgId);
    if (seal === undefined) {
      throw new GuardError('split', `No organization added later to job ${jobId} has that id.`);
    }
    const content = readFileSync(join(this.addedDir(jobId, orgId), ADDED_TASKS), 'utf8');
    if (sha256(content) !== seal.tasksSha256) {
      throw new GuardError(
        'split',
        `A sealed organization's tasks of job ${jobId} changed after they were sealed.`,
      );
    }
    return content
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => TaskSchema.parse(JSON.parse(line)));
  }

  /**
   * A never-seen organization's files and tasks, as they were sealed, for the new version of the
   * job that teaches on it, at the person's word (decision 089). It is the engine's, to become
   * that version's material and practice; nothing here changes, so this job's final test and
   * what was measured on it stay as they were. A file changed since it was sealed is refused.
   */
  releaseOrganization(jobId: string, orgId: string): SealedOrganization {
    const found = this.sealedParts(jobId).find(({ org }) => org.id === orgId);
    if (found === undefined) {
      throw new GuardError('split', `No organization sealed in job ${jobId} has that id.`);
    }
    return found;
  }

  /**
   * Seals the next version of a job in `toJobId`'s vault (decision 089): its final test is this
   * job's without the tasks of `movedOrgId`, now taught on (none moves when the field is carried
   * to another model, decision 095), its calibration split is this job's,
   * and every other sealed organization, those added later among them, is sealed again as never
   * seen with its files and tasks. The prints are made afresh by decision 082's rules: against
   * `others`, the new version's visible tasks, and `data`, its taught organizations' files with
   * the moved one's among them, and a task with nothing of its own left is refused. This job's
   * vault is only read.
   */
  sealVersion(
    fromJobId: string,
    toJobId: string,
    movedOrgId: string | null,
    others: readonly Task[],
    data: readonly string[],
  ): void {
    const fingerprint = this.fingerprint(fromJobId);
    const tests = this.readChecked(
      join(this.dir(fromJobId), TEST_FILE),
      fingerprint.testFileSha256,
      `The locked test of job ${fromJobId} changed after it was sealed.`,
    );
    const calibration =
      fingerprint.certify === undefined
        ? []
        : this.readChecked(
            join(this.dir(fromJobId), CERTIFY_FILE),
            fingerprint.certify.fileSha256,
            `The calibration split of job ${fromJobId} changed after it was sealed.`,
          );
    const kept = this.sealedParts(fromJobId).filter(({ org }) => org.id !== movedOrgId);
    // The job's own sealed organizations' tasks are in its test; those added later bring theirs.
    const own = new Set((fingerprint.transfer ?? []).map(({ org }) => org.id));
    const added = kept.filter(({ org }) => !own.has(org.id)).flatMap(({ tasks }) => tasks);
    this.seal(
      toJobId,
      [...tests.filter((task) => task.org !== movedOrgId), ...added],
      others,
      data,
      kept.map(({ org, files }) => ({ org, files })),
      calibration,
    );
  }

  /**
   * Every organization sealed in a job, the job's own and those added later, with its files and
   * tasks as sealed, each checked against its hash.
   */
  private sealedParts(jobId: string): SealedOrganization[] {
    const fingerprint = this.fingerprint(jobId);
    const transfer = fingerprint.transfer ?? [];
    const tests =
      transfer.length === 0
        ? []
        : this.readChecked(
            join(this.dir(jobId), TEST_FILE),
            fingerprint.testFileSha256,
            `The locked test of job ${jobId} changed after it was sealed.`,
          );
    const changed = `A sealed organization's file of job ${jobId} changed after it was sealed.`;
    const read = (folder: string, files: readonly { name: string; sha256: string }[]) =>
      files.map((file) => {
        const content = readFileSync(join(folder, file.name));
        if (sha256(content) !== file.sha256) throw new GuardError('split', changed);
        return { name: file.name, content: new Uint8Array(content) };
      });
    return [
      ...transfer.map(({ org, files }) => ({
        org,
        files: read(this.transferDir(jobId, org.id), files),
        tasks: tests.filter((task) => task.org === org.id),
      })),
      ...this.added(jobId).map(({ org, files, tasksSha256 }) => ({
        org,
        files: read(join(this.addedDir(jobId, org.id), 'data'), files),
        tasks: this.readChecked(
          join(this.addedDir(jobId, org.id), ADDED_TASKS),
          tasksSha256,
          changed,
        ),
      })),
    ];
  }

  /** The tasks of a sealed file, refused when it no longer has the hash it was sealed with. */
  private readChecked(file: string, expected: string, changed: string): Task[] {
    const content = readFileSync(file, 'utf8');
    if (sha256(content) !== expected) throw new GuardError('split', changed);
    return content
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => TaskSchema.parse(JSON.parse(line)));
  }

  /** Every organization sealed beside the job's seal, read from its own seal file. */
  private added(jobId: string): AddedSeal[] {
    const folder = join(this.dir(jobId), ADDED_DIR);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => existsSync(join(folder, name, ADDED_SEAL)))
      .sort()
      .map((name) =>
        AddedSealSchema.parse(JSON.parse(readFileSync(join(folder, name, ADDED_SEAL), 'utf8'))),
      );
  }

  private addedDir(jobId: string, orgId: string): string {
    if (!OrganizationSchema.shape.id.safeParse(orgId).success) {
      throw new Error(`"${orgId}" is not a valid organization id.`);
    }
    return join(this.dir(jobId), ADDED_DIR, orgId);
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
    const added = this.added(jobId);
    for (const { org, files } of added) {
      const folder = join(this.addedDir(jobId, org.id), 'data');
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
    return {
      organizations: [...transfer, ...added].map(({ org }) => org),
      dataDirs,
    };
  }

  /**
   * Seals the tasks a frozen version is certified on after the fact (decision 079), in this
   * job's vault beside its test. They are fingerprinted as the test is (decision 082): `others`
   * are the tasks the job's mentor may see and `data` the text of the files it trains on, with
   * each table's rows as the mentor is shown them, and their prints join the job's leak detector.
   * A task with nothing of its own to be recognized by is refused, and nothing is written. A
   * sealed set is never replaced. Returns the file's sha256, which opening it again must match.
   */
  sealCertification(
    jobId: string,
    certificationId: string,
    sets: CertificationSets,
    others: readonly Task[],
    data: readonly string[],
  ): string {
    const file = this.certificationFile(jobId, certificationId);
    if (existsSync(file)) {
      throw new GuardError('split', `The tasks of certification ${certificationId} are sealed.`);
    }
    const parsed = {
      calibration: sets.calibration.map((task) => TaskSchema.parse(task)),
      checks: Object.fromEntries(
        Object.entries(sets.checks).map(([org, tasks]) => [
          org,
          tasks.map((task) => TaskSchema.parse(task)),
        ]),
      ),
    };
    const content = `${JSON.stringify(parsed)}\n`;
    const tasks = [...parsed.calibration, ...Object.values(parsed.checks).flat()];
    const prints = fingerprintTests(jobId, tasks, others, data, sha256(content)).tasks;
    const blank = prints.find(
      (print) => print.prompt === null && print.grams.length === 0 && print.values.length === 0,
    );
    if (blank !== undefined) {
      throw new GuardError(
        'split',
        `Task ${blank.id} can't be sealed: everything it says is also in the data or in other tasks, so a leak of it couldn't be recognized. Give it some wording or a value of its own, such as an id with digits.`,
      );
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileAtomic(this.printsFile(jobId, certificationId), `${JSON.stringify(prints)}\n`);
    writeFileAtomic(file, content);
    return sha256(content);
  }

  /** A certification's sealed tasks, after the mentor is released, as long as they are unchanged. */
  openCertification(
    jobId: string,
    certificationId: string,
    expectedSha256: string,
    proof: MentorReleased,
  ): CertificationSets {
    if (!isMentorReleased(proof)) {
      throw new GuardError(
        'split',
        "A certification's tasks open only after the mentor has been released.",
      );
    }
    const content = readFileSync(this.certificationFile(jobId, certificationId), 'utf8');
    if (sha256(content) !== expectedSha256) {
      throw new GuardError(
        'split',
        `The tasks of certification ${certificationId} changed after they were sealed.`,
      );
    }
    const raw = JSON.parse(content) as {
      calibration: unknown[];
      checks: Record<string, unknown[]>;
    };
    return {
      calibration: raw.calibration.map((task) => TaskSchema.parse(task)),
      checks: Object.fromEntries(
        Object.entries(raw.checks).map(([org, tasks]) => [
          org,
          tasks.map((task) => TaskSchema.parse(task)),
        ]),
      ),
    };
  }

  /** Takes back the sealed tasks of a certification that never started. */
  discardCertification(jobId: string, certificationId: string): void {
    rmSync(this.certificationFile(jobId, certificationId), { force: true });
    rmSync(this.printsFile(jobId, certificationId), { force: true });
  }

  /** The prints of every certification sealed in a job's vault after the fact. */
  private certificationPrints(jobId: string): Fingerprint['tasks'] {
    const folder = join(this.dir(jobId), CERTIFICATIONS_DIR);
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((name) => name.endsWith(PRINTS_SUFFIX))
      .flatMap((name) =>
        FingerprintSchema.shape.tasks.parse(JSON.parse(readFileSync(join(folder, name), 'utf8'))),
      );
  }

  private printsFile(jobId: string, certificationId: string): string {
    return this.certificationFile(jobId, certificationId).replace(/\.json$/, PRINTS_SUFFIX);
  }

  private certificationFile(jobId: string, certificationId: string): string {
    if (!JOB_ID.test(certificationId)) {
      throw new Error(`"${certificationId}" is not a valid certification id.`);
    }
    return join(this.dir(jobId), CERTIFICATIONS_DIR, `${certificationId}.json`);
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
