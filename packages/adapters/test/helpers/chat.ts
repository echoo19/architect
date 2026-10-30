import type { ServerResponse } from 'node:http';
import { eventData, sendEventStream, sendJson, type RecordedRequest } from './server';

export interface UsageBody {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  /** What the call was charged, in US dollars, as OpenRouter reports it. */
  cost?: number;
}

/** One streamed chunk carrying a delta and, optionally, the finish reason. */
export const deltaChunk = (
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): unknown => ({ choices: [{ index: 0, delta, finish_reason: finishReason }] });

export const usageChunk = (usage: UsageBody): unknown => ({ choices: [], usage });

/** The events of a streamed Chat Completions reply that is just text. */
export function textReply(
  text: string | string[],
  usage: UsageBody | null = { prompt_tokens: 10, completion_tokens: 5 },
  finishReason = 'stop',
): unknown[] {
  const parts = Array.isArray(text) ? text : [text];
  return [
    deltaChunk({ role: 'assistant', content: '' }),
    ...parts.map((content) => deltaChunk({ content })),
    deltaChunk({}, finishReason),
    ...(usage ? [usageChunk(usage)] : []),
    '[DONE]',
  ];
}

interface ChunkShape {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: UsageBody;
}

/**
 * The same reply as a server sends it when asked not to stream: one message with the text and
 * tool calls the events carried, the finish reason, and the usage if the events had it.
 */
export function wholeReply(payloads: unknown[]): unknown {
  let content = '';
  let reasoning = '';
  let finish: string | null = null;
  let usage: UsageBody | undefined;
  const calls = new Map<number, { id?: string; name?: string; arguments: string }>();
  for (const payload of payloads) {
    if (typeof payload === 'string') continue;
    const chunk = payload as ChunkShape;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    content += choice?.delta?.content ?? '';
    reasoning += choice?.delta?.reasoning_content ?? '';
    for (const part of choice?.delta?.tool_calls ?? []) {
      const index = part.index ?? calls.size;
      const call = calls.get(index) ?? { arguments: '' };
      call.id ??= part.id;
      call.name ??= part.function?.name;
      call.arguments += part.function?.arguments ?? '';
      calls.set(index, call);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
  }
  const message: Record<string, unknown> = { role: 'assistant', content };
  if (reasoning) message['reasoning_content'] = reasoning;
  if (calls.size > 0) {
    message['tool_calls'] = [...calls.values()].map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  return {
    choices: [{ index: 0, message, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  };
}

/** Sends a reply the way it was asked for: streamed, or whole when the request says `stream: false`. */
export function answer(request: RecordedRequest, res: ServerResponse, payloads: unknown[]): void {
  if (request.json()['stream'] === false) sendJson(res, 200, wholeReply(payloads));
  else sendEventStream(res, payloads);
}

export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

export const eventBytes = (payloads: unknown[]): Uint8Array =>
  encode(payloads.map(eventData).join(''));

/** Yields bytes in pieces of `size`, the way a network delivers them. */
export async function* inPieces(
  bytes: Uint8Array,
  size = bytes.length,
): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < bytes.length; start += size) yield bytes.slice(start, start + size);
}
