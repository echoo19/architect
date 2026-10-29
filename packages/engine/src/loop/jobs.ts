import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import {
  CodedError,
  DraftRecordSchema,
  JobSchema,
  newId,
  TaskSchema,
  type DraftRecord,
  type Job,
  type JobSummary,
  type Task,
  type TaskPlan,
} from '@architect/shared';
import { z } from 'zod';
import { buildTaskPlan } from '../drafting/plan';
import { ContractBook } from '../graduates/contracts';
import type { EngineStore } from '../store/engine-store';
import type { StoredRun } from '../store/records';
import type { Clock, LoopDeps } from './deps';
import { readJsonFile, readJsonLines, writeJsonFile, writeJsonLines } from './files';
import { isSafeId, type DataPaths, type VisibleSplit } from './paths';
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

async function copyInto(from: string, to: string, missing: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await copyFile(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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

  constructor(
    private readonly store: EngineStore,
    private readonly paths: DataPaths,
    private readonly deps: Pick<LoopDeps, 'runtime' | 'vault'>,
    private readonly clock: Clock,
    private readonly contracts: ContractBook = new ContractBook(store, clock),
  ) {}

  summaries(): JobSummary[] {
    return this.store.jobs.list().map((record) => {
      const latest = this.store.runs.list(record.id)[0]?.run;
      return {
        id: record.id,
        name: record.name,
        summary: record.summary,
        createdAt: record.createdAt,
        taskCount: record.taskCount,
        latestRun: latest && {
          id: latest.id,
          status: latest.status,
          phase: latest.phase,
          method: latest.method,
          devCurrent: latest.devCurrent,
          devBaseline: latest.devBaseline,
        },
      };
    });
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
   * once and the test split is sealed in the vault.
   */
  async importFile(file: string): Promise<Job> {
    const source = dirname(resolve(file));
    const parsed = await readJobFile(file);
    const job: Job = { ...parsed, id: await this.freshId(parsed.id) };
    const tasks = await readTasks(join(source, 'tasks.jsonl'));
    checkTasks(job, tasks);

    for (const data of job.data.files) {
      await copyInto(
        join(source, 'data', data.name),
        join(this.paths.dataDir(job.id), data.name),
        `The data file "${data.name}" is missing; it belongs in a data folder next to the job file.`,
      );
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
    if (tasks.length > 0) await this.installTasks(job, tasks);

    await writeJsonFile(this.paths.jobFile(job.id), job);
    this.record(job, tasks.length);
    return job;
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
    checkTasks(job, tasks);
    this.deps.runtime.splitTasks(tasks, job.splits);
    const folder = this.paths.jobDir(job.id);
    try {
      for (const file of input.files) {
        const target = join(this.paths.dataDir(job.id), file.name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
      await writeJsonFile(this.paths.draftingFile(job.id), DraftRecordSchema.parse(input.drafting));
      await writeJsonFile(this.paths.jobFile(job.id), job);
      await this.installTasks(job, tasks);
    } catch (error) {
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
    this.record(job, tasks.length);
    return job;
  }

  /** What drafting a job left beside it, or null for a job whose tasks came with it. */
  async drafting(jobId: string): Promise<DraftRecord | null> {
    let stored: unknown;
    try {
      stored = await readJsonFile(this.paths.draftingFile(jobId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return DraftRecordSchema.parse(stored);
  }

  /**
   * What a job's tasks are: where they came from, the rule behind each type, a few examples with
   * their expected answers, and how many sit in each set. The examples come from the practice and
   * starting sets; the final test is only counted.
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
    return buildTaskPlan({
      job,
      draft: await this.drafting(jobId),
      visible: { calibration, train, dev },
      sealed,
    });
  }

  private record(job: Job, taskCount: number): void {
    this.store.transaction(() => {
      this.store.jobs.insert({
        id: job.id,
        name: job.name,
        summary: job.summary,
        path: this.paths.toStored(this.paths.jobDir(job.id)),
        taskCount,
        createdAt: job.createdAt,
        updatedAt: isoNow(this.clock),
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

  private async installTasks(job: Job, tasks: Task[]): Promise<void> {
    const splits = this.deps.runtime.splitTasks(tasks, job.splits);
    await writeJsonLines(this.paths.tasksFile(job.id, 'calibration'), splits.calibration);
    await writeJsonLines(this.paths.tasksFile(job.id, 'train'), splits.train);
    await writeJsonLines(this.paths.tasksFile(job.id, 'dev'), splits.dev);
    const testIds = new Set(splits.test.map((task) => task.id));
    const data = await Promise.all(
      job.data.files.map((file) => readFile(join(this.paths.dataDir(job.id), file.name), 'utf8')),
    );
    await this.deps.vault.seal(
      job.id,
      splits.test,
      tasks.filter((task) => !testIds.has(task.id)),
      data,
    );
  }

  private async freshId(candidate: string): Promise<string> {
    const free =
      isSafeId(candidate) &&
      this.store.jobs.get(candidate) === null &&
      !(await this.deps.vault.isSealed(candidate));
    return free ? candidate : newId('job');
  }
}
