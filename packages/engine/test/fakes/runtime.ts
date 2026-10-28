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
  LoopCorrectionContext,
  MentorSession,
  RuntimeDeps,
  TaskSplits,
  VaultDeps,
} from '../../src/loop/deps';
import type {
  CorrectionOptions,
  CorrectionResult,
  CorrectionStart,
} from '../../src/teaching/correction';

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
            toolCalls: [{ id: 'c1', name: 'read', arguments: { path: 'data/jobs.csv' } }],
            usage,
            latencyMs: 10,
          },
          {
            kind: 'tool',
            callId: 'c1',
            name: 'read',
            arguments: { path: 'data/jobs.csv' },
            result: '1\tid,minutes\n2\tJ-1,90',
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

/** A correction's verdict and what it did, as a test scripts it. */
export interface ScriptedCorrection {
  verified: boolean;
  reason?: string;
  /** For a checkpoint start: where it resumed; null when the replay didn't hold. */
  replayed?: { turn: number; calls: number } | null;
}

/** A verified episode: the request, then the actor's one answer, the only target. */
function correctionResult(
  task: Task,
  ctx: LoopCorrectionContext,
  start: CorrectionStart,
  scripted: ScriptedCorrection,
): CorrectionResult {
  const answer = `ANSWER: {"ok":true,"task":"${task.id}"}`;
  const messages: CorrectionResult['messages'] = [
    { role: 'system', content: ctx.harness.system },
    { role: 'user', content: task.prompt },
    { role: 'assistant', content: answer },
  ];
  const replayFailed = start.kind === 'checkpoint' && scripted.replayed === null;
  const checkpoint =
    start.kind === 'checkpoint' && !replayFailed
      ? (scripted.replayed ?? { turn: start.turn, calls: 1 })
      : null;
  const reason = scripted.reason ?? (scripted.verified ? 'The answer matches.' : 'Wrong again.');
  const usage: Usage = { inputTokens: 300, outputTokens: 20 };
  return {
    verified: scripted.verified,
    reason,
    checkpoint:
      checkpoint === null ? null : { turn: checkpoint.turn, replayedCalls: checkpoint.calls },
    check: { pass: scripted.verified, reason },
    audit: { ok: true, problems: [], changed: [] },
    messages,
    actorTurns: [2],
    tools: [],
    // A try whose replay didn't hold never ran, so it has no trace, as in the real runtime.
    trace: replayFailed
      ? null
      : {
          taskId: task.id,
          harnessVersion: ctx.harness.meta.version,
          studentModel: ctx.actor.model,
          messages,
          steps: [{ kind: 'model', text: answer, toolCalls: [], usage, latencyMs: 10 }],
          finalText: answer,
          stopReason: 'answer',
          usage,
          latencyMs: 10,
        },
  };
}

/** A runtime whose student passes a task when the harness system prompt says `fix:<type>`. */
export class FakeRuntime implements RuntimeDeps {
  /** Every correction the runtime was asked for, with where it started. */
  readonly corrections: { taskId: string; start: string; actor: string }[] = [];
  /** How a correction of a task from a start turns out; verified by default. */
  correction: (task: Task, start: CorrectionStart) => ScriptedCorrection = () => ({
    verified: true,
  });
  /** Runs before each correction; a test can make it hang, as a crash would. */
  beforeCorrection: ((task: Task, start: CorrectionStart) => Promise<void> | void) | undefined;
  /** What the actor's request holds beside the harness: the task's own prompt by default. */
  actorRequest: (task: Task) => string = (task) => task.prompt;
  /** Each attempt asks its student one turn with the task's prompt, as a real attempt would. */
  askStudent = false;
  /** Every attempt the runtime was asked for, across controllers. */
  readonly attempts: { taskId: string; version: number; seed: number }[] = [];
  /** Order of releases and test attempts, to check the mentor is gone before the test. */
  readonly sequence: string[] = [];
  readonly releases: MentorSession[] = [];
  readonly proofs = new Set<object>();
  sandboxesDisposed = 0;
  beforeAttempt: AttemptHook | undefined;
  passes: (task: Task, harness: Harness, seed: number, student: string) => boolean = (
    task,
    harness,
  ) => harness.system.includes(`fix:${task.type}`);
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
      if (this.askStudent) {
        const turn = ctx.student.chat({
          messages: [
            { role: 'system', content: ctx.harness.system },
            { role: 'user', content: task.prompt },
          ],
          tools: [],
          decoding: ctx.decoding ?? ctx.harness.decoding,
          seed: options.seed,
        });
        for await (const _event of turn) {
          // The reply doesn't decide the fake's verdict; the request is what a gate checks.
        }
      }
      this.attempts.push({
        taskId: task.id,
        version: ctx.harness.meta.version,
        seed: options.seed,
      });
      if (task.id.startsWith('test-')) this.sequence.push(`test:${task.id}`);
      const refused = ctx.harness.guardrails.refuse.some((rule) => rule.taskType === task.type);
      const pass = !refused && this.passes(task, ctx.harness, options.seed, ctx.student.model);
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

  /**
   * A correction as the test scripts it. The actor is asked for one turn first, so its gate's
   * checks and charges happen as they would for a real correction.
   */
  async correct(
    task: Task,
    ctx: LoopCorrectionContext,
    start: CorrectionStart,
    options: CorrectionOptions,
  ): Promise<CorrectionResult> {
    await this.beforeCorrection?.(task, start);
    this.corrections.push({
      taskId: task.id,
      start: start.kind === 'checkpoint' ? `turn ${start.turn}` : 'full task',
      actor: ctx.actor.model,
    });
    const stream = ctx.actor.chat(
      {
        messages: [
          { role: 'system', content: ctx.harness.system },
          { role: 'user', content: this.actorRequest(task) },
        ],
        tools: [],
        decoding: ctx.harness.decoding,
        seed: options.seed,
      },
      options.signal,
    );
    for await (const _event of stream) {
      // The turn's content doesn't matter here; asking for it is what the gate sees.
    }
    return correctionResult(task, ctx, start, this.correction(task, start));
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
