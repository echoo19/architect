import type { Harness, Score, TypeScore } from '@architect/shared';
import { scoreByType } from '../mentor/view';
import type { StudentTarget } from '../store/records';
import { systemClock, type Clock, type LoopDeps } from './deps';
import type { JobLibrary } from './jobs';
import type { DataPaths } from './paths';
import { compareText, deriveSeed } from './seeds';
import { connectStudent, startingHarness } from './setup';

export interface DevNoisePilotOptions {
  jobId: string;
  /** The harness to measure; the job's starting harness when absent. */
  harness?: Harness;
  /** Student seeds, at least two different ones. Three are derived from `seed` when absent. */
  seeds?: readonly number[];
  seed?: number;
  /** Where the student runs; where the job trains by default. */
  target?: StudentTarget;
  concurrency?: number;
  /** The date tasks are evaluated against; today by default. */
  today?: string;
  signal?: AbortSignal;
}

export interface DevNoiseTask {
  taskId: string;
  taskType: string;
  /** Pass or fail under each seed, in seed order. */
  passes: boolean[];
  flipped: boolean;
}

export interface DevNoiseReport {
  jobId: string;
  harnessVersion: number;
  seeds: number[];
  runs: { seed: number; score: Score; perType: TypeScore[] }[];
  tasks: DevNoiseTask[];
  /** Dev tasks whose outcome changed between seeds. */
  flips: number;
  /** The largest gap in dev passes between two seeds: how far noise alone moves the score. */
  spread: number;
  /** The job's keep margin, `minDevGain`. */
  margin: number;
  /** True when noise alone stayed below the margin, so the margin can be trusted. */
  marginHolds: boolean;
}

export interface PilotContext {
  jobs: JobLibrary;
  paths: DataPaths;
  deps: LoopDeps;
  clock?: Clock;
}

/**
 * Evaluates one harness on dev under several student seeds and measures how far the result
 * moves on its own (decision 007). It is run before main runs to check the keep margin; it is
 * not a method and records nothing.
 */
export async function devNoisePilot(
  context: PilotContext,
  options: DevNoisePilotOptions,
): Promise<DevNoiseReport> {
  const { jobs, paths, deps } = context;
  const job = await jobs.get(options.jobId);
  const seeds = [
    ...(options.seeds ?? [1, 2, 3].map((n) => deriveSeed(options.seed ?? 0, `dev-noise-${n}`))),
  ];
  if (new Set(seeds).size < 2)
    throw new Error('The noise pilot needs at least two different seeds.');
  const dev = await jobs.tasks(job.id, 'dev');
  if (dev.length === 0) throw new Error(`"${job.name}" has no dev tasks to measure.`);

  const jobDir = paths.jobDir(job.id);
  const harness = options.harness ?? (await startingHarness(job, jobDir, deps.harness));
  const student = await connectStudent(deps, job, options.target ?? job.student.trainOn);
  const sandbox = await deps.runtime.createSandbox();
  const passes = new Map<string, boolean[]>();
  const runs: DevNoiseReport['runs'] = [];
  try {
    const checker = await deps.runtime.createChecker(job, jobDir);
    const today =
      options.today ?? deps.runtime.today(job, new Date((context.clock ?? systemClock).now()));
    for (const seed of seeds) {
      const evaluation = await deps.runtime.evaluateTasks(
        dev,
        { job, jobDir, harness, student, sandbox, checker, today },
        { seed, concurrency: options.concurrency, signal: options.signal },
      );
      const results = evaluation.items.map((item) => ({
        type: item.task.type,
        pass: item.result.check.pass,
      }));
      for (const item of evaluation.items) {
        passes.set(item.task.id, [...(passes.get(item.task.id) ?? []), item.result.check.pass]);
      }
      runs.push({
        seed,
        score: { pass: results.filter((result) => result.pass).length, total: results.length },
        perType: scoreByType(results, job),
      });
    }
  } finally {
    await sandbox.dispose();
    await student.release();
  }

  const tasks = [...dev]
    .sort((a, b) => compareText(a.id, b.id))
    .map((task) => {
      const outcomes = passes.get(task.id) ?? [];
      return {
        taskId: task.id,
        taskType: task.type,
        passes: outcomes,
        flipped: new Set(outcomes).size > 1,
      };
    });
  const scores = runs.map((run) => run.score.pass);
  const spread = Math.max(...scores) - Math.min(...scores);
  return {
    jobId: job.id,
    harnessVersion: harness.meta.version,
    seeds,
    runs,
    tasks,
    flips: tasks.filter((task) => task.flipped).length,
    spread,
    margin: job.evaluation.minDevGain,
    marginHolds: spread < job.evaluation.minDevGain,
  };
}
