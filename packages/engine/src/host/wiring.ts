import { createMentor, createStudent } from '@architect/adapters';
import {
  applyEdits,
  blankHarness,
  diffHarness,
  harnessToFiles,
  HarnessVersions,
  importHarness,
  templateHarness,
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
  /** The CPU-thread cap for students on a local runtime right now, if there is one. */
  localThreads?: () => number | undefined;
  /** How long a local student rests after each reply, as a share of its time; none if absent. */
  localCooldown?: () => number | undefined;
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
      toolLoadProblem: async (sandbox, tool) => {
        const outcome = await asSandbox(sandbox).checkTool(tool);
        if (outcome.ok) return null;
        // A sandbox that crashed says nothing about the tool, so the run stops on it instead.
        if (outcome.failure.kind === 'crashed') {
          throw new Error(
            `The tool sandbox stopped while loading a tool: ${outcome.failure.message}`,
          );
        }
        return outcome.failure.message;
      },
      // Nothing is disposed here, because nothing is left to dispose: before it asks, the loop
      // has closed its mentor gate, so no mentor call can start, and dropped its reference to
      // the adapter. All that remains is to issue the proof the vault asks for.
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
    },
    adapters: {
      createMentor: (config, { apiKey }) => createMentor(config, { apiKey }),
      createStudent: (endpoint, adapterOptions) => {
        const local = endpoint.runtime === 'ollama';
        const cpuThreads = local ? options.localThreads?.() : undefined;
        const cooldown = local ? options.localCooldown?.() : undefined;
        return createStudent(endpoint, {
          ...adapterOptions,
          ...(cpuThreads === undefined ? {} : { cpuThreads }),
          ...(cooldown === undefined ? {} : { cooldown }),
        });
      },
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
