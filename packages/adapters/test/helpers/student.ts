import {
  DecodingSchema,
  type StudentChatRequest,
  type StudentStreamEvent,
} from '@architect/shared';
import type { ServerResponse } from 'node:http';
import { sendJson, type Handler } from './server';

export function studentRequest(overrides: Partial<StudentChatRequest> = {}): StudentChatRequest {
  return {
    messages: [{ role: 'user', content: 'Total invoice 12.' }],
    tools: [],
    decoding: DecodingSchema.parse({}),
    seed: 1234,
    ...overrides,
  };
}

export async function collect(
  events: AsyncIterable<StudentStreamEvent>,
): Promise<StudentStreamEvent[]> {
  const all: StudentStreamEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

export const textOf = (events: StudentStreamEvent[]): string =>
  events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');

/** One line of Ollama's streamed `/api/chat` reply. */
export const chatLine = (
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): unknown => ({
  model: 'test-model',
  created_at: '2026-10-27T12:00:00Z',
  message: { role: 'assistant', content: '', ...message },
  done: false,
  ...extra,
});

export const doneLine = (extra: Record<string, unknown> = {}): unknown => ({
  model: 'test-model',
  created_at: '2026-10-27T12:00:01Z',
  message: { role: 'assistant', content: '' },
  done_reason: 'stop',
  done: true,
  prompt_eval_count: 11,
  eval_count: 7,
  ...extra,
});

export const ndjson = (...lines: unknown[]): string =>
  lines.map((line) => `${JSON.stringify(line)}\n`).join('');

export function sendNdjson(res: ServerResponse, ...lines: unknown[]): void {
  res.writeHead(200, { 'content-type': 'application/x-ndjson' });
  res.end(ndjson(...lines));
}

export interface FakeOllama {
  version?: string;
  models?: { name: string; size: number; digest: string }[];
  /** The `/api/show` reply, or `null` to answer 404 as Ollama does for a model it doesn't have. */
  show?: Record<string, unknown> | null;
  chat?: Handler;
  pull?: Handler;
}

export const GLIMMER_SHOW = {
  details: { quantization_level: 'Q4_K_M', parameter_size: '29.6B' },
  model_info: { 'general.architecture': 'glimmer', 'glimmer.context_length': 131072 },
  capabilities: ['completion', 'vision', 'tools', 'thinking'],
};

/** A small Ollama: the endpoints the adapter uses, answering what the options say. */
export function fakeOllama(options: FakeOllama = {}): Handler {
  const { version = '0.34.4', models = [], show = GLIMMER_SHOW } = options;
  return async (request, res) => {
    switch (`${request.method} ${request.path}`) {
      case 'GET /api/version':
        sendJson(res, 200, { version });
        return;
      case 'GET /api/tags':
        sendJson(res, 200, { models });
        return;
      case 'POST /api/show':
        if (show === null) sendJson(res, 404, { error: "model 'missing' not found" });
        else sendJson(res, 200, show);
        return;
      case 'POST /api/chat':
        if (options.chat) await options.chat(request, res);
        else sendNdjson(res, chatLine({ content: 'ok' }), doneLine());
        return;
      case 'POST /api/pull':
        if (options.pull) await options.pull(request, res);
        else sendNdjson(res, { status: 'success' });
        return;
      default:
        sendJson(res, 404, {});
    }
  };
}
