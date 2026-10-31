import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import {
  CodedError,
  DraftRecordSchema,
  isBaselineMethod,
  JobSchema,
  newId,
  RuleConfirmationSchema,
  StudyRecordSchema,
  TaskSchema,
  trainOrganizations,
  ORG_ID,
  slugify,
  type AddOrganizationRequest,
  type DraftRecord,
  type Job,
  type Organization,
  type ResourceFile,
  type JobRun,
  type JobSummary,
  type RuleConfirmation,
  type RuleConfirmationState,
  type RuleReport,
  type StudyRecord,
  type StudyState,
  type Task,
  type TaskPlan,
} from '@architect/shared';
import { z } from 'zod';
import { calibrationSize } from '../certify/settings';
import { parseCsv } from '../data/csv';
import { addedOrganizationTasks } from '../drafting/field';
import { folderShortfalls, shortfallInWords } from '../graduates/checks';
import { bindingOf, reportsOf, ruleTypesOf, stateOf, type Binding } from '../drafting/confirmation';
import { readInPlainerWords } from '../drafting/older-words';
import { buildTaskPlan } from '../drafting/plan';
import { recordingsView } from '../drafting/recordings';
import { isStudied, materialFiles, studyStateOf } from '../drafting/study';
import { ContractBook } from '../graduates/contracts';
import { mentorDataTexts } from '../mentor/data-files';
import type { EngineStore } from '../store/engine-store';
import type { JobRecord, StoredRun } from '../store/records';
import type { TransferOrganization } from '../vault/vault';
import type { Clock, LoopDeps } from './deps';
import { must } from './errors';
import { readJsonFile, readJsonLines, writeJsonFile, writeJsonLines } from './files';
import { nextVersion } from './job-versions';
import { isSafeId, type DataPaths, type VisibleSplit } from './paths';
import { checkOrganizations, orgDataDir } from './organizations';
import { isoNow } from './time';

/** A relative path that stays inside its folder. */
function insidePath(path: string): string {
  const normalized = normalize(path);
  if (isAbsolute(normalized) || normalized.split(sep).includes('..')) {
    throw new Error(`"${path}" must be a path inside the job folder.`);
  }
  return normalized;
}

function checkTasks(job: Job, tasks: readonly Task[]): void {
  const types = new Set(job.taskTypes.map((type) => type.id));
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`Task id "${task.id}" appears more than once.`);
    seen.add(task.id);
    if (!types.has(task.type)) {
      throw new Error(`Task "${task.id}" has type "${task.type}", which the job doesn't declare.`);
    }
  }
  checkOrganizations(job, tasks);
}

/**
 * The job as the library keeps it: only the organizations it trains on. The ones it never
 * trains on go to the vault with their files and tasks, so nothing in the job's folder names
 * them (decision 068).
 */
function withoutTransfer(job: Job): Job {
  return job.organizations === undefined ? job : { ...job, organizations: trainOrganizations(job) };
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

/** The first thing a schema found wrong, in a few words: `format: Invalid input`. */
function firstIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) return 'it has values a job file does not hold';
  const path = issue.path.map(String).join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
}

/**
 * The job a job file holds. A file that is not JSON, or whose JSON is not a job, is not a job
 * file, which a screen says in its own words (`not_a_job`).
 */
async function readJobFile(file: string): Promise<Job> {
  const name = basename(file);
  const text = await readFile(file, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new CodedError('not_a_job', `${name} isn't a job file: it isn't valid JSON.`, {
      cause: error,
    });
  }
  const parsed = JobSchema.safeParse(json);
  if (!parsed.success) {
    throw new CodedError('not_a_job', `${name} isn't a job file: ${firstIssue(parsed.error)}.`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * The files of each organization the job never trains on, read from `orgs/<id>/data/` next to
 * the job file, for the vault: every file the job declares, less an optional one it lacks. None
 * for a job without such organizations.
 */
async function readTransfer(job: Job, source: string): Promise<TransferOrganization[]> {
  const transfer = (job.organizations ?? []).filter((org) => org.role === 'transfer');
  return Promise.all(
    transfer.map(async (org) => ({
      org,
      files: (
        await Promise.all(
          job.data.files.map(async (file) => {
            const path = join(orgDataDir(source, org.id), file.name);
            try {
              return [{ name: file.name, content: await readFile(path) }];
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              if (file.optional === true) return [];
              throw new Error(
                `A data file of a sealed organization is missing; each organization the job never trains on needs the job's data files in its own orgs/<id>/data folder next to the job file.`,
                { cause: error },
              );
            }
          }),
        )
      ).flat(),
    })),
  );
}

/** The tasks of a `tasks.jsonl`, with the line named when one isn't a task. None for no file. */
async function readTasks(file: string): Promise<Task[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim() === '') return [];
    try {
      return [TaskSchema.parse(JSON.parse(line))];
    } catch (error) {
      const why = error instanceof z.ZodError ? firstIssue(error) : "it isn't valid JSON";
      throw new Error(`Line ${index + 1} of tasks.jsonl isn't a task: ${why}.`, { cause: error });
    }
  });
}

/**
 * The job's files as a folder must hold them: each table with the columns the first taught
 * organization's copy has, so another organization's folder can be checked against them.
 */
async function withColumns(job: Job, dataDir: string): Promise<ResourceFile[]> {
  return Promise.all(
    job.data.files.map(async (file) => {
      if (file.kind !== 'table') return file;
      const content = await readFile(join(dataDir, file.name), 'utf8').catch(() => null);
      return content === null ? file : { ...file, columns: parseCsv(file.name, content).columns };
    }),
  );
}

/** Copies a file, saying `missing` when it isn't there; an `optional` file that isn't is skipped. */
async function copyInto(
  from: string,
  to: string,
  missing: string,
  optional = false,
): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await copyFile(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (optional) return;
      throw new Error(missing, { cause: error });
    }
    throw error;
  }
}

/** A job built from files and tasks that are in hand, which `create` records as an import does. */
export interface NewJob {
  /** Its id is a request: a fresh one is chosen when it is taken. */
  job: Job;
  /** The data files, by the names the job gives them. */
  files: readonly { name: string; content: Uint8Array }[];
  tasks: readonly Task[];
  /** Where the tasks came from and what drafting cost, kept beside the job. */
  drafting: DraftRecord;
}

/**
 * Jobs on disk: `jobs/<job>/job.json`, a snapshot of the data, and the mentor-visible task
 * splits. The test split goes straight into the vault when tasks are imported and is never
 * written here.
 */
export class JobLibrary {
  private readonly taskCache = new Map<string, Task[]>();
  /** The jobs being made now in this process, which an interrupted one is told apart from. */
  private readonly finalizing = new Set<string>();

  constructor(
    private readonly store: EngineStore,
    private readonly paths: DataPaths,
    private readonly deps: Pick<LoopDeps, 'runtime' | 'vault'>,
    private readonly clock: Clock,
    private readonly contracts: ContractBook = new ContractBook(store, clock),
  ) {}

  /**
   * Each job with its newest run that isn't a baseline. A comparison starts its baselines after
   * the agent's own run, so the newest run of the job can be one of them, which is never the run
   * a person opens the job to.
   */
  summaries(): JobSummary[] {
    return this.store.jobs.list().map((record) => {
      const latest = this.store.runs
        .list(record.id)
        .find(({ run }) => !isBaselineMethod(run.method));
      return {
        id: record.id,
        name: record.name,
        summary: record.summary,
        createdAt: record.createdAt,
        taskCount: record.taskCount,
        ...(latest === undefined ? {} : { latestRun: this.jobRun(latest) }),
      };
    });
  }

  private jobRun({ run, improves }: StoredRun): JobRun {
    const made = this.store.versions.forRun(run.id);
    return {
      id: run.id,
      status: run.status,
      phase: run.phase,
      method: run.method,
      devCurrent: run.devCurrent,
      devBaseline: run.devBaseline,
      ...(improves === undefined ? {} : { improves: true as const }),
      ...(made === null ? {} : { accepted: made.state === 'accepted' }),
    };
  }

  async get(jobId: string): Promise<Job> {
    if (!this.store.jobs.get(jobId)) {
      throw new CodedError('job_not_found', `There is no job "${jobId}".`);
    }
    return JobSchema.parse(await readJsonFile(this.paths.jobFile(jobId)));
  }

  /** The job as it was when the run started. */
  async forRun(record: StoredRun): Promise<Job> {
    return JobSchema.parse(
      await readJsonFile(this.paths.runJobFile(record.run.jobId, record.run.id)),
    );
  }

  /**
   * The job as it was when the run started, for work that is about to use the job's records as
   * they are now: refused, with the reason, unless its rules are confirmed over them (decision
   * 061) and its study of its organizations is confirmed (069). A re-test or a measure of a
   * finished run is such work too.
   */
  async forWork(record: StoredRun): Promise<Job> {
    const job = await this.forRun(record);
    await this.requireConfirmedRules(job);
    return job;
  }

  /**
   * Saves the editable job. When its scope or success criteria differ from every contract
   * version it had, that makes a new version; earlier versions, and the graduation results
   * measured against them, stay as they were. A checker file chosen from elsewhere on this
   * computer (an absolute path) is copied into the job's folder first, and the saved job points
   * at the copy.
   */
  async save(job: Job): Promise<Job> {
    const chosen = JobSchema.parse(job);
    if (!isSafeId(chosen.id)) throw new Error(`"${chosen.id}" isn't a valid job id.`);
    const parsed = await this.keepChecker(chosen);
    const now = isoNow(this.clock);
    const existing = this.store.jobs.get(parsed.id);
    await writeJsonFile(this.paths.jobFile(parsed.id), parsed);
    this.store.transaction(() => {
      if (existing) {
        this.store.jobs.update({
          ...existing,
          name: parsed.name,
          summary: parsed.summary,
          updatedAt: now,
        });
      } else {
        this.store.jobs.insert({
          id: parsed.id,
          name: parsed.name,
          summary: parsed.summary,
          path: this.paths.toStored(this.paths.jobDir(parsed.id)),
          taskCount: 0,
          createdAt: parsed.createdAt,
          updatedAt: now,
        });
      }
      this.contracts.ensure(parsed);
    });
    return parsed;
  }

  /**
   * Imports a job file with `tasks.jsonl` and a `data/` folder beside it (the sample job ships
   * this way), and the starting harness folder when the job imports one. The tasks are split at
   * once and the test split is sealed in the vault. `drafting` is what drafting a field from
   * several organizations' folders left (decision 083), kept beside the job as a drafted job's is.
   */
  async importFile(file: string, drafting?: DraftRecord): Promise<Job> {
    const source = dirname(resolve(file));
    const parsed = await readJobFile(file);
    const job: Job = { ...parsed, id: await this.freshId(parsed.id) };
    const tasks = await readTasks(join(source, 'tasks.jsonl'));
    checkTasks(job, tasks);
    const transfer = await readTransfer(job, source);
    const kept = withoutTransfer(job);

    return this.finalize(kept, async () => {
      const orgs = trainOrganizations(job);
      for (const data of job.data.files) {
        if (orgs.length === 0) {
          await copyInto(
            join(source, 'data', data.name),
            join(this.paths.dataDir(job.id), data.name),
            `The data file "${data.name}" is missing; it belongs in a data folder next to the job file.`,
            data.optional === true,
          );
        }
        for (const org of orgs) {
          await copyInto(
            join(orgDataDir(source, org.id), data.name),
            join(orgDataDir(this.paths.jobDir(job.id), org.id), data.name),
            `The data file "${data.name}" of ${org.name} is missing; it belongs in orgs/${org.id}/data next to the job file.`,
            data.optional === true,
          );
        }
      }
      if (job.checker.kind === 'module') {
        const checker = insidePath(job.checker.path);
        await copyInto(
          join(source, checker),
          join(this.paths.jobDir(job.id), checker),
          `The checker "${job.checker.path}" is missing next to the job file.`,
        );
      }
      if (job.startingHarness.kind === 'import') {
        const folder = insidePath(job.startingHarness.path);
        const from = join(source, folder);
        if (!(await stat(from).catch(() => null))?.isDirectory()) {
          throw new Error(
            `The starting harness folder "${job.startingHarness.path}" is missing next to the job file.`,
          );
        }
        await cp(from, join(this.paths.jobDir(job.id), folder), { recursive: true });
      }
      if (drafting !== undefined) {
        await writeJsonFile(this.paths.draftingFile(job.id), DraftRecordSchema.parse(drafting));
      }
      if (tasks.length > 0) await this.installTasks(kept, tasks, transfer);

      await writeJsonFile(this.paths.jobFile(job.id), kept);
      this.record(kept, tasks.length);
      return kept;
    });
  }

  /**
   * Makes a job all at once or not at all: its folder, its tasks, its sealed final test and its
   * place in the library. A step that fails takes back the others, the seal and the folder, and
   * says why, so a second try finds nothing of the first and keeps the job's id. A mark in the
   * folder, there from the first file to the last step, tells the next start that the app closed
   * in the middle (`recoverInterrupted`). `work` ends with the job's place in the library.
   *
   * Only a folder this making created is ever taken back: the job's folder is made here and
   * nowhere else, and one that is already there is someone else's and is left as it is.
   */
  private async finalize(job: Job, work: () => Promise<Job>): Promise<Job> {
    const { id } = job;
    await this.claim(id);
    this.finalizing.add(id);
    let made: Job;
    try {
      await writeFile(this.paths.finalizingMark(id), '');
      made = await work();
    } catch (error) {
      // Should taking back fail too, the mark stays and the next start finishes it, and says so.
      await this.takeBack(id).catch(() => undefined);
      throw error;
    } finally {
      this.finalizing.delete(id);
    }
    // The job is whole and in the library. A mark that can't be removed now only says it wasn't
    // yet, and the next start clears it.
    await rm(this.paths.finalizingMark(id), { force: true }).catch(() => undefined);
    return made;
  }

  /**
   * Makes the job's folder, which must not be there yet. `freshId` chose an id with no folder, so
   * one that is there now was made since by someone else: a person's own files, or another job
   * of the same id being made at this moment. It is not touched, and nothing is made in it.
   */
  private async claim(jobId: string): Promise<void> {
    await mkdir(this.paths.jobs, { recursive: true });
    try {
      await mkdir(this.paths.jobDir(jobId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new Error(
        `There is already a folder for a job called "${jobId}" that Architect did not make for this one, so it was left as it is. Try again, and the job will be made under another id.`,
        { cause: error },
      );
    }
  }

  /** Takes back what making a job wrote: its seal first, so a folder never outlives it unmarked. */
  private async takeBack(jobId: string): Promise<void> {
    await this.deps.vault.discard(jobId);
    await rm(this.paths.jobDir(jobId), { recursive: true, force: true });
  }

  /**
   * Finishes what an app that closed in the middle of making a job left behind: the folder, its
   * tasks and its seal of a job that never reached the library are taken back, and the mark of one
   * that did is cleared. A job being made now is left alone. Returns the jobs taken back. A job
   * that can't be taken back is reported through `onError` and tried again at the next start.
   */
  async recoverInterrupted(onError?: (error: unknown) => void): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.paths.jobs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const taken: string[] = [];
    for (const id of names) {
      if (!isSafeId(id) || this.finalizing.has(id)) continue;
      if (!(await exists(this.paths.finalizingMark(id)))) continue;
      try {
        if (this.store.jobs.get(id) === null) {
          await this.takeBack(id);
          taken.push(id);
        } else {
          await rm(this.paths.finalizingMark(id), { force: true });
        }
      } catch (error) {
        onError?.(
          new Error(`The job "${id}" was left half made and could not be cleared away.`, {
            cause: error,
          }),
        );
      }
    }
    return taken;
  }

  /**
   * Records a job whose files and tasks are in hand, such as one drafted from a person's own
   * files: the files are written as its data, the tasks are split and the final test sealed in
   * the vault, and the job is recorded, so `save` and a run work on it as they do on an import.
   * The split is worked out first, so tasks that can't be split leave nothing behind.
   */
  async create(input: NewJob): Promise<Job> {
    const job: Job = { ...input.job, id: await this.freshId(input.job.id) };
    const tasks = [...input.tasks];
    if (job.organizations !== undefined) {
      throw new CodedError(
        'not_a_job',
        "A job with organizations is imported from its folder, with each one's files in orgs/<id>/data.",
      );
    }
    checkTasks(job, tasks);
    this.deps.runtime.splitTasks(tasks, {
      ...job.splits,
      certify: calibrationSize(job, tasks.length),
    });
    return this.finalize(job, async () => {
      for (const file of input.files) {
        const target = join(this.paths.dataDir(job.id), file.name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
      await writeJsonFile(this.paths.draftingFile(job.id), DraftRecordSchema.parse(input.drafting));
      await writeJsonFile(this.paths.jobFile(job.id), job);
      await this.installTasks(job, tasks, []);
      this.record(job, tasks.length);
      return job;
    });
  }

  /**
   * What drafting a job left beside it, or null for a job whose tasks came with it. The record is
   * read in the words a rule is told in now, whenever it was drafted; the file is not changed.
   */
  async drafting(jobId: string): Promise<DraftRecord | null> {
    let stored: unknown;
    try {
      stored = await readJsonFile(this.paths.draftingFile(jobId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return readInPlainerWords(DraftRecordSchema.parse(stored));
  }

  /**
   * What a job's tasks are: where they came from, the rule behind each type, a few examples with
   * their expected answers, and how many sit in each set. The examples come from the practice and
   * starting sets; the final test is only counted. A job with a rule also says whether the person
   * has confirmed it over these records.
   */
  async taskPlan(jobId: string): Promise<TaskPlan> {
    const job = await this.get(jobId);
    const [calibration, train, dev] = await Promise.all([
      this.tasks(jobId, 'calibration'),
      this.tasks(jobId, 'train'),
      this.tasks(jobId, 'dev'),
    ]);
    const sealed = (await this.deps.vault.isSealed(jobId))
      ? await this.deps.vault.typeCounts(jobId)
      : {};
    const confirmation = await this.ruleState(jobId);
    const study = await this.studyState(jobId);
    return {
      ...buildTaskPlan({
        job,
        draft: await this.drafting(jobId),
        visible: { calibration, train, dev },
        sealed,
      }),
      ...(confirmation === null ? {} : { confirmation }),
      ...(study === null ? {} : { study, recordings: await recordingsView(job, this.paths) }),
    };
  }

  /** What the person confirmed about a job's rules, or null while nothing is confirmed. */
  private async confirmation(jobId: string): Promise<RuleConfirmation | null> {
    try {
      return RuleConfirmationSchema.parse(await readJsonFile(this.paths.confirmationFile(jobId)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** The rules and the records as they are now, hashed, for comparing with what was confirmed. */
  private async binding(job: Job, draft: DraftRecord): Promise<Binding> {
    return bindingOf(
      draft,
      job.data.files.map((file) => file.name),
      async (name) => {
        try {
          return await readFile(join(this.paths.dataDir(job.id), name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      },
    );
  }

  /**
   * Whether a job's rules are confirmed over the records the tasks were made from. Null for a
   * job with no rule, which has nothing to confirm.
   */
  async ruleState(jobId: string): Promise<RuleConfirmationState | null> {
    const draft = await this.drafting(jobId);
    if (draft === null || ruleTypesOf(draft).length === 0) return null;
    const job = await this.get(jobId);
    return stateOf(draft, await this.confirmation(jobId), await this.binding(job, draft));
  }

  /**
   * Records that the person confirmed the job's rules over these records. `token` is what the
   * screen showed them (`ruleState`'s), so a rule or a file that changed since is refused rather
   * than confirmed unseen.
   */
  async confirmRules(jobId: string, token: string): Promise<RuleConfirmationState> {
    const draft = await this.drafting(jobId);
    if (draft === null || ruleTypesOf(draft).length === 0) {
      throw new Error('This job has no rule to confirm.');
    }
    const job = await this.get(jobId);
    const now = await this.binding(job, draft);
    const state = stateOf(draft, null, now);
    if (state.state === 'changed') {
      throw new CodedError('rule_changed', state.problem ?? 'The records changed.');
    }
    if (token !== now.token) {
      throw new CodedError(
        'rule_changed',
        'The rule or the records changed since you looked at them. Look at the rule again, then confirm it.',
      );
    }
    const confirmedAt = isoNow(this.clock);
    await writeJsonFile(this.paths.confirmationFile(jobId), {
      format: 1,
      confirmedAt,
      rules: now.rules,
      files: now.files,
    } satisfies RuleConfirmation);
    return { state: 'confirmed', token: now.token, confirmedAt };
  }

  /** What the teacher's study of a field job left, or null before it was studied. */
  async studyRecord(jobId: string): Promise<StudyRecord | null> {
    try {
      return StudyRecordSchema.parse(await readJsonFile(this.paths.studyFile(jobId)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Keeps a study's brief beside the job, unconfirmed: a new one replaces the one before. */
  async writeStudy(jobId: string, record: StudyRecord): Promise<void> {
    await writeJsonFile(this.paths.studyFile(jobId), StudyRecordSchema.parse(record));
  }

  /** The train organizations' files as they are now, hashed. */
  studiedFiles(job: Job): Promise<StudyRecord['files']> {
    return materialFiles(job, (orgId) => this.paths.orgDataDir(job.id, orgId));
  }

  /**
   * Where the study of a job that lists organizations stands (decision 069). Null for any other
   * job, which has nothing to study.
   */
  async studyState(jobId: string): Promise<StudyState | null> {
    const job = await this.get(jobId);
    if (!isStudied(job)) return null;
    return studyStateOf(await this.studyRecord(jobId), await this.studiedFiles(job));
  }

  /**
   * Records that the person confirmed the brief. `token` is the one the brief was shown with, so
   * a brief or material that changed since is refused rather than confirmed unseen.
   */
  async confirmStudy(jobId: string, token: string): Promise<StudyState> {
    const record = await this.studyRecord(jobId);
    const state = await this.studyState(jobId);
    if (record === null || state === null || state.state === 'unstudied') {
      throw new Error('This job has no brief to confirm yet.');
    }
    if (state.state === 'changed' || state.token !== token) {
      throw new CodedError(
        'study_unconfirmed',
        state.problem ??
          'The brief or the material changed since you read it. Read the brief again, then confirm it.',
      );
    }
    if (state.state === 'confirmed') return state;
    const confirmedAt = isoNow(this.clock);
    await this.writeStudy(jobId, { ...record, confirmedAt });
    return { ...state, state: 'confirmed', confirmedAt };
  }

  /** Refuses a run on a field job whose study the person has not confirmed. */
  async requireStudied(job: Job): Promise<void> {
    const state = await this.studyState(job.id);
    if (state === null || state.state === 'confirmed') return;
    throw new CodedError(
      'study_unconfirmed',
      state.state === 'changed'
        ? (state.problem ?? "The organizations' files changed since they were studied.")
        : `${job.mentor.label}'s study of the organizations for "${job.name}" isn't confirmed yet. Open the job, read the brief and confirm it before training.`,
    );
  }

  /**
   * Refuses a run on a job whose rules the person has not confirmed over these records, or whose
   * study of its organizations they have not confirmed.
   */
  async requireConfirmedRules(job: Job): Promise<void> {
    await this.requireStudied(job);
    const state = await this.ruleState(job.id);
    if (state === null || state.state === 'confirmed') return;
    if (state.state === 'needed') {
      throw new CodedError(
        'rule_unconfirmed',
        `The rule for "${job.name}" isn't confirmed yet. Open the job, check the rule against your policy and confirm it before training.`,
      );
    }
    throw new CodedError('rule_changed', state.problem ?? 'The records changed.');
  }

  /** The job's rules as the report says them, each with when the person confirmed it. */
  async ruleReports(jobId: string): Promise<RuleReport[]> {
    const draft = await this.drafting(jobId);
    if (draft === null) return [];
    const job = await this.get(jobId);
    return reportsOf(
      draft,
      new Map(job.taskTypes.map((type) => [type.id, type.label])),
      await this.confirmation(jobId),
    );
  }

  private record(job: Job, taskCount: number, versionOf?: JobRecord['versionOf']): void {
    this.store.transaction(() => {
      this.store.jobs.insert({
        id: job.id,
        name: job.name,
        summary: job.summary,
        path: this.paths.toStored(this.paths.jobDir(job.id)),
        taskCount,
        createdAt: job.createdAt,
        updatedAt: isoNow(this.clock),
        ...(versionOf === undefined ? {} : { versionOf }),
      });
      this.contracts.ensure(job);
    });
  }

  /**
   * Copies a checker file chosen from elsewhere into the job's folder, under a name that follows
   * what is in it (`checks-3f9a2c1b4d5e.js`), and points the job at the copy. A checker the
   * engine loads must sit inside the job's folder, so a path outside it never worked; and a name
   * that follows the content means a different file is a new file, so the runs graded with the
   * old one keep it. A checker already inside the folder is left as it is.
   */
  private async keepChecker(job: Job): Promise<Job> {
    if (job.checker.kind !== 'module' || !isAbsolute(job.checker.path)) return job;
    const from = job.checker.path;
    let content: Buffer;
    try {
      content = await readFile(from);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`The checker file ${basename(from)} isn't there any more.`, {
          cause: error,
        });
      }
      throw error;
    }
    const extension = extname(from) || '.js';
    const stem = basename(from, extname(from))
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .slice(0, 60);
    const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
    const kept = `${stem || 'checker'}-${digest}${extension}`;
    await mkdir(this.paths.jobDir(job.id), { recursive: true });
    await writeFile(join(this.paths.jobDir(job.id), kept), content);
    return { ...job, checker: { kind: 'module', path: kept } };
  }

  /** Writes the job file as-is. Tasks stay behind: the test split never leaves the vault. */
  async exportFile(jobId: string, file: string): Promise<void> {
    await writeJsonFile(file, await this.get(jobId));
  }

  /**
   * Seals a never-seen organization into a field after it was made (decision 085). The folder
   * must hold the job's files with the columns its first taught organization's tables have, as
   * an agent's own records folder is checked (decision 070). Its tasks come from a `tasks.jsonl`
   * in the folder, each of the job's kinds and of no other organization, or, for a field drafted
   * from folders, are made from its files with the field's own kinds of task; anything else is
   * refused with what to do. The organization's files and tasks go to the vault beside the job's
   * seal, which doesn't change, and nothing of it is written to the job.
   */
  async addOrganization(jobId: string, request: AddOrganizationRequest): Promise<void> {
    const job = await this.get(jobId);
    const taught = trainOrganizations(job);
    const [first] = taught;
    if (first === undefined) {
      throw new CodedError(
        'not_a_job',
        `${job.name} serves one organization, so it has no field to add one to. Make a field of several organizations to qualify on one it never saw.`,
      );
    }
    if (!(await this.deps.vault.isSealed(jobId))) {
      throw new Error(
        `${job.name} has no sealed final test yet, so nothing can be sealed beside it.`,
      );
    }
    const name = request.name.trim();
    const id = slugify(name);
    if (!ORG_ID.test(id)) {
      throw new Error(`"${name}" can't name an organization; use letters or digits in it.`);
    }
    const sealed = await this.deps.vault.transferIdentifiers(jobId);
    if ([...taught, ...sealed].some((org) => org.id === id || org.name === name)) {
      throw new Error(
        `${job.name} already has an organization called ${name}. Give it another name.`,
      );
    }
    const folder = resolve(request.folder);
    if (!(await stat(folder).catch(() => null))?.isDirectory()) {
      throw new Error(`${folder} isn't a folder.`);
    }
    const shortfalls = await folderShortfalls(
      await withColumns(job, orgDataDir(this.paths.jobDir(jobId), first.id)),
      folder,
    );
    if (shortfalls.length > 0) {
      throw new Error(
        `That folder doesn't hold what ${job.name}'s organizations hold. ${shortfalls.map(shortfallInWords).join(' ')}`,
      );
    }
    const org: Organization = { id, name, synthetic: request.synthetic, role: 'transfer' };
    const tasks = await this.addedTasks(job, org, folder);
    const files = (
      await Promise.all(
        job.data.files.map(async (file) => {
          const content = await readFile(join(folder, file.name)).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          });
          return content === null ? [] : [{ name: file.name, content }];
        }),
      )
    ).flat();
    const others = [
      ...(await this.tasks(jobId, 'calibration')),
      ...(await this.tasks(jobId, 'train')),
      ...(await this.tasks(jobId, 'dev')),
    ];
    const data = await mentorDataTexts(
      job.data.files,
      taught.map((item) => orgDataDir(this.paths.jobDir(jobId), item.id)),
    );
    await this.deps.vault.addOrganization(jobId, { org, files }, tasks, others, data);
  }

  /**
   * Teaches on a never-seen organization in a new version of the field (decision 089), never in
   * place: a new job, recorded as this one's next version, whose taught organizations take the
   * moved one with its files, and whose practice and check tasks take its tasks, split in the
   * job's own proportion with families whole. Everything else is this job's: its practice, check
   * and calibration tasks, its final test without the moved organization, and every other sealed
   * organization, sealed again with prints made afresh for what the new version's teacher may
   * see (decision 082). This job, its vault, its runs and what they measured stay as they were;
   * a job that already has a newer version is taught on there instead.
   */
  async teachOn(jobId: string, orgName: string): Promise<Job> {
    const job = await this.get(jobId);
    const record = must(this.store.jobs.get(jobId), `The job "${jobId}"`);
    const newer = nextVersion(this.store, jobId);
    if (newer !== null) {
      throw new Error(
        `${job.name} already has a newer version, ${newer.name}. Teach on ${orgName} there.`,
      );
    }
    const taught = trainOrganizations(job);
    if (taught.length === 0 || !(await this.deps.vault.isSealed(jobId))) {
      throw new CodedError(
        'not_a_job',
        `${job.name} has no sealed organization to teach on. Make a field of several organizations first.`,
      );
    }
    const sealed = (await this.deps.vault.transferIdentifiers(jobId)).find(
      (org) => org.name === orgName,
    );
    if (sealed === undefined) {
      throw new Error(`${job.name} has no never-seen organization called ${orgName}.`);
    }
    const released = await this.deps.vault.releaseOrganization(jobId, sealed.id);
    const moved: Organization = { ...released.org, role: 'train' };
    const count = released.tasks.length;
    const { train, dev } = job.splits;
    const checks = Math.round((count * dev) / Math.max(1, train + dev));
    const split = this.deps.runtime.splitTasks(released.tasks, {
      seed: job.splits.seed,
      calibration: 0,
      train: count - checks,
      dev: checks,
      test: 0,
    });
    if (split.train.length + split.dev.length !== count) {
      throw new Error(`${orgName}'s tasks couldn't all be split into practice and check tasks.`);
    }
    const version = (record.versionOf?.version ?? 1) + 1;
    const base = { id: job.id.replace(/-v\d+$/, ''), name: job.name.replace(/ v\d+$/, '') };
    const next: Job = {
      ...job,
      id: await this.freshId(`${base.id}-v${version}`),
      name: `${base.name} v${version}`,
      createdAt: isoNow(this.clock),
      organizations: [...taught, moved],
      splits: { ...job.splits, train: train + split.train.length, dev: dev + split.dev.length },
    };
    return this.finalize(next, async () => {
      // The job's own folder, less its runs, its tasks and its job file, which are the new one's.
      const from = this.paths.jobDir(jobId);
      const skipped = new Set(
        ['runs', 'tasks', 'job.json', 'finalizing'].map((name) => join(from, name)),
      );
      await cp(from, this.paths.jobDir(next.id), {
        recursive: true,
        filter: (path) => !skipped.has(path),
      });
      for (const file of released.files) {
        const target = join(this.paths.orgDataDir(next.id, moved.id), file.name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
      const visible = {
        calibration: await this.tasks(jobId, 'calibration'),
        train: [...(await this.tasks(jobId, 'train')), ...split.train],
        dev: [...(await this.tasks(jobId, 'dev')), ...split.dev],
      };
      for (const [name, tasks] of Object.entries(visible)) {
        await writeJsonLines(this.paths.tasksFile(next.id, name as VisibleSplit), tasks);
      }
      const data = await mentorDataTexts(
        next.data.files,
        [...taught, moved].map((org) => this.paths.orgDataDir(next.id, org.id)),
      );
      await this.deps.vault.sealVersion(
        jobId,
        next.id,
        moved.id,
        [...visible.calibration, ...visible.train, ...visible.dev],
        data,
      );
      await writeJsonFile(this.paths.jobFile(next.id), next);
      this.record(next, record.taskCount, {
        jobId,
        version,
        org: { id: moved.id, name: moved.name },
      });
      return next;
    });
  }

  /** An added organization's tasks: its folder's `tasks.jsonl`, or a drafted field's kinds made from its files. */
  private async addedTasks(job: Job, org: Organization, folder: string): Promise<Task[]> {
    const listed = await readTasks(join(folder, 'tasks.jsonl'));
    if (listed.length > 0) {
      const tasks = listed.map((task) => ({ ...task, org: task.org ?? org.id }));
      const stranger = tasks.find((task) => task.org !== org.id);
      if (stranger !== undefined) {
        throw new Error(
          `Task "${stranger.id}" in tasks.jsonl names the organization "${stranger.org}"; every task there must be ${org.name}'s, with "org": "${org.id}" or none.`,
        );
      }
      checkTasks({ ...job, organizations: [...trainOrganizations(job), org] }, tasks);
      return tasks;
    }
    const draft = await this.drafting(job.id);
    const inputs = (draft?.source === 'generated' ? draft.types : []).flatMap((type) => {
      const info = job.taskTypes.find((item) => item.id === type.id);
      return type.spec === undefined || info === undefined
        ? []
        : [
            {
              id: info.id,
              label: info.label,
              description: info.description ?? info.label,
              spec: type.spec,
            },
          ];
    });
    if (inputs.length === 0) {
      throw new Error(
        `That folder has no tasks.jsonl, and ${job.name}'s tasks weren't made from its files, so Architect can't make ${org.name}'s. Put its tasks in a tasks.jsonl in the folder, one per line, as docs/JOB_FORMAT.md describes.`,
      );
    }
    const made = await addedOrganizationTasks(org, folder, inputs, job.requirements.passRate);
    if (made.length === 0) {
      throw new Error(
        `${org.name}'s files make no task of the kinds ${job.name} asks, so nothing would test the agent there. Check that the folder holds the same records as the others.`,
      );
    }
    return made;
  }

  async tasks(jobId: string, split: VisibleSplit): Promise<Task[]> {
    const key = `${jobId}/${split}`;
    const cached = this.taskCache.get(key);
    if (cached) return cached;
    const tasks = (await readJsonLines(this.paths.tasksFile(jobId, split))).map((line) =>
      TaskSchema.parse(line),
    );
    this.taskCache.set(key, tasks);
    return tasks;
  }

  /**
   * Splits the tasks of the organizations the job trains on and seals the test split in the
   * vault, with every task and file of the organizations it never trains on. Those are taken out
   * before splitting, so no ordinary split ever holds one. A certified job's calibration split
   * (decision 077) is drawn from the same tasks and sealed beside the test.
   */
  private async installTasks(
    job: Job,
    tasks: Task[],
    transfer: TransferOrganization[],
  ): Promise<void> {
    const sealedOrgs = new Set(transfer.map(({ org }) => org.id));
    const sealed = tasks.filter((task) => task.org !== undefined && sealedOrgs.has(task.org));
    const trained = tasks.filter((task) => task.org === undefined || !sealedOrgs.has(task.org));
    const splits = this.deps.runtime.splitTasks(trained, {
      ...job.splits,
      certify: calibrationSize(job, trained.length),
    });
    const certify = splits.certify ?? [];
    const sealedIds = new Set([...splits.test, ...certify].map((task) => task.id));
    await writeJsonLines(this.paths.tasksFile(job.id, 'calibration'), splits.calibration);
    await writeJsonLines(this.paths.tasksFile(job.id, 'train'), splits.train);
    await writeJsonLines(this.paths.tasksFile(job.id, 'dev'), splits.dev);
    const orgs = trainOrganizations(job);
    const folders =
      orgs.length === 0
        ? [this.paths.dataDir(job.id)]
        : orgs.map((org) => orgDataDir(this.paths.jobDir(job.id), org.id));
    // Each file's text, and each table's rows as the mentor is shown them, so what the mentor may
    // see of these files is left out of the fingerprint (decision 082). Only the organizations the
    // job trains on are read here: a sealed one's files stay secret and count against a leak.
    const data = await mentorDataTexts(job.data.files, folders);
    await this.deps.vault.seal(
      job.id,
      [...splits.test, ...sealed],
      trained.filter((task) => !sealedIds.has(task.id)),
      data,
      transfer,
      certify,
    );
  }

  /**
   * The id a job is made under: the one asked for when nothing is under it, else a new one. A job
   * in the library, a sealed final test and a folder in the jobs folder each take an id, the
   * folder even when no job knows it: it may hold a person's own files, which making a job must
   * not meet.
   */
  private async freshId(candidate: string): Promise<string> {
    const free =
      isSafeId(candidate) &&
      this.store.jobs.get(candidate) === null &&
      !(await this.deps.vault.isSealed(candidate)) &&
      !(await exists(this.paths.jobDir(candidate)));
    return free ? candidate : newId('job');
  }
}
