import { createMentor, createStudent } from '@architect/adapters';
import {
  applyEdits,
  blankHarness,
  diffHarness,
  harnessToFiles,
  HarnessVersions,
  importHarness,
  readGraduate,
  templateHarness,
  writeGraduate,
} from '@architect/harness';
import type { EngineHostDeps, JobDrafter, TaskChecker, ToolSandbox } from '../loop/deps';
import {
  createChecker,
  createSandbox,
  evaluateTasks,
  releaseMentor,
  splitTasks,
  todayFor,
  Vault,
  type Checker,
  type MentorReleased,
  type Sandbox,
} from '../runtime';

export interface EngineWiringOptions {
  /** The app's data folder; the vault keeps sealed test splits under it. */
  dataDir: string;
  /**
   * The built JavaScript entry of the sandbox child. Leave it out to run the TypeScript source,
   * which is what tests and developer scripts do.
   */
  sandboxEntryPath?: string;
  /** Looks up a stored secret by ref; the engine never sees where secrets are kept. */
  getSecret(ref: string): Promise<string | undefined>;
  /** The sample job shipped with the app (`job.json`, with `tasks.jsonl` and `data/` beside it). */
  sampleJobFile?: string;
  drafts?: JobDrafter;
}

/**
 * The real dependencies of the core loop: the runtime, the vault, the harness folders and the
 * model adapters. Tests build the loop with fakes instead; this is the one place they meet.
 */
export function createEngineDeps(options: EngineWiringOptions): EngineHostDeps {
  const vault = new Vault(options.dataDir);
  return {
    runtime: {
      splitTasks: (tasks, config) => splitTasks(tasks, config),
      today: (job, now) => todayFor(job, now),
      evaluateTasks: (tasks, ctx, evaluation) =>
        evaluateTasks(
          tasks,
          {
            job: ctx.job,
            jobDir: ctx.jobDir,
            harness: ctx.harness,
            student: ctx.student,
            sandbox: asSandbox(ctx.sandbox),
            checker: asChecker(ctx.checker),
            now: middayOf(ctx.today),
          },
          evaluation,
        ),
      createSandbox: () =>
        createSandbox(
          options.sandboxEntryPath === undefined ? {} : { entryPath: options.sandboxEntryPath },
        ),
      createChecker: (job, jobDir, sandbox) =>
        createChecker({ job, jobDir, sandbox: asSandbox(sandbox) }),
      // The loop has already closed its mentor gate and dropped the adapter when it gets here;
      // the runtime issues the proof the vault asks for once that has happened.
      releaseMentor: () => releaseMentor({ dispose: () => undefined }),
    },
    vault: {
      seal: (jobId, tests, others, data) => vault.seal(jobId, tests, others, data),
      isSealed: (jobId) => vault.isSealed(jobId),
      count: (jobId) => vault.count(jobId),
      leakDetector: (jobId) => vault.leakDetector(jobId),
      openForLockedTest: (jobId, proof) => vault.openForLockedTest(jobId, proof as MentorReleased),
    },
    harness: {
      versions: (dir) => new HarnessVersions(dir),
      applyEdits,
      diffHarness,
      harnessToFiles,
      blankHarness,
      templateHarness,
      importHarness,
      writeGraduate,
      readGraduate,
    },
    adapters: {
      createMentor: (config, { apiKey }) => createMentor(config, { apiKey }),
      createStudent: (endpoint, adapterOptions) => createStudent(endpoint, adapterOptions),
    },
    secrets: { get: options.getSecret },
    ...(options.sampleJobFile === undefined ? {} : { sampleJobFile: options.sampleJobFile }),
    ...(options.drafts === undefined ? {} : { drafts: options.drafts }),
  };
}

/*
 * The loop only creates sandboxes and checkers through the functions above and hands them back
 * unchanged, so these narrowings recover the runtime types it created.
 */
function asSandbox(sandbox: ToolSandbox): Sandbox {
  return sandbox as Sandbox;
}

function asChecker(checker: TaskChecker): Checker {
  return checker as Checker;
}

/** Noon UTC on a `YYYY-MM-DD` date: the same calendar day in every time zone the app runs in. */
function middayOf(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}
