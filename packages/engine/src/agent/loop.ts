import {
  addUsage,
  emptyUsage,
  type ChatMessage,
  type Decoding,
  type Harness,
  type Job,
  type StopReason,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentStreamEvent,
  type ToolCall,
  type Trace,
  type TraceStep,
  type Usage,
} from '@architect/shared';
import type { TableStore } from '../data/table-store';
import type { Sandbox } from '../sandbox/types';
import type { ApproveWrite } from '../tools/builtins';
import { createToolbox } from '../tools/toolbox';
import { buildSystemPrompt, type AgentMode } from './prompt';
import { matchGuardrail, selectRetrieval } from './retrieval';

export interface RunAgentOptions {
  harness: Harness;
  job: Job;
  student: StudentAdapter;
  store: TableStore;
  sandbox: Sandbox;
  /** The task prompt, or the user's latest chat message. */
  request: string;
  /** Earlier chat messages, oldest first. */
  history?: readonly ChatMessage[];
  mode: AgentMode;
  /** The working date, as YYYY-MM-DD. */
  today: string;
  /** Sampler seed for every student call. The runner chooses it, never the harness. */
  seed: number;
  /** Replaces the harness's decoding settings, e.g. for a fixed evaluation setup. */
  decoding?: Decoding;
  /** Called with each step as it happens. */
  onStep?: (step: TraceStep) => void;
  /** Called with the model's text as it streams. */
  onText?: (delta: string) => void;
  /** Chat mode: asks the user before each write. */
  approveWrite?: ApproveWrite;
  signal?: AbortSignal;
}

type Turn =
  | { ok: true; text: string; toolCalls: ToolCall[]; usage: Usage; latencyMs: number }
  | { ok: false; error: string };

/**
 * Runs the student on one request inside a harness: refuses guarded requests without calling the
 * model, then alternates model turns and tool calls until a turn makes no tool calls or the step
 * limit is reached. Model mistakes become tool errors the model can read, and a failing or
 * aborted model call ends the trace with that stop reason; neither throws.
 */
export async function runAgent(options: RunAgentOptions): Promise<Trace> {
  const { harness, job, student, store, sandbox, request, mode, today, seed, signal } = options;
  const started = performance.now();
  const history = options.history ?? [];
  const steps: TraceStep[] = [];
  let usage = emptyUsage();

  const record = (step: TraceStep) => {
    steps.push(step);
    options.onStep?.(step);
  };
  const finish = (
    messages: ChatMessage[],
    finalText: string,
    stopReason: StopReason,
    error?: string,
  ): Trace => ({
    harnessVersion: harness.meta.version,
    studentModel: student.model,
    messages,
    steps,
    finalText,
    stopReason,
    ...(error === undefined ? {} : { error }),
    usage,
    latencyMs: elapsedMs(started),
  });

  const refusal = matchGuardrail(harness, request);
  if (refusal) {
    record({ kind: 'refusal', taskType: refusal.taskType, reason: refusal.reason });
    const text = `I can't help with ${refusal.taskType} requests. ${refusal.reason}`;
    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: request },
      { role: 'assistant', content: text },
    ];
    return finish(messages, text, 'refused');
  }

  const retrieved = selectRetrieval(harness, request);
  for (const skill of retrieved.skills) record({ kind: 'skill', slug: skill.slug, via: 'rule' });
  const system = buildSystemPrompt({
    harness,
    job,
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
  const toolbox = createToolbox({ harness, store, sandbox, approveWrite: options.approveWrite });
  const decoding = options.decoding ?? harness.decoding;
  let finalText = '';

  try {
    for (let step = 0; step < decoding.maxSteps; step += 1) {
      if (signal?.aborted) return finish(messages, finalText, 'aborted');
      const chatRequest = { messages: [...messages], tools: [...toolbox.specs], decoding, seed };
      const turn = await callStudent(student, chatRequest, signal, options.onText);
      if (!turn.ok) {
        return signal?.aborted
          ? finish(messages, finalText, 'aborted')
          : finish(messages, finalText, 'error', turn.error);
      }
      usage = addUsage(usage, turn.usage);
      record({
        kind: 'model',
        text: turn.text,
        toolCalls: turn.toolCalls,
        usage: turn.usage,
        latencyMs: turn.latencyMs,
      });
      messages.push(
        turn.toolCalls.length > 0
          ? { role: 'assistant', content: turn.text, toolCalls: turn.toolCalls }
          : { role: 'assistant', content: turn.text },
      );
      finalText = turn.text;
      if (turn.toolCalls.length === 0) return finish(messages, finalText, 'answer');

      for (const call of turn.toolCalls) {
        const toolStarted = performance.now();
        const outcome = await toolbox.run(call, signal);
        record({
          kind: 'tool',
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
          result: outcome.result,
          ...(outcome.error === undefined ? {} : { error: outcome.error }),
          latencyMs: elapsedMs(toolStarted),
        });
        if (outcome.loadedSkill !== undefined) {
          record({ kind: 'skill', slug: outcome.loadedSkill, via: 'tool' });
        }
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: outcome.content,
        });
        if (signal?.aborted) return finish(messages, finalText, 'aborted');
      }
    }
  } catch (error) {
    // Waiting on a tool (such as a write approval) ends by throwing when the run is aborted.
    if (signal?.aborted) return finish(messages, finalText, 'aborted');
    throw error;
  }
  return finish(messages, finalText, 'max_steps');
}

/**
 * One streamed model turn. Errors from the adapter become a failed turn; errors thrown by
 * `onText` belong to the caller and propagate.
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
  let stream: AsyncIterator<StudentStreamEvent>;
  try {
    stream = student.chat(request, signal)[Symbol.asyncIterator]();
  } catch (error) {
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
      }
    }
  } finally {
    if (!ended) await stream.return?.();
  }
  return { ok: true, text, toolCalls, usage, latencyMs: elapsedMs(started) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elapsedMs(since: number): number {
  return Math.max(0, Math.round(performance.now() - since));
}
