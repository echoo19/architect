import {
  AttemptSchema,
  newId,
  type SplitName,
  type StudentAdapter,
  type Task,
} from '@architect/shared';
import type { StoredAttempt, StudentTarget } from '../store/records';
import { answerSummary, expectedSummary, lockedCheck, studentPrice } from './attempts';
import type { EvaluatedTask, Evaluation, EvaluationContext } from './deps';
import { writeJsonFile } from './files';
import { runPool } from './pool';
import type { RunState } from './run-state';
import { studentEndpoint } from './setup';

export interface EvaluationSpec {
  tasks: readonly Task[];
  split: SplitName;
  round: number | null;
  version: number;
  /** Every task is attempted once under each seed; a dev evaluation has one seed per repeat. */
  seeds: readonly number[];
  target: StudentTarget;
  /** Training evaluations halt for a stop or a spent wall clock; the locked test doesn't. */
  training: boolean;
  concurrency: number;
}

/** One task under one seed: the unit an evaluation attempts and persists. */
interface SeededTask {
  task: Task;
  seed: number;
}

function keyOf(seed: number, taskId: string): string {
  return `${seed}:${taskId}`;
}

function seededTasks(spec: EvaluationSpec): SeededTask[] {
  return spec.seeds.flatMap((seed) => spec.tasks.map((task) => ({ task, seed })));
}

function shouldHalt(state: RunState, training: boolean): boolean {
  if (state.control.pauseRequested) return true;
  return training && (state.record.stopRequested || state.budget.wallClockSpent());
}

function reportProgress(state: RunState, spec: EvaluationSpec, done: ReadonlySet<string>): void {
  if (spec.split !== 'dev' && spec.split !== 'test') return;
  const filter = {
    split: spec.split,
    round: spec.round,
    version: spec.version,
    target: spec.target,
  };
  const all = seededTasks(spec);
  state.emit({
    type: 'eval.progress',
    split: spec.split,
    harnessVersion: spec.version,
    done: all.filter(({ seed, task }) => done.has(keyOf(seed, task.id))).length,
    total: all.length,
    pass: state.attempts(filter).filter((attempt) => attempt.check.pass).length,
  });
}

/**
 * Persists one attempt with its student calls, in one transaction. Locked-test attempts keep
 * no trace file, no summaries and only pass or fail with the failing field, so test prompts
 * and answers stay in the vault.
 */
async function recordAttempt(
  state: RunState,
  spec: EvaluationSpec,
  seed: number,
  item: EvaluatedTask,
  student: StudentAdapter,
): Promise<void> {
  const { store, paths, runId } = state.ctx;
  const { trace, outcome, check } = item.result;
  const id = newId('att');
  const locked = spec.split === 'test';
  const traceFile = locked ? null : paths.traceFile(state.run.jobId, runId, id);
  if (traceFile) await writeJsonFile(traceFile, trace);
  const attempt: StoredAttempt = {
    id,
    runId,
    round: spec.round,
    taskId: item.task.id,
    taskType: item.task.type,
    split: spec.split,
    harnessVersion: spec.version,
    check: locked ? lockedCheck(item.task, check) : check,
    latencyMs: trace.latencyMs,
    usage: trace.usage,
    answerSummary: locked ? undefined : answerSummary(outcome),
    expectedSummary: locked ? undefined : expectedSummary(item.task.expected),
    target: spec.target,
    seed,
    stopReason: outcome.stopReason,
    tracePath: traceFile && paths.toStored(traceFile),
    createdAt: state.now(),
  };
  const price = studentPrice(studentEndpoint(state.job, spec.target), student.isLocal);
  const run = store.transaction(() => {
    store.attempts.insert(attempt);
    for (const step of trace.steps) {
      if (step.kind !== 'model') continue;
      store.costs.insert({
        runId,
        role: 'student',
        model: trace.studentModel,
        round: spec.round,
        attemptId: id,
        usage: step.usage,
        usd: price(step.usage),
        at: attempt.createdAt,
      });
    }
    return state.writeRun((current) => ({
      totals: {
        ...current.totals,
        attempts: current.totals.attempts + 1,
        studentInputTokens: current.totals.studentInputTokens + trace.usage.inputTokens,
        studentOutputTokens: current.totals.studentOutputTokens + trace.usage.outputTokens,
      },
    }));
  });
  state.emit({
    type: 'attempt.finished',
    attempt: AttemptSchema.parse(attempt),
    prompt: locked ? undefined : item.task.prompt,
  });
  state.emit({ type: 'run.updated', run });
  state.emitBudget();
}

/**
 * One attempt at a task, or null when the wall-clock deadline cut it short: an attempt the
 * deadline cut is not scored.
 */
async function attemptTask(
  state: RunState,
  task: Task,
  context: EvaluationContext,
  options: { seed: number; signal: AbortSignal; deadline: AbortSignal | null },
): Promise<EvaluatedTask | null> {
  const { seed, signal, deadline } = options;
  const cutByDeadline = () => deadline?.aborted === true && !state.signal.aborted;
  let evaluation: Evaluation;
  try {
    evaluation = await state.ctx.deps.runtime.evaluateTasks([task], context, { seed, signal });
  } catch (error) {
    if (cutByDeadline()) return null;
    throw error;
  }
  state.signal.throwIfAborted();
  const item = evaluation.items.find((candidate) => candidate.task.id === task.id);
  if (item && item.result.outcome.stopReason !== 'aborted') return item;
  if (cutByDeadline()) return null;
  throw new Error(
    item
      ? `The runtime aborted the attempt at task ${task.id}.`
      : `The runtime returned no result for task ${task.id}.`,
  );
}

/**
 * Attempts every task of one evaluation, under each of its seeds, that has no persisted attempt
 * yet, and persists each as it finishes. Resolves true once all are done, or false when it
 * halted early (a pause, a stop or the wall clock); the next session attempts only what is
 * left. Training attempts still running when the wall clock runs out are cut there, not left
 * to finish.
 */
export async function evaluate(state: RunState, spec: EvaluationSpec): Promise<boolean> {
  const filter = {
    split: spec.split,
    round: spec.round,
    version: spec.version,
    target: spec.target,
  };
  const done = new Set(
    state.attempts(filter).map((attempt) => keyOf(attempt.seed, attempt.taskId)),
  );
  const remaining = seededTasks(spec).filter(({ seed, task }) => !done.has(keyOf(seed, task.id)));
  if (remaining.length > 0) {
    const { resources } = state;
    const student = await resources.student(spec.target);
    const context: EvaluationContext = {
      job: state.job,
      jobDir: state.jobDir,
      harness: await resources.harness(spec.version),
      student,
      sandbox: await resources.sandbox(),
      checker: await resources.checker(),
      today: state.record.today,
    };
    const deadline = spec.training ? state.budget.deadline() : null;
    const signal = deadline ? AbortSignal.any([state.signal, deadline]) : state.signal;
    const mayStart = () => !shouldHalt(state, spec.training);
    await runPool(remaining, spec.concurrency, mayStart, async ({ task, seed }) => {
      state.emit({
        type: 'attempt.started',
        taskId: task.id,
        split: spec.split,
        harnessVersion: spec.version,
      });
      const item = await attemptTask(state, task, context, { seed, signal, deadline });
      if (item === null) return;
      await recordAttempt(state, spec, seed, item, student);
      done.add(keyOf(seed, task.id));
      reportProgress(state, spec, done);
    });
  }
  return remaining.every(({ seed, task }) => done.has(keyOf(seed, task.id)));
}
