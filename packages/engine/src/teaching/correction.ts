import { join } from 'node:path';
import { skillFiles } from '@architect/harness';
import {
  DecodingSchema,
  type ChatMessage,
  type CheckOutcome,
  type CheckResult,
  type Harness,
  type Job,
  type MutationAudit,
  type StudentAdapter,
  type Task,
  type ToolCall,
  type ToolSpec,
  type Trace,
  type TraceStep,
  type WriteRecord,
} from '@architect/shared';
import { parseAnswerLine } from '../agent/answer';
import { continueAgent, runAgent } from '../agent/loop';
import type { Checker } from '../checker/checker';
import { openAgentFiles, type AgentFiles } from '../files/agent-files';
import type { Sandbox } from '../sandbox/types';
import { createToolbox } from '../tools/toolbox';
import { auditMutations, type WriteSnapshot } from './audit';
import { rebuildCheckpoint, traceTurns } from './checkpoint';

/** Room for the mentor's own reasoning on a turn; the student's limit is far lower. */
const ACTOR_OUTPUT_TOKENS = 16_000;

/** Where a correction starts: a checkpoint inside a recorded attempt, or the whole task. */
export type CorrectionStart =
  { kind: 'checkpoint'; trace: Trace; turn: number } | { kind: 'full_task' };

export interface CorrectionContext {
  job: Job;
  jobDir: string;
  /** The harness the student had: the incumbent the failed attempt ran with. */
  harness: Harness;
  /** The mentor's model as the agent, every turn admitted through the mentor's gate. */
  actor: StudentAdapter;
  sandbox: Sandbox;
  checker: Checker;
  /** The run's working date, YYYY-MM-DD. */
  today: string;
}

export interface CorrectionOptions {
  seed: number;
  signal?: AbortSignal;
}

/** What one correction did and whether it counts as a verified lesson. */
export interface CorrectionResult {
  verified: boolean;
  /** The checker's reason for a verified one; otherwise why it was rejected. */
  reason: string;
  /** For a checkpoint start that replayed: where it resumed and how many calls it replayed. */
  checkpoint: { turn: number; replayedCalls: number } | null;
  check: CheckResult | null;
  audit: MutationAudit | null;
  /** The whole conversation: the student's prefix, then the actor's turns. */
  messages: ChatMessage[];
  /** Indices into `messages` of the actor's own assistant turns: the only training targets. */
  actorTurns: number[];
  /** The tools the agent was offered, as it saw them. */
  tools: ToolSpec[];
  /** The actor's trace, when it got to run. */
  trace: Trace | null;
}

function rejected(
  reason: string,
  partial: Partial<Omit<CorrectionResult, 'verified' | 'reason'>> = {},
): CorrectionResult {
  return {
    verified: false,
    reason,
    checkpoint: null,
    check: null,
    audit: null,
    messages: [],
    actorTurns: [],
    tools: [],
    trace: null,
    ...partial,
  };
}

/** Noon UTC on the run's date: the same day in every time zone the app runs in. */
function middayOf(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function toolCallsOf(steps: readonly TraceStep[]): ToolCall[] {
  return steps.flatMap((step) =>
    step.kind === 'tool' ? [{ id: step.callId, name: step.name, arguments: step.arguments }] : [],
  );
}

function writesOf(steps: readonly TraceStep[]): WriteRecord[] {
  return steps.flatMap((step) => (step.kind === 'tool' && step.change ? [step.change] : []));
}

/** Records the tables after each write the actor makes, with the model turn that made it. */
function snapshotter(files: AgentFiles, turnsBefore: number) {
  const snapshots: WriteSnapshot[] = [];
  let turn = turnsBefore;
  return {
    snapshots,
    onStep(step: TraceStep) {
      if (step.kind === 'model') turn += 1;
      if (step.kind === 'tool' && step.change !== undefined) {
        snapshots.push({ turn, tables: files.tables() });
      }
    },
  };
}

/** Why an actor's finished episode doesn't count, or null when it does. */
function verdict(trace: Trace, check: CheckResult, audit: MutationAudit): string | null {
  if (trace.stopReason !== 'answer') {
    const why =
      trace.error === undefined ? trace.stopReason : `${trace.stopReason}: ${trace.error}`;
    return `The correction ended before an answer (${why}).`;
  }
  if (!check.pass) return `The checker didn't pass it: ${check.reason}`;
  if (!audit.ok) return `The mutation audit refused it: ${audit.problems.join(' ')}`;
  return null;
}

/**
 * Runs one correction and verifies it. From a checkpoint, the state before the suspected turn is
 * rebuilt by replay and the actor continues it through the same tools; for the whole task, the
 * actor starts from a fresh scratch copy of the original data. Either way the actor sees only the
 * task, the harness and the conversation so far: no diagnosis, no expected values, no checker
 * text. The checker then grades the answer and the end state against the task's original data,
 * and the mutation audit checks every write along the way.
 */
export async function runCorrection(
  task: Task,
  ctx: CorrectionContext,
  start: CorrectionStart,
  options: CorrectionOptions,
): Promise<CorrectionResult> {
  const { job, harness, sandbox } = ctx;
  const decoding = DecodingSchema.parse({
    ...harness.decoding,
    maxOutputTokens: Math.max(harness.decoding.maxOutputTokens, ACTOR_OUTPUT_TOKENS),
  });
  const now = middayOf(ctx.today);

  let files: AgentFiles;
  let trace: Trace;
  let prefixLength: number;
  let prefixCalls: ToolCall[] = [];
  let prefixWrites: WriteRecord[] = [];
  let checkpoint: CorrectionResult['checkpoint'] = null;
  let snapshots: WriteSnapshot[];

  if (start.kind === 'checkpoint') {
    const rebuilt = await rebuildCheckpoint({
      trace: start.trace,
      job,
      jobDir: ctx.jobDir,
      harness,
      sandbox,
      today: ctx.today,
      turn: start.turn,
    });
    if (!rebuilt.ok) return rejected(`The replay didn't hold: ${rebuilt.reason}`);
    const point = rebuilt.checkpoint;
    files = point.files;
    checkpoint = { turn: point.turn, replayedCalls: point.replayedCalls };
    prefixLength = point.messages.length;
    prefixCalls = point.calls;
    prefixWrites = writesOf(
      traceTurns(start.trace)
        .slice(0, point.turn - 1)
        .flatMap((turn) => turn.tools),
    );
    const watch = snapshotter(files, point.turn - 1);
    snapshots = watch.snapshots;
    trace = await continueAgent({
      harness,
      job,
      student: ctx.actor,
      files,
      sandbox,
      mode: 'task',
      now,
      seed: options.seed,
      decoding,
      messages: point.messages,
      turnsTaken: point.turn - 1,
      replay: point.replay,
      startTexts: point.startTexts,
      onStep: watch.onStep,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } else {
    files = await openAgentFiles({
      dataDir: join(ctx.jobDir, 'data'),
      files: job.data.files,
      ...(job.data.output === undefined ? {} : { output: job.data.output }),
      skills: skillFiles(harness),
      mode: 'scratch',
    });
    const watch = snapshotter(files, 0);
    snapshots = watch.snapshots;
    trace = await runAgent({
      harness,
      job,
      student: ctx.actor,
      files,
      sandbox,
      request: task.prompt,
      mode: 'task',
      now,
      seed: options.seed,
      decoding,
      onStep: watch.onStep,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    // The prefix is what the actor was handed before its first turn: the system prompt and task.
    prefixLength = trace.messages.findIndex((message) => message.role === 'assistant');
    if (prefixLength < 0) prefixLength = trace.messages.length;
  }

  if (trace.stopReason === 'aborted') {
    return rejected('The correction was stopped before it finished.', { checkpoint, trace });
  }
  const tools = [...createToolbox({ harness, files, sandbox, today: ctx.today }).specs];
  const actorTurns = trace.messages.flatMap((message, index) =>
    index >= prefixLength && message.role === 'assistant' ? [index] : [],
  );
  const parsed = parseAnswerLine(trace.finalText);
  const outcome: CheckOutcome = {
    finalText: trace.finalText,
    answer: parsed.answer,
    ...(parsed.error === undefined ? {} : { answerError: parsed.error }),
    toolCalls: [...prefixCalls, ...toolCallsOf(trace.steps)].map((call) => ({
      name: call.name,
      arguments: call.arguments,
    })),
    stopReason: trace.stopReason,
  };
  const check = await ctx.checker.check(task, outcome, files);
  const audit = auditMutations({
    task,
    original: files.originalTables(),
    final: files.tables(),
    snapshots,
    writes: [...prefixWrites, ...writesOf(trace.steps)],
  });
  const problem = verdict(trace, check, audit);
  return {
    verified: problem === null,
    reason: problem ?? check.reason,
    checkpoint,
    check,
    audit,
    messages: trace.messages,
    actorTurns,
    tools,
    trace,
  };
}
