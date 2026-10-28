import {
  AdapterError,
  mentorPreset,
  type MentorAdapter,
  type MentorCompletionRequest,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createAnthropicMentor } from '../../src/mentor/anthropic-mentor';
import { MentorReplyError } from '../../src/mentor/model-mentor';
import { mentorConfig } from '../helpers/configs';
import {
  routeTo,
  sendEventStream,
  sendJson,
  startServer,
  stopServers,
  type FakeServer,
  type RecordedRequest,
} from '../helpers/server';

afterEach(stopServers);

const API_KEY = 'sk-ant-test-0123456789';
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string' } },
  required: ['title'],
} as const;
const REQUEST: MentorCompletionRequest = {
  system: 'You are the mentor.',
  messages: [{ role: 'user', content: 'Diagnose.' }],
  maxOutputTokens: 4096,
};
const JSON_REQUEST: MentorCompletionRequest = {
  ...REQUEST,
  json: { name: 'hypothesis', schema: SCHEMA },
};

interface ModelShape {
  structuredOutputs?: boolean;
  effort?: boolean;
}

function modelInfo(id: string, shape: ModelShape = {}) {
  const { structuredOutputs = true, effort = true } = shape;
  return {
    type: 'model',
    id,
    display_name: 'Claude Test',
    created_at: '2026-10-07T18:00:00Z',
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: {
      structured_outputs: { supported: structuredOutputs },
      effort: {
        supported: effort,
        low: { supported: effort },
        medium: { supported: effort },
        high: { supported: effort },
      },
    },
  };
}

interface Turn {
  text?: string;
  tool?: string;
  stop?: string;
  category?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
}

/** The events of one streamed Messages reply, thinking first as the newest models send it. */
function events(turn: Turn): unknown[] {
  const stop = turn.stop ?? (turn.tool === undefined ? 'end_turn' : 'tool_use');
  const block =
    turn.tool === undefined
      ? [
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: turn.text ?? '' },
          },
        ]
      : [
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'hypothesis', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: turn.tool.slice(0, 5) },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: turn.tool.slice(5) },
          },
        ];
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [],
        usage: {
          input_tokens: turn.input ?? 100,
          output_tokens: 1,
          cache_read_input_tokens: turn.cacheRead ?? 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'ping' },
    ...block,
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: {
        stop_reason: stop,
        stop_sequence: null,
        ...(turn.category ? { stop_details: { type: 'refusal', category: turn.category } } : {}),
      },
      usage: { output_tokens: turn.output ?? 20 },
    },
    { type: 'message_stop' },
  ];
}

interface Fake {
  mentor: MentorAdapter;
  server: FakeServer;
  messages: () => Record<string, unknown>[];
}

async function anthropic(
  turns: (Turn | ((res: Parameters<Parameters<typeof startServer>[0]>[1]) => void))[],
  options: { model?: string; shape?: ModelShape; known?: string[] } = {},
): Promise<Fake> {
  const model = options.model ?? mentorPreset('anthropic-haiku').model;
  let served = 0;
  const server = await startServer((request, res) => {
    if (request.method === 'GET' && request.path === `/v1/models/${model}`) {
      if (options.known && !options.known.includes(model)) {
        sendJson(res, 404, {
          type: 'error',
          error: { type: 'not_found_error', message: `model: ${model}` },
        });
        return;
      }
      sendJson(res, 200, modelInfo(model, options.shape));
      return;
    }
    if (request.method === 'GET' && request.path.startsWith('/v1/models?')) {
      sendJson(res, 200, {
        data: (options.known ?? [model]).map((id) => modelInfo(id)),
        has_more: false,
        last_id: null,
      });
      return;
    }
    const turn = turns[Math.min(served++, turns.length - 1)];
    if (typeof turn === 'function') turn(res);
    else sendEventStream(res, events(turn ?? {}));
  });
  const mentor = createAnthropicMentor(
    mentorConfig('anthropic-haiku', options.model ? { model: options.model } : {}),
    {
      apiKey: API_KEY,
      fetch: routeTo(server),
      retry: { sleep: async () => {}, random: () => 0 },
    },
  );
  const messages = () =>
    server.requests
      .filter((request: RecordedRequest) => request.method === 'POST')
      .map((request) => request.json());
  return { mentor, server, messages };
}

async function failure(promise: Promise<unknown>): Promise<AdapterError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AdapterError);
  return error as AdapterError;
}

describe('the Messages request', () => {
  it('streams to /v1/messages with the key header and the API version, not a bearer token', async () => {
    const { mentor, server } = await anthropic([{ text: 'ok' }]);
    await mentor.complete(REQUEST);
    const post = server.requests.find((request) => request.method === 'POST');
    expect(post?.path).toBe('/v1/messages');
    expect(post?.headers['x-api-key']).toBe(API_KEY);
    expect(post?.headers['anthropic-version']).toBe('2026-10-21');
    expect(post?.headers).not.toHaveProperty('authorization');
  });

  it('holds JSON to the schema with output_config.format and sends the effort', async () => {
    const { mentor, messages } = await anthropic([{ text: '{"title":"Fix"}' }]);
    const completion = await mentor.complete(JSON_REQUEST);
    const [sent] = messages();
    expect(sent).toEqual({
      model: mentorPreset('anthropic-haiku').model,
      max_tokens: 4096,
      system: 'You are the mentor.',
      messages: [{ role: 'user', content: 'Diagnose.' }],
      stream: true,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    });
    expect(completion.json).toEqual({ title: 'Fix' });
  });

  it('reads what the model can do once, then reuses it', async () => {
    const { mentor, server } = await anthropic([{ text: 'one' }, { text: 'two' }]);
    await mentor.complete(REQUEST);
    await mentor.complete({ ...REQUEST, reasoningEffort: 'high' });
    const lookups = server.requests.filter((request) => request.path.startsWith('/v1/models/'));
    expect(lookups).toHaveLength(1);
  });

  it('forces a tool call on a model without structured outputs, and reads its input', async () => {
    const { mentor, messages } = await anthropic([{ tool: '{"title":"Tool fix"}' }], {
      shape: { structuredOutputs: false, effort: false },
    });
    const completion = await mentor.complete(JSON_REQUEST);
    const [sent] = messages();
    expect(sent?.['tools']).toEqual([
      { name: 'hypothesis', description: 'Give the reply as "hypothesis".', input_schema: SCHEMA },
    ]);
    expect(sent?.['tool_choice']).toEqual({ type: 'tool', name: 'hypothesis' });
    expect(sent).not.toHaveProperty('output_config');
    expect(completion.json).toEqual({ title: 'Tool fix' });
    expect(completion.text).toBe('{"title":"Tool fix"}');
  });

  it('puts a schema structured outputs would refuse in the prompt instead', async () => {
    const { mentor, messages } = await anthropic([{ text: '```json\n{"title":"x"}\n```' }]);
    const loose = { type: 'object', properties: { title: { type: 'string' } } } as const;
    const completion = await mentor.complete({
      ...REQUEST,
      json: { name: 'hypothesis', schema: loose },
    });
    const [sent] = messages();
    expect(sent?.['output_config']).toEqual({ effort: 'medium' });
    expect(sent?.['system']).toContain('single code block marked json');
    expect(completion.json).toEqual({ title: 'x' });
  });

  it('leaves the effort out on a model without that control', async () => {
    const { mentor, messages } = await anthropic([{ text: 'ok' }], {
      shape: { effort: false },
    });
    await mentor.complete(REQUEST);
    expect(messages()[0]).not.toHaveProperty('output_config');
  });

  it('moves system turns to the top and leaves empty assistant turns out', async () => {
    const { mentor, messages } = await anthropic([{ text: 'ok' }]);
    await mentor.complete({
      ...REQUEST,
      messages: [
        { role: 'user', content: 'First.' },
        { role: 'assistant', content: '' },
        { role: 'system', content: 'Also this.' },
        { role: 'user', content: 'Second.' },
      ],
    });
    const [sent] = messages();
    expect(sent?.['system']).toBe('You are the mentor.\n\nAlso this.');
    expect(sent?.['messages']).toEqual([
      { role: 'user', content: 'First.' },
      { role: 'user', content: 'Second.' },
    ]);
  });
});

describe('usage and cost', () => {
  it('counts cache reads as input and output from the last running total', async () => {
    const { mentor } = await anthropic([{ text: 'ok', input: 900, cacheRead: 100, output: 300 }]);
    const completion = await mentor.complete(REQUEST);
    expect(completion.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 300,
      cachedInputTokens: 100,
    });
    expect(completion.costUsd).toBeCloseTo((900 * 0.1 + 100 * 0.01 + 300 * 0.5) / 1e6, 12);
  });

  it('bills a prompt over 100,000 tokens at the long-prompt rates', async () => {
    const { mentor } = await anthropic([{ text: 'ok', input: 120_000, output: 1000 }]);
    const completion = await mentor.complete(REQUEST);
    expect(completion.costUsd).toBeCloseTo((120_000 * 0.5 + 1000 * 2.5) / 1e6, 12);
  });
});

describe('replies that cannot be used', () => {
  it('makes one repair call and charges both calls', async () => {
    const { mentor, messages } = await anthropic([
      { text: '{"title": broken', input: 100, output: 10 },
      { text: '{"title":"Fixed"}', input: 150, output: 10 },
    ]);
    const completion = await mentor.complete(JSON_REQUEST);
    expect(completion.json).toEqual({ title: 'Fixed' });
    const repair = messages()[1]?.['messages'] as { role: string; content: string }[];
    expect(repair.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(repair[2]?.content).toContain('That reply could not be used:');
    expect(completion.usage).toMatchObject({ inputTokens: 250, outputTokens: 20 });
  });

  it('reports a refusal as blocked, with what it spent, and does not retry it', async () => {
    const { mentor, messages } = await anthropic([
      { text: '', stop: 'refusal', category: 'general_harms', output: 3 },
    ]);
    const error = await failure(mentor.complete(REQUEST));
    expect(error.code).toBe('blocked');
    expect(error.message).toContain('declined the request (general harms)');
    expect(error).toBeInstanceOf(MentorReplyError);
    expect((error as MentorReplyError).usage).toMatchObject({ outputTokens: 3 });
    expect(messages()).toHaveLength(1);
  });

  it('says the limit was spent thinking when an empty reply stopped at max_tokens', async () => {
    const { mentor } = await anthropic([{ text: '', stop: 'max_tokens', output: 4096 }]);
    const error = await failure(mentor.complete(REQUEST));
    expect(error.message).toContain('whole output limit on reasoning');
  });

  it('retries an overloaded answer, and an error event part-way through a stream', async () => {
    const { mentor, messages } = await anthropic([
      (res) =>
        sendJson(res, 529, {
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
      (res) =>
        sendEventStream(res, [
          events({ text: 'x' })[0],
          { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
        ]),
      { text: 'finally' },
    ]);
    const completion = await mentor.complete(REQUEST);
    expect(completion.text).toBe('finally');
    expect(messages()).toHaveLength(3);
  });

  it('turns a rejected key into the usual message', async () => {
    const { mentor } = await anthropic([
      (res) =>
        sendJson(res, 401, {
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        }),
    ]);
    const error = await failure(mentor.complete(REQUEST));
    expect(error.code).toBe('auth');
    expect(error.message).toContain("Anthropic didn't accept the API key");
  });
});

describe('testConnection', () => {
  it('confirms the model from its entry in the model list', async () => {
    const { mentor, server } = await anthropic([]);
    const result = await mentor.testConnection();
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.detail).toContain('is available');
    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('says which models the key can use when the configured one is missing', async () => {
    const { mentor } = await anthropic([], {
      model: 'claude-missing-1',
      known: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    });
    expect(await mentor.testConnection()).toEqual({
      ok: false,
      error: 'Anthropic accepted the key but doesn\'t offer "claude-missing-1".',
      hint: 'It offers claude-haiku-5-5, claude-sonnet-5-5.',
    });
  });
});
