import { AdapterError, type ToolCall, type Usage } from '@architect/shared';
import { badResponse, cutOff, HttpError } from '../http/errors';
import { describeErrorPayload, failureForStreamError } from '../http/failures';
import { readSse } from '../http/sse';
import { callId, parseToolArguments } from '../tool-calls';
import { makeUsage } from '../usage';
import { ChatChunkWire, type ToolCallDelta, type UsageWire } from './wire';

export type FinishReason = 'stop' | 'length' | 'tool_calls';

export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'end'; finish: FinishReason; toolCalls: ToolCall[]; usage?: Usage };

interface ChatStreamOptions {
  /** Who is answering, for error messages. */
  service: string;
  /** Position to give the first call that arrives without an id (see `callId`). Default 1. */
  firstCallNumber?: number;
}

interface PartialCall {
  id?: string;
  name?: string;
  arguments: string;
}

/**
 * Reads a Chat Completions event stream: text deltas as they arrive, then one `end` event with
 * the finish reason, the tool calls (assembled from their fragments), and the usage if the
 * server sent it. Reasoning text is counted and dropped.
 */
export async function* readChatCompletionStream(
  chunks: AsyncIterable<Uint8Array>,
  options: ChatStreamOptions,
): AsyncGenerator<ChatStreamEvent> {
  const { service } = options;
  const calls = new Map<number, PartialCall>();
  let callIndex = 0;
  let finish: string | undefined;
  let usage: UsageWire | undefined;
  let reasoningDeltas = 0;
  let events = 0;
  let sawDone = false;

  for await (const payload of readSse(chunks)) {
    if (payload === '[DONE]') {
      sawDone = true;
      break;
    }
    events += 1;
    const chunk = parseChunk(payload, service);
    if (chunk.usage) usage = chunk.usage;

    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) yield { type: 'text', delta: delta.content };
    if (delta?.reasoning || delta?.reasoning_content) reasoningDeltas += 1;
    for (const part of delta?.tool_calls ?? []) {
      // Servers number the calls with `index`; a few leave it out, so fall back to the order seen.
      callIndex = part.index ?? (part.id ? calls.size : callIndex);
      addToolCallPart(calls, callIndex, part);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }

  if (events === 0) throw badResponse(service, 'a reply that was not an event stream');
  if (finish === undefined && !sawDone && usage === undefined) throw cutOff(service);
  if (finish === 'content_filter') {
    throw new AdapterError('blocked', `${service} stopped the reply with its content filter.`);
  }

  const first = options.firstCallNumber ?? 1;
  const toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call], position) => toToolCall(call, first + position, service));
  const end: ChatStreamEvent = { type: 'end', finish: finishReason(finish, toolCalls), toolCalls };
  if (usage) end.usage = toUsage(usage, reasoningDeltas);
  yield end;
}

function parseChunk(payload: string, service: string): ChatChunkWire {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch (cause) {
    throw badResponse(service, "a chunk that isn't valid JSON", cause);
  }
  if (typeof raw === 'object' && raw !== null && 'error' in raw && raw.error) {
    throw new HttpError(failureForStreamError(describeErrorPayload(raw), service));
  }
  const parsed = ChatChunkWire.safeParse(raw);
  if (!parsed.success) throw badResponse(service, 'a chunk in an unexpected shape', parsed.error);
  return parsed.data;
}

function addToolCallPart(
  calls: Map<number, PartialCall>,
  index: number,
  part: ToolCallDelta,
): void {
  const call = calls.get(index) ?? { arguments: '' };
  // Some hosts repeat the id and name on every fragment, so only the first one counts.
  if (part.id) call.id ??= part.id;
  if (part.function?.name) call.name ??= part.function.name;
  if (part.function?.arguments) call.arguments += part.function.arguments;
  calls.set(index, call);
}

function toToolCall(call: PartialCall, position: number, service: string): ToolCall {
  if (!call.name) throw badResponse(service, 'a tool call without a name');
  return {
    id: call.id || callId(position),
    name: call.name,
    arguments: parseToolArguments(call.arguments, call.name, service),
  };
}

function finishReason(reason: string | undefined, toolCalls: readonly ToolCall[]): FinishReason {
  if (reason === 'length') return 'length';
  return toolCalls.length > 0 ? 'tool_calls' : 'stop';
}

/** Reasoning tokens come from the server's count when it gives one; otherwise one per streamed delta. */
function toUsage(wire: UsageWire, reasoningDeltas: number): Usage {
  return makeUsage(wire.prompt_tokens, wire.completion_tokens, {
    reasoningTokens:
      wire.completion_tokens_details?.reasoning_tokens ??
      (reasoningDeltas > 0 ? reasoningDeltas : undefined),
    cachedInputTokens: wire.prompt_tokens_details?.cached_tokens ?? undefined,
  });
}
