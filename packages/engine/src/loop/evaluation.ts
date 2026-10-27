import {
  AttemptSchema,
  newId,
  type SplitName,
  type StudentAdapter,
  type Task,
} from '@architect/shared';
import type { StoredAttempt, StudentTarget } from '../store/records';
import { answerSummary, expectedSummary, studentPrice } from './attempts';
import type { EvaluatedTask, EvaluationContext } from './deps';
import { writeJsonFile } from './files';
import { runPool } from './pool';
import type { RunState } from './run-state';
import { studentEndpoint } from './setup';

export interface EvaluationSpec {
  tasks: readonly Task[];
  split: SplitName;
  round: number | null;
  version: number;
  seed: number;
  target: StudentTarget;
  /** Training evaluations halt for a stop or a spent wall clock; the locked test doesn't. */
  training: boolean;
  concurrency: number;
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
  state.emit({
    type: 'eval.progress',
    split: spec.split,
    harnessVersion: spec.version,
    done: spec.tasks.filter((task) => done.has(task.id)).length,
    total: spec.tasks.length,
    pass: state.attempts(filter).filter((attempt) => attempt.check.pass).length,
  });
}

/**
 * Persists one attempt with its student calls, in one transaction. Locked-test attempts keep
 * no trace file and no summaries, so test prompts and answers stay in the vault.
 */
async function recordAttempt(
  state: RunState,
  spec: EvaluationSpec,
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
    check,
    latencyMs: trace.latencyMs,
    usage: trace.usage,
    answerSummary: locked ? undefined : answerSummary(outcome),
    expectedSummary: locked ? undefined : expectedSummary(item.task.expected),
    target: spec.target,
    seed: spec.seed,
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
 * Attempts every task of one evaluation that has no persisted attempt yet, and persists each
 * as it finishes. Resolves true once all are done, or false when it halted early (a pause, a
 * stop or the wall clock); the next session attempts only what is left.
 */
export async function evaluate(state: RunState, spec: EvaluationSpec): Promise<boolean> {
  const filter = {
    split: spec.split,
    round: spec.round,
    version: spec.version,
    target: spec.target,
  };
  const done = new Set(state.attempts(filter).map((attempt) => attempt.taskId));
  const remaining = spec.tasks.filter((task) => !done.has(task.id));
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
    const mayStart = () => !shouldHalt(state, spec.training);
    await runPool(remaining, spec.concurrency, mayStart, async (task) => {
      state.emit({
        type: 'attempt.started',
        taskId: task.id,
        split: spec.split,
        harnessVersion: spec.version,
      });
      const evaluation = await state.ctx.deps.runtime.evaluateTasks([task], context, {
        seed: spec.seed,
        signal: state.signal,
      });
      state.signal.throwIfAborted();
      const item = evaluation.items.find((candidate) => candidate.task.id === task.id);
      if (!item) throw new Error(`The runtime returned no result for task ${task.id}.`);
      if (item.result.outcome.stopReason === 'aborted') {
        throw new Error(`The runtime aborted the attempt at task ${task.id}.`);
      }
      await recordAttempt(state, spec, item, student);
      done.add(task.id);
      reportProgress(state, spec, done);
    });
  }
  return spec.tasks.every((task) => done.has(task.id));
}
