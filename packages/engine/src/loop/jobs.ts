import { copyFile, cp, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import {
  JobSchema,
  newId,
  TaskSchema,
  type Job,
  type JobSummary,
  type Task,
} from '@architect/shared';
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
    if (!this.store.jobs.get(jobId)) throw new Error(`There is no job "${jobId}".`);
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
   * measured against them, stay as they were.
   */
  async save(job: Job): Promise<Job> {
    const parsed = JobSchema.parse(job);
    if (!isSafeId(parsed.id)) throw new Error(`"${parsed.id}" isn't a valid job id.`);
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
    const parsed = JobSchema.parse(await readJsonFile(file));
    const job: Job = { ...parsed, id: await this.freshId(parsed.id) };
    const tasks = (await readJsonLines(join(source, 'tasks.jsonl'))).map((line) =>
      TaskSchema.parse(line),
    );
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
    this.store.transaction(() => {
      this.store.jobs.insert({
        id: job.id,
        name: job.name,
        summary: job.summary,
        path: this.paths.toStored(this.paths.jobDir(job.id)),
        taskCount: tasks.length,
        createdAt: job.createdAt,
        updatedAt: isoNow(this.clock),
      });
      this.contracts.ensure(job);
    });
    return job;
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
