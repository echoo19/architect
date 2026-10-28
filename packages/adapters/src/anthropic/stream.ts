import type { Usage } from '@architect/shared';
import { badResponse, cutOff, HttpError } from '../http/errors';
import { describeErrorPayload, failureForStreamError } from '../http/failures';
import { readSse } from '../http/sse';
import { makeUsage } from '../usage';
import {
  BlockDeltaWire,
  BlockStartWire,
  MessageDeltaWire,
  MessageStartWire,
  type UsageWire,
} from './wire';

/** A whole streamed Messages reply. */
export interface MessagesReply {
  /** The text blocks, joined. Thinking is billed but never kept. */
  text: string;
  /** The JSON a forced tool call carried, as streamed; null without one. */
  toolInput: string | null;
  /** `end_turn`, `max_tokens`, `tool_use`, `refusal` and so on. */
  stopReason: string | null;
  /** Why a refusal happened, when Anthropic says. */
  refusalCategory: string | null;
  usage: Usage | null;
}

interface Block {
  type: string;
  text: string;
  json: string;
}

type Counts = { -readonly [K in keyof UsageWire]: number | null | undefined };

function parsePayload(payload: string, service: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (cause) {
    throw badResponse(service, "an event that isn't valid JSON", cause);
  }
}

function typeOf(raw: unknown): unknown {
  return typeof raw === 'object' && raw !== null && 'type' in raw ? raw.type : undefined;
}

/** Later counts replace earlier ones: `message_delta` carries running totals. */
function merge(counts: Counts, next: UsageWire | null | undefined): void {
  if (!next) return;
  for (const key of Object.keys(next) as (keyof UsageWire)[]) {
    const value = next[key];
    if (typeof value === 'number') counts[key] = value;
  }
}

/** Input counts every prompt token, cache reads and writes included; cached ones are the reads. */
function toUsage(counts: Counts): Usage | null {
  if (typeof counts.input_tokens !== 'number' || typeof counts.output_tokens !== 'number') {
    return null;
  }
  const read = counts.cache_read_input_tokens ?? 0;
  const written = counts.cache_creation_input_tokens ?? 0;
  return makeUsage(counts.input_tokens + read + written, counts.output_tokens, {
    cachedInputTokens: typeof counts.cache_read_input_tokens === 'number' ? read : undefined,
  });
}

/**
 * Reads a streamed Messages reply to its end: text, a tool call's input, why it stopped and the
 * token counts. An `error` event becomes the matching adapter error.
 */
export async function readMessagesStream(
  chunks: AsyncIterable<Uint8Array>,
  service: string,
): Promise<MessagesReply> {
  const blocks = new Map<number, Block>();
  const counts: Counts = {};
  let stopReason: string | null = null;
  let refusalCategory: string | null = null;
  let events = 0;
  let finished = false;

  for await (const payload of readSse(chunks)) {
    events += 1;
    const raw = parsePayload(payload, service);
    switch (typeOf(raw)) {
      case 'error':
        throw new HttpError(failureForStreamError(describeErrorPayload(raw), service));
      case 'message_start': {
        const event = MessageStartWire.safeParse(raw);
        if (!event.success) throw badResponse(service, 'a message start in an unexpected shape');
        merge(counts, event.data.message.usage);
        break;
      }
      case 'content_block_start': {
        const event = BlockStartWire.safeParse(raw);
        if (!event.success) throw badResponse(service, 'a content block in an unexpected shape');
        blocks.set(event.data.index, { type: event.data.content_block.type, text: '', json: '' });
        break;
      }
      case 'content_block_delta': {
        const event = BlockDeltaWire.safeParse(raw);
        if (!event.success) throw badResponse(service, 'a content delta in an unexpected shape');
        const block = blocks.get(event.data.index);
        if (!block) break;
        block.text += event.data.delta.text ?? '';
        block.json += event.data.delta.partial_json ?? '';
        break;
      }
      case 'message_delta': {
        const event = MessageDeltaWire.safeParse(raw);
        if (!event.success) throw badResponse(service, 'a message delta in an unexpected shape');
        stopReason = event.data.delta.stop_reason ?? stopReason;
        refusalCategory = event.data.delta.stop_details?.category ?? refusalCategory;
        merge(counts, event.data.usage);
        break;
      }
      case 'message_stop':
        finished = true;
        break;
      default:
        // `ping`, `content_block_stop` and event types added later carry nothing needed here.
        break;
    }
    if (finished) break;
  }

  if (events === 0) throw badResponse(service, 'a reply that was not an event stream');
  if (!finished && stopReason === null) throw cutOff(service);

  const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
  const tool = ordered.find((block) => block.type === 'tool_use');
  return {
    text: ordered
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(''),
    toolInput: tool ? tool.json : null,
    stopReason,
    refusalCategory,
    usage: toUsage(counts),
  };
}
