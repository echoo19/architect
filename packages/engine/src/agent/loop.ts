import {
  addUsage,
  emptyUsage,
  type ChatMessage,
  type ClearedResult,
  type Decoding,
  type Harness,
  type Job,
  type ReplaySetup,
  type StopReason,
  type StudentAdapter,
  type Trace,
  type TraceStep,
} from '@architect/shared';
import type { AgentFiles } from '../files/agent-files';
import type { Sandbox } from '../sandbox/types';
import type { ApproveWrite } from '../tools/builtins';
import { TOOL_RUNTIME } from '../tools/specs';
import { createToolbox } from '../tools/toolbox';
import { askStudent, cutOffError, isCutOff, withSpent } from './ask';
import { ContextWindow } from './context';
import { elapsedMs } from './elapsed';
import { buildSystemPrompt, type AgentMode } from './prompt';
import { matchGuardrail, selectRetrieval } from './retrieval';
import { todayFor } from './today';

/**
 * What the agent loop reads of a job: the date its records are as of, and whether it has an
 * `output/` folder. A training job is one, and so is what the workspace makes from a version's
 * contract.
 */
export interface AgentJob {
  businessDate?: Job['businessDate'];
  data: { output?: NonNullable<Job['data']['output']> };
}

export interface RunAgentOptions {
  harness: Harness;
  job: AgentJob;
  student: StudentAdapter;
  /** The agent's folder: the job's data, its output folder and the harness's skills. */
  files: AgentFiles;
  sandbox: Sandbox;
  /** The task prompt, or the user's latest chat message. */
  request: string;
  /** Earlier chat messages, oldest first. */
  history?: readonly ChatMessage[];
  mode: AgentMode;
  /**
   * When the run happens. The agent's date is `todayFor(job, now)`: the job's business date if
   * it has one, otherwise this day. Defaults to the current time.
   */
  now?: Date;
  /** Sampler seed for every student call. The runner chooses it, never the harness. */
  seed: number;
  /** Replaces the harness's decoding settings, e.g. for a fixed evaluation setup. */
  decoding?: Decoding;
  /** Called with each step as it happens. */
  onStep?: (step: TraceStep) => void;
  /** Called with the model's text as it streams. */
  onText?: (delta: string) => void;
  /**
   * Called when the turn whose text `onText` has been sending is asked for again, because its
   * reply couldn't be used. `chars` is how much text it sent for that turn, which the caller
   * should take back: the turn starts over, and its new text follows.
   */
  onRetract?: (chars: number) => void;
  /** Chat mode: asks the user before each change to a file. */
  approveWrite?: ApproveWrite;
  signal?: AbortSignal;
}

/**
 * Continues an attempt from a saved point: the conversation up to a model turn and the agent's
 * files as they stood there. The model takes the turns left under the same step limit, through
 * the same tools. The trace holds only the new steps, the whole conversation, and every file's
 * change since the attempt began.
 */
export interface ContinueAgentOptions extends Omit<RunAgentOptions, 'request' | 'history'> {
  /** The conversation so far: the system prompt, the request and the turns already taken. */
  messages: readonly ChatMessage[];
  /** Model turns already taken; they count against the step limit. */
  turnsTaken: number;
  /** What the attempt started from, as its own trace recorded it. */
  replay: ReplaySetup;
  /** Every file's text when the attempt began, so the trace's changes run from there. */
  startTexts: Readonly<Record<string, string>>;
}

/** One attempt's trace as it grows: its steps, usage and clock, and how it ends. */
class TraceBuilder {
  readonly steps: TraceStep[] = [];
  /** The tool results taken out of the model's view, oldest first. */
  readonly cleared: ClearedResult[] = [];
  usage = emptyUsage();
  private readonly started = performance.now();

  constructor(
    private readonly options: Pick<RunAgentOptions, 'harness' | 'student' | 'files' | 'onStep'>,
    private readonly replay: ReplaySetup,
    private readonly startTexts: Readonly<Record<string, string>>,
  ) {}

  record(step: TraceStep): void {
    this.steps.push(step);
    this.options.onStep?.(step);
  }

  finish(
    messages: ChatMessage[],
    finalText: string,
    stopReason: StopReason,
    error?: string,
  ): Trace {
    const { harness, student, files } = this.options;
    return {
      harnessVersion: harness.meta.version,
      studentModel: student.model,
      messages,
      steps: this.steps,
      finalText,
      stopReason,
      ...(error === undefined ? {} : { error }),
      usage: this.usage,
      latencyMs: elapsedMs(this.started),
      replay: this.replay,
      changes: files.changesSince(this.startTexts),
      ...(this.cleared.length === 0 ? {} : { cleared: this.cleared }),
    };
  }
}

/**
 * Runs the student on one request inside a harness: refuses guarded requests without calling the
 * model, then alternates model turns and tool calls until a turn makes no tool calls or the step
 * limit is reached. Model mistakes become tool errors the model can read, and a failing or
 * aborted model call ends the trace with that stop reason; neither throws. The trace records
 * what the attempt started from and every file it changed, so it can be replayed.
 */
export async function runAgent(options: RunAgentOptions): Promise<Trace> {
  const { harness, job, files, request, mode, seed } = options;
  const today = todayFor(job, options.now ?? new Date());
  const decoding = options.decoding ?? harness.decoding;
  const startTexts = files.texts();
  const replay: ReplaySetup = {
    data: files.dataHashes(),
    harnessHash: harness.meta.hash,
    toolRuntime: TOOL_RUNTIME,
    seed,
    decoding,
    today,
  };
  const history = options.history ?? [];
  const trace = new TraceBuilder(options, replay, startTexts);

  const refusal = matchGuardrail(harness, request);
  if (refusal) {
    trace.record({ kind: 'refusal', taskType: refusal.taskType, reason: refusal.reason });
    const text = `I can't help with ${refusal.taskType} requests. ${refusal.reason}`;
    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: request },
      { role: 'assistant', content: text },
    ];
    return trace.finish(messages, text, 'refused');
  }

  const retrieved = selectRetrieval(harness, request);
  for (const skill of retrieved.skills) {
    trace.record({ kind: 'skill', slug: skill.name, via: 'rule' });
  }
  const system = buildSystemPrompt({
    harness,
    folder: {
      files: files.list(),
      ...(job.data.output === undefined ? {} : { output: job.data.output }),
    },
    mode,
    today,
    loadedSkills: retrieved.skills,
    examples: retrieved.examples,
  });
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: request },
  ];
  return takeTurns(options, trace, messages, { today, decoding, turnsTaken: 0 });
}

/**
 * Continues an attempt from a message prefix and the files as they stand, with the turns its
 * step limit has left. Nothing is refused or retrieved again: the prefix already holds the
 * system prompt the attempt began with.
 */
export async function continueAgent(options: ContinueAgentOptions): Promise<Trace> {
  const today = todayFor(options.job, options.now ?? new Date());
  const decoding = options.decoding ?? options.harness.decoding;
  const trace = new TraceBuilder(options, options.replay, options.startTexts);
  return takeTurns(options, trace, [...options.messages], {
    today,
    decoding,
    turnsTaken: options.turnsTaken,
  });
}

/** Alternates model turns and tool calls until a turn calls no tool or the step limit is reached. */
async function takeTurns(
  options: Omit<RunAgentOptions, 'request' | 'history'>,
  trace: TraceBuilder,
  messages: ChatMessage[],
  at: { today: string; decoding: Decoding; turnsTaken: number },
): Promise<Trace> {
  const { harness, student, files, sandbox, seed, signal } = options;
  const { today, decoding } = at;
  const toolbox = createToolbox({
    harness,
    files,
    sandbox,
    today,
    approveWrite: options.approveWrite,
  });
  const tools = [...toolbox.specs];
  // Every prompt stays inside the student's context, on every backend (decision 057).
  const window =
    student.contextLength === null
      ? null
      : new ContextWindow(student.contextLength, decoding.maxOutputTokens, tools);
  let finalText = '';

  try {
    for (let step = at.turnsTaken; step < decoding.maxSteps; step += 1) {
      if (signal?.aborted) return trace.finish(messages, finalText, 'aborted');
      const asked = await askStudent({
        student,
        messages,
        tools,
        decoding,
        seed,
        window,
        turn: step + 1,
        signal,
        onText: options.onText,
        onRetract: options.onRetract,
        onCleared: (cleared) => trace.cleared.push(...cleared),
      });
      if (!asked.ok) {
        // Replies asked for again and thrown away were paid for all the same.
        if (asked.spent.replies > 0) trace.usage = addUsage(trace.usage, asked.spent.usage);
        return signal?.aborted
          ? trace.finish(messages, finalText, 'aborted')
          : trace.finish(messages, finalText, 'error', asked.error);
      }
      const { reply } = asked;
      const spent = withSpent(reply, asked.spent);
      trace.usage = addUsage(trace.usage, spent.usage);
      trace.record({
        kind: 'model',
        text: reply.text,
        toolCalls: reply.toolCalls,
        usage: spent.usage,
        ...(spent.costUsd === undefined ? {} : { costUsd: spent.costUsd }),
        latencyMs: reply.latencyMs,
      });
      messages.push(
        reply.toolCalls.length > 0
          ? { role: 'assistant', content: reply.text, toolCalls: reply.toolCalls }
          : { role: 'assistant', content: reply.text },
      );
      window?.learn(messages, reply.usage, true);
      finalText = reply.text;
      if (isCutOff(reply)) {
        const limits = {
          maxOutputTokens: decoding.maxOutputTokens,
          contextLength: student.contextLength,
        };
        return trace.finish(messages, finalText, 'error', cutOffError(reply, limits, asked.tries));
      }
      if (reply.toolCalls.length === 0) return trace.finish(messages, finalText, 'answer');

      for (const call of reply.toolCalls) {
        const toolStarted = performance.now();
        const outcome = await toolbox.run(call, signal);
        trace.record({
          kind: 'tool',
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
          result: outcome.result,
          ...(outcome.error === undefined ? {} : { error: outcome.error }),
          latencyMs: elapsedMs(toolStarted),
          ...(outcome.change === undefined ? {} : { change: outcome.change }),
          ...(outcome.table === undefined ? {} : { table: outcome.table }),
        });
        if (outcome.loadedSkill !== undefined) {
          trace.record({ kind: 'skill', slug: outcome.loadedSkill, via: 'tool' });
        }
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: outcome.content,
        });
        if (signal?.aborted) return trace.finish(messages, finalText, 'aborted');
      }
    }
  } catch (error) {
    // Waiting on a tool (such as a write approval) ends by throwing when the run is aborted.
    if (signal?.aborted) return trace.finish(messages, finalText, 'aborted');
    throw error;
  }
  return trace.finish(messages, finalText, 'max_steps');
}
