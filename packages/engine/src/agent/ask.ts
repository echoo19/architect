import {
  AdapterError,
  addUsage,
  emptyUsage,
  type ChatMessage,
  type ClearedResult,
  type Decoding,
  type StudentAdapter,
  type StudentStreamEvent,
  type ToolCall,
  type ToolSpec,
  type Usage,
} from '@architect/shared';
import { noRoomError, type ContextWindow } from './context';
import { elapsedMs } from './elapsed';

/** How often a turn is asked for again after a reply that couldn't be used. */
const RETRIES = 2;
/** How far apart the seeds of a turn and its retries are. */
const RETRY_SEED_STEP = 1_000_003;
const MAX_SEED = 2_147_483_647;
/** A reply that ended this close to the end of the context ran out of room, not of output. */
const CONTEXT_FULL_SLACK = 16;

/** One model reply, whole. */
export interface Reply {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  /** The provider's charge for the call, when it reported one. */
  costUsd?: number;
  latencyMs: number;
  finish: 'stop' | 'tool_calls' | 'length';
}

type Turn = { ok: true; reply: Reply } | { ok: false; error: string };

/**
 * A reply that stopped at its length limit before it made a call: cut off partway, not a call the
 * runtime couldn't read. (One cut in the middle of a call comes back from the adapter the same
 * way, without the call.)
 */
export function isCutOff(reply: Reply): boolean {
  return reply.finish === 'length' && reply.toolCalls.length === 0;
}

/** What the replies thrown away cost: they were paid for, whether or not they were used. */
export class Spent {
  usage = emptyUsage();
  /** How many replies were thrown away. */
  replies = 0;
  private billed = 0;
  private unbilled = false;

  add(reply: Reply): void {
    this.usage = addUsage(this.usage, reply.usage);
    this.replies += 1;
    if (reply.costUsd === undefined) this.unbilled = true;
    else this.billed += reply.costUsd;
  }

  /** What the provider billed for them, when it billed every one. */
  get costUsd(): number | undefined {
    return this.unbilled ? undefined : this.billed;
  }
}

/** A reply's usage and charge together with those of the replies thrown away before it. */
export function withSpent(reply: Reply, spent: Spent): { usage: Usage; costUsd?: number } {
  if (spent.replies === 0) {
    return {
      usage: reply.usage,
      ...(reply.costUsd === undefined ? {} : { costUsd: reply.costUsd }),
    };
  }
  const costUsd =
    reply.costUsd === undefined || spent.costUsd === undefined
      ? undefined
      : reply.costUsd + spent.costUsd;
  return {
    usage: addUsage(reply.usage, spent.usage),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

export type Asked =
  /** A reply to keep. A cut-off one is kept when the turn was asked as often as it may be. */
  | { ok: true; reply: Reply; spent: Spent; tries: number }
  /** No reply: it couldn't be read, there was no room to send the prompt, or the run was stopped. */
  | { ok: false; error: string; spent: Spent };

export interface AskInput {
  student: StudentAdapter;
  /** The whole conversation so far. It is read, never changed. */
  messages: readonly ChatMessage[];
  tools: ToolSpec[];
  decoding: Decoding;
  seed: number;
  /** Keeps the prompt inside the student's context; null when the student's context isn't limited. */
  window: ContextWindow | null;
  /** The model turn, counting from 1. */
  turn: number;
  signal: AbortSignal | undefined;
  /** The model's text as it streams. */
  onText: ((delta: string) => void) | undefined;
  /** Text already sent through `onText` is taken back: the turn is asked again, and starts over. */
  onRetract: ((chars: number) => void) | undefined;
  /** Tool results taken out of the prompt to make room for it. */
  onCleared: ((cleared: ClearedResult[]) => void) | undefined;
}

/**
 * One model turn, asked for again when its reply can't be used: a small model sometimes writes a
 * tool call its runtime can't parse, and another sample usually doesn't, and a reply cut off at
 * its length limit may have been short of room. At most twice, each time with a seed that follows
 * from the turn's own, so a repeated run asks the same questions. Text already shown for a reply
 * that is asked for again is taken back through `onRetract` first. After a cut-off the prompt is
 * sized again with the reply's room made larger, from the size the cut-off call reported. The
 * last reply is returned as it came, so it ends the attempt with its own error.
 */
export async function askStudent(input: AskInput): Promise<Asked> {
  const { student, messages, window, signal } = input;
  const spent = new Spent();
  let afterCutOff = false;
  for (let retry = 0; ; retry += 1) {
    let prompt = messages;
    if (window !== null) {
      const fit = window.fit(messages, input.turn, afterCutOff);
      if (fit.cleared.length > 0) input.onCleared?.(fit.cleared);
      if (!fit.fits) return { ok: false, error: noRoomError(fit), spent };
      prompt = fit.messages;
    }
    const seed = retry === 0 ? input.seed : (input.seed + retry * RETRY_SEED_STEP) % MAX_SEED;
    let shown = 0;
    const show =
      input.onText === undefined
        ? undefined
        : (delta: string) => {
            shown += delta.length;
            input.onText?.(delta);
          };
    const request = { messages: [...prompt], tools: input.tools, decoding: input.decoding, seed };
    const turn = await callStudent(student, request, signal, show);

    const last = retry >= RETRIES || signal?.aborted === true;
    if (!turn.ok) {
      if (last) return { ok: false, error: turn.error, spent };
    } else if (!isCutOff(turn.reply)) {
      return { ok: true, reply: turn.reply, spent, tries: retry + 1 };
    } else {
      window?.learn(messages, turn.reply.usage, false);
      if (last) return { ok: true, reply: turn.reply, spent, tries: retry + 1 };
      spent.add(turn.reply);
      afterCutOff = true;
    }
    if (shown > 0) input.onRetract?.(shown);
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
  request: Parameters<StudentAdapter['chat']>[0],
  signal: AbortSignal | undefined,
  onText: ((delta: string) => void) | undefined,
): Promise<Turn> {
  const started = performance.now();
  let text = '';
  const toolCalls: ToolCall[] = [];
  let usage = emptyUsage();
  let costUsd: number | undefined;
  let finish: Reply['finish'] = 'stop';
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
    reply: {
      text,
      toolCalls,
      usage,
      ...(costUsd === undefined ? {} : { costUsd }),
      latencyMs: elapsedMs(started),
      finish,
    },
  };
}

/**
 * Why an attempt ends on a reply that was cut off every time it was asked for. Reasoning counts
 * against the output limit, so a long think can use all of it before the model says anything; the
 * harness can raise the limit or lower the reasoning strength. A reply that ended at the end of
 * the context ran out of room instead, and only a larger context or a shorter prompt helps.
 */
export function cutOffError(
  reply: Reply,
  limits: { maxOutputTokens: number; contextLength: number | null },
  tries: number,
): string {
  const where =
    reply.text.trim() === ''
      ? 'while the model was still thinking, before it said anything'
      : 'in the middle of its answer';
  const times = tries > 1 ? `, ${tries} times in a row` : '';
  const { contextLength } = limits;
  const total = reply.usage.inputTokens + reply.usage.outputTokens;
  if (contextLength !== null && total >= contextLength - CONTEXT_FULL_SLACK) {
    return (
      `The model's reply was cut off when its context of ${contextLength.toLocaleString('en-US')} tokens filled up ${where}${times}. ` +
      "Use a model with a larger context, or shorten the agent's instructions."
    );
  }
  return `The model's reply was cut off at the ${limits.maxOutputTokens}-token output limit ${where}${times}. Raise max_output_tokens or lower thinking in decoding.yaml.`;
}

/** True for adapter errors caused by the model runtime rather than by what the student wrote. */
function isRuntimeFailure(error: unknown): boolean {
  return error instanceof AdapterError && error.code !== 'bad_response' && error.code !== 'aborted';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
