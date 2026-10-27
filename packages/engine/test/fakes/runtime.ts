import {
  GuardError,
  type CheckResult,
  type Harness,
  type HarnessTool,
  type Job,
  type Task,
  type Trace,
  type Usage,
} from '@architect/shared';
import type {
  Evaluation,
  EvaluationContext,
  EvaluationOptions,
  MentorSession,
  RuntimeDeps,
  TaskSplits,
  VaultDeps,
} from '../../src/loop/deps';

export type AttemptHook = (
  task: Task,
  ctx: EvaluationContext,
  options: EvaluationOptions,
) => Promise<void> | void;

/** One second per unit of the task's number, so test latencies are known in advance. */
export function latencyOf(task: Task): number {
  return 1000 * Number(task.id.split('-').pop());
}

function fakeTrace(task: Task, ctx: EvaluationContext, pass: boolean, refused: boolean): Trace {
  const usage: Usage = { inputTokens: 50, outputTokens: 10 };
  const answer = `ANSWER: ${JSON.stringify({ ok: pass })}`;
  return {
    taskId: task.id,
    harnessVersion: ctx.harness.meta.version,
    studentModel: ctx.student.model,
    messages: [{ role: 'user', content: task.prompt }],
    steps: refused
      ? [{ kind: 'refusal', taskType: task.type, reason: 'Refused by a guardrail.' }]
      : [
          {
            kind: 'model',
            text: 'Reading the jobs table first.',
            toolCalls: [{ id: 'c1', name: 'read_table', arguments: { name: 'jobs.csv' } }],
            usage,
            latencyMs: 10,
          },
          {
            kind: 'tool',
            callId: 'c1',
            name: 'read_table',
            arguments: { name: 'jobs.csv' },
            result: [{ id: 'J-1', minutes: 90 }],
            latencyMs: 1,
          },
          { kind: 'model', text: answer, toolCalls: [], usage, latencyMs: 10 },
        ],
    finalText: refused ? 'I can’t help with that here.' : answer,
    stopReason: refused ? 'refused' : 'answer',
    usage: { inputTokens: 100, outputTokens: 20 },
    latencyMs: latencyOf(task),
  };
}

/** A runtime whose student passes a task when the harness system prompt says `fix:<type>`. */
export class FakeRuntime implements RuntimeDeps {
  /** Every attempt the runtime was asked for, across controllers. */
  readonly attempts: { taskId: string; version: number; seed: number }[] = [];
  /** Order of releases and test attempts, to check the mentor is gone before the test. */
  readonly sequence: string[] = [];
  readonly releases: MentorSession[] = [];
  readonly proofs = new Set<object>();
  sandboxesDisposed = 0;
  beforeAttempt: AttemptHook | undefined;
  passes: (task: Task, harness: Harness, seed: number) => boolean = (task, harness) =>
    harness.system.includes(`fix:${task.type}`);
  /** The check a failed attempt gets; a test can make it carry values and details. */
  failedCheck: (task: Task) => CheckResult = (task) => ({
    pass: false,
    reason: `The ${task.type} answer is wrong.`,
  });

  splitTasks(tasks: Task[]): TaskSplits {
    const of = (prefix: string) => tasks.filter((task) => task.id.startsWith(prefix));
    return { calibration: of('cal-'), train: of('train-'), dev: of('dev-'), test: of('test-') };
  }

  today(job: Job, now: Date): string {
    return job.businessDate ?? now.toISOString().slice(0, 10);
  }

  async evaluateTasks(
    tasks: Task[],
    ctx: EvaluationContext,
    options: EvaluationOptions,
  ): Promise<Evaluation> {
    const items: Evaluation['items'] = [];
    for (const task of tasks) {
      await this.beforeAttempt?.(task, ctx, options);
      options.signal?.throwIfAborted();
      this.attempts.push({
        taskId: task.id,
        version: ctx.harness.meta.version,
        seed: options.seed,
      });
      if (task.id.startsWith('test-')) this.sequence.push(`test:${task.id}`);
      const refused = ctx.harness.guardrails.refuse.some((rule) => rule.taskType === task.type);
      const pass = !refused && this.passes(task, ctx.harness, options.seed);
      const trace = fakeTrace(task, ctx, pass, refused);
      items.push({
        task,
        result: {
          trace,
          outcome: {
            finalText: trace.finalText,
            answer: refused ? null : { ok: pass },
            toolCalls: [],
            stopReason: trace.stopReason,
          },
          check: pass ? { pass, reason: 'The answer matches.' } : this.failedCheck(task),
        },
      });
    }
    const pass = items.filter((item) => item.result.check.pass).length;
    return { items, score: { pass, total: items.length }, perType: [] };
  }

  createSandbox() {
    return { dispose: () => void (this.sandboxesDisposed += 1) };
  }

  /** A tool doesn't load when its code says so, the way a real syntax error would. */
  async toolLoadProblem(_sandbox: unknown, tool: HarnessTool) {
    return tool.code.includes('does not parse') ? "SyntaxError: expecting ';'" : null;
  }

  createChecker() {
    return { kind: 'fake checker' };
  }

  async releaseMentor(session: MentorSession) {
    this.releases.push(session);
    this.sequence.push(`release:${session.runId}`);
    const proof = { releasedRun: session.runId };
    this.proofs.add(proof);
    return proof;
  }
}

/** Holds test tasks in memory and opens them only for a proof the runtime handed out. */
export class FakeVault implements VaultDeps {
  private readonly sealed = new Map<string, Task[]>();
  readonly opened: string[] = [];

  constructor(private readonly runtime: FakeRuntime) {}

  seal(jobId: string, tests: Task[]): void {
    if (this.sealed.has(jobId)) throw new Error(`${jobId} is already sealed.`);
    this.sealed.set(jobId, structuredClone(tests));
  }

  isSealed(jobId: string): boolean {
    return this.sealed.has(jobId);
  }

  count(jobId: string): number {
    return this.sealed.get(jobId)?.length ?? 0;
  }

  leakDetector(jobId: string) {
    const tests = this.sealed.get(jobId) ?? [];
    return {
      scan: (text: string) => {
        const matchedIds = tests
          .filter((task) => text.includes(task.prompt))
          .map((task) => task.id);
        return { leaked: matchedIds.length > 0, matchedIds };
      },
    };
  }

  openForLockedTest(jobId: string, proof: unknown): Task[] {
    if (typeof proof !== 'object' || proof === null || !this.runtime.proofs.has(proof)) {
      throw new GuardError('split', 'The locked test opens only after the mentor is released.');
    }
    this.opened.push(jobId);
    return structuredClone(this.sealed.get(jobId) ?? []);
  }
}
