import {
  AdapterError,
  addUsage,
  emptyUsage,
  type ChatMessage,
  type Decoding,
  type Harness,
  type Job,
  type ReplaySetup,
  type StopReason,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentStreamEvent,
  type ToolCall,
  type Trace,
  type TraceStep,
  type Usage,
} from '@architect/shared';
import type { AgentFiles } from '../files/agent-files';
import type { Sandbox } from '../sandbox/types';
import type { ApproveWrite } from '../tools/builtins';
import { TOOL_RUNTIME } from '../tools/specs';
import { createToolbox } from '../tools/toolbox';
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

type Turn =
  | {
      ok: true;
      text: string;
      toolCalls: ToolCall[];
      usage: Usage;
      /** The provider's charge for the call, when it reported one. */
      costUsd?: number;
      latencyMs: number;
      finish: 'stop' | 'tool_calls' | 'length';
    }
  | { ok: false; error: string };

/** One attempt's trace as it grows: its steps, usage and clock, and how it ends. */
class TraceBuilder {
  readonly steps: TraceStep[] = [];
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
  let finalText = '';

  try {
    for (let step = at.turnsTaken; step < decoding.maxSteps; step += 1) {
      if (signal?.aborted) return trace.finish(messages, finalText, 'aborted');
      const chatRequest = { messages: [...messages], tools: [...toolbox.specs], decoding, seed };
      const turn = await askStudent(student, chatRequest, signal, options.onText);
      if (!turn.ok) {
        return signal?.aborted
          ? trace.finish(messages, finalText, 'aborted')
          : trace.finish(messages, finalText, 'error', turn.error);
      }
      trace.usage = addUsage(trace.usage, turn.usage);
      trace.record({
        kind: 'model',
        text: turn.text,
        toolCalls: turn.toolCalls,
        usage: turn.usage,
        ...(turn.costUsd === undefined ? {} : { costUsd: turn.costUsd }),
        latencyMs: turn.latencyMs,
      });
      messages.push(
        turn.toolCalls.length > 0
          ? { role: 'assistant', content: turn.text, toolCalls: turn.toolCalls }
          : { role: 'assistant', content: turn.text },
      );
      finalText = turn.text;
      if (turn.toolCalls.length === 0 && turn.finish === 'length') {
        return trace.finish(
          messages,
          finalText,
          'error',
          cutOff(decoding.maxOutputTokens, turn.text),
        );
      }
      if (turn.toolCalls.length === 0) return trace.finish(messages, finalText, 'answer');

      for (const call of turn.toolCalls) {
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

/** How often a turn is asked for again after a reply that couldn't be read. */
const UNREADABLE_RETRIES = 2;
/** How far apart the seeds of a turn and its retries are. */
const RETRY_SEED_STEP = 1_000_003;
const MAX_SEED = 2_147_483_647;

/**
 * One model turn, asked for again when the reply couldn't be read and none of it was shown: a
 * small model sometimes writes a tool call its runtime can't parse, and another sample usually
 * doesn't. Each retry's seed follows from the turn's own, so a repeated run asks the same
 * questions. After the retries, the unreadable reply ends the attempt, as before.
 */
async function askStudent(
  student: StudentAdapter,
  request: StudentChatRequest,
  signal: AbortSignal | undefined,
  onText: ((delta: string) => void) | undefined,
): Promise<Turn> {
  let shown = false;
  const show =
    onText === undefined
      ? undefined
      : (delta: string) => {
          shown = true;
          onText(delta);
        };
  for (let retry = 0; ; retry += 1) {
    const seed = retry === 0 ? request.seed : (request.seed + retry * RETRY_SEED_STEP) % MAX_SEED;
    const turn = await callStudent(student, { ...request, seed }, signal, show);
    if (turn.ok || shown || signal?.aborted || retry >= UNREADABLE_RETRIES) return turn;
  }
}

/**
 * One streamed model turn. A reply the adapter couldn't read becomes a failed turn, which counts
 * against the student. Any other adapter error means the runtime failed (server down, model
 * missing, key rejected, network), not the student, so it propagates: an evaluation stops instead
 * of scoring an outage as wrong answers. Errors thrown by `onText` belong to the caller.
 */
async function callStudent(
  student: StudentAdapter,
  request: StudentChatRequest,
  signal: AbortSignal | undefined,
  onText: ((delta: string) => void) | undefined,
): Promise<Turn> {
  const started = performance.now();
  let text = '';
  const toolCalls: ToolCall[] = [];
  let usage = emptyUsage();
  let costUsd: number | undefined;
  let finish: 'stop' | 'tool_calls' | 'length' = 'stop';
  let stream: AsyncIterator<StudentStreamEvent>;
  try {
    stream = student.chat(request, signal)[Symbol.asyncIterator]();
  } catch (error) {
    if (isRuntimeFailure(error)) throw error;
    return { ok: false, error: errorMessage(error) };
  }

  let ended = false;
  try {
    for (;;) {
      let next: IteratorResult<StudentStreamEvent>;
      try {
        next = await stream.next();
      } catch (error) {
        ended = true;
        if (isRuntimeFailure(error)) throw error;
        return { ok: false, error: errorMessage(error) };
      }
      if (next.done) {
        ended = true;
        break;
      }
      const event = next.value;
      if (event.type === 'text') {
        text += event.delta;
        onText?.(event.delta);
      } else if (event.type === 'tool_call') {
        toolCalls.push(event.call);
      } else {
        usage = event.usage;
        costUsd = event.costUsd;
        finish = event.finish;
      }
    }
  } finally {
    if (!ended) await stream.return?.();
  }
  return {
    ok: true,
    text,
    toolCalls,
    usage,
    ...(costUsd === undefined ? {} : { costUsd }),
    latencyMs: elapsedMs(started),
    finish,
  };
}

/**
 * Why a reply that hit the output-token limit ended the attempt. Reasoning counts against the
 * limit, so a long think can use all of it before the model says anything; the harness can raise
 * the limit or lower the reasoning strength.
 */
function cutOff(limit: number, text: string): string {
  const what =
    text.trim() === ''
      ? 'while the model was still thinking, before it said anything'
      : 'in the middle of its answer';
  return `The reply hit the ${limit}-token output limit ${what}. Raise max_output_tokens or lower thinking in decoding.yaml.`;
}

/** True for adapter errors caused by the model runtime rather than by what the student wrote. */
function isRuntimeFailure(error: unknown): boolean {
  return error instanceof AdapterError && error.code !== 'bad_response' && error.code !== 'aborted';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elapsedMs(since: number): number {
  return Math.max(0, Math.round(performance.now() - since));
}
