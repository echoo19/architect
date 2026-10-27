import { eventData } from './server';

export interface UsageBody {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
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
