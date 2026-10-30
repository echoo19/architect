import { skillFiles } from '@architect/harness';
import type {
  CheckOutcome,
  CheckResult,
  Decoding,
  FileChange,
  Harness,
  Job,
  Score,
  StudentAdapter,
  Task,
  Trace,
  TraceStep,
  TypeScore,
} from '@architect/shared';
import { parseAnswerLine } from '../agent/answer';
import { runAgent } from '../agent/loop';
import type { Checker } from '../checker/checker';
import { openAgentFiles } from '../files/agent-files';
import { taskDataDir } from '../loop/organizations';
import type { Sandbox } from '../sandbox/types';
import { taskSeed } from './seed';

/** Everything an evaluation needs besides the tasks. */
export interface EvalContext {
  job: Job;
  /**
   * The job folder: data files live in `data/`, or in `orgs/<id>/data/` for a task of an
   * organization, and the checker path is relative to it.
   */
  jobDir: string;
  /** The sealed folders of organizations the job never trains on, for the locked test only. */
  sealedData?: Readonly<Record<string, string>>;
  harness: Harness;
  student: StudentAdapter;
  sandbox: Sandbox;
  checker: Checker;
  /** When the evaluation happens; the agent's date is `todayFor(job, now)`. Defaults to now. */
  now?: Date;
  /** Replaces the harness's decoding, as a frozen graduate's recorded decoding does. */
  decoding?: Decoding;
}

export interface TaskAttemptResult {
  trace: Trace;
  outcome: CheckOutcome;
  check: CheckResult;
  /** What the attempt wrote to its scratch copy of the files. */
  changes: FileChange[];
}

export interface AttemptOptions {
  signal?: AbortSignal;
  onStep?: (step: TraceStep) => void;
}

export interface EvaluationItem {
  task: Task;
  result: TaskAttemptResult;
}

export interface EvaluateOptions {
  /** The evaluation seed. Each task's sampler seed comes from it and the task id. */
  seed: number;
  /** Attempts in flight at once. Results come back in task order either way. Default 1. */
  concurrency?: number;
  /** Called as each attempt finishes, in the order they finish. */
  onAttempt?: (item: EvaluationItem) => void;
  onProgress?: (done: number, total: number, pass: number) => void;
  signal?: AbortSignal;
}

export interface EvaluationResult {
  items: EvaluationItem[];
  score: Score;
  perType: TypeScore[];
}

/**
 * One attempt at a task: a fresh scratch copy of the agent's files (the task's organization's
 * data, or the job's, an empty
 * output folder when the job has one, the harness's skills), the agent in task mode with the
 * given sampler seed, the ANSWER line parsed, and the attempt checked.
 */
export async function runTaskAttempt(
  task: Task,
  ctx: EvalContext & { seed: number },
  options: AttemptOptions = {},
): Promise<TaskAttemptResult> {
  const files = await openAgentFiles({
    dataDir: taskDataDir(ctx.jobDir, task, ctx.sealedData),
    files: ctx.job.data.files,
    ...(ctx.job.data.output === undefined ? {} : { output: ctx.job.data.output }),
    skills: skillFiles(ctx.harness),
    mode: 'scratch',
  });
  const run = await runAgent({
    harness: ctx.harness,
    job: ctx.job,
    student: ctx.student,
    files,
    sandbox: ctx.sandbox,
    request: task.prompt,
    mode: 'task',
    now: ctx.now,
    seed: ctx.seed,
    ...(ctx.decoding === undefined ? {} : { decoding: ctx.decoding }),
    signal: options.signal,
    onStep: options.onStep,
  });
  const trace: Trace = { ...run, taskId: task.id };
  const parsed = parseAnswerLine(trace.finalText);
  const outcome: CheckOutcome = {
    finalText: trace.finalText,
    answer: parsed.answer,
    ...(parsed.error === undefined ? {} : { answerError: parsed.error }),
    toolCalls: trace.steps.flatMap((step) =>
      step.kind === 'tool' ? [{ name: step.name, arguments: step.arguments }] : [],
    ),
    stopReason: trace.stopReason,
  };
  const check = await ctx.checker.check(task, outcome, files);
  return { trace, outcome, check, changes: trace.changes ?? [] };
}

/**
 * Attempts every task, at most `concurrency` at a time, and scores them. The whole evaluation
 * shares one date. If the signal aborts, attempts in flight stop, no unfinished attempt is
 * reported, and the promise rejects; if an attempt throws, the rest stop and it rejects with
 * that error once the attempts in flight settle.
 */
export async function evaluateTasks(
  tasks: readonly Task[],
  ctx: EvalContext,
  options: EvaluateOptions,
): Promise<EvaluationResult> {
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a whole number of at least 1.');
  }
  const { signal } = options;
  const shared = { ...ctx, now: ctx.now ?? new Date() };
  const items: (EvaluationItem | undefined)[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  let pass = 0;
  let failure: { error: unknown } | undefined;

  const work = async () => {
    while (failure === undefined && !signal?.aborted) {
      const index = next;
      next += 1;
      const task = tasks[index];
      if (task === undefined) return;
      try {
        const result = await runTaskAttempt(
          task,
          { ...shared, seed: taskSeed(options.seed, task.id) },
          { signal },
        );
        if (result.trace.stopReason === 'aborted') return;
        const item = { task, result };
        items[index] = item;
        done += 1;
        if (result.check.pass) pass += 1;
        options.onAttempt?.(item);
        options.onProgress?.(done, tasks.length, pass);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, work));
  if (failure) throw failure.error;
  signal?.throwIfAborted();

  const completed = items.filter((item): item is EvaluationItem => item !== undefined);
  return {
    items: completed,
    score: { pass, total: completed.length },
    perType: scoreByType(completed, ctx.job),
  };
}

/** Pass counts per task type, in the job's declared order, then any other types by name. */
function scoreByType(items: readonly EvaluationItem[], job: Job): TypeScore[] {
  const present = new Set(items.map((item) => item.task.type));
  const declared = job.taskTypes.map((type) => type.id).filter((type) => present.has(type));
  const others = [...present]
    .filter((type) => !declared.includes(type))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...declared, ...others].map((type) => {
    const ofType = items.filter((item) => item.task.type === type);
    return {
      type,
      pass: ofType.filter((item) => item.result.check.pass).length,
      total: ofType.length,
    };
  });
}
