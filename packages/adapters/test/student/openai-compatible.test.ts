import {
  AdapterError,
  DecodingSchema,
  GLIMMER_SAMPLING,
  type StudentAdapter,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenAICompatibleStudent } from '../../src/student/openai-compatible';
import { deltaChunk, textReply, usageChunk } from '../helpers/chat';
import { studentEndpoint } from '../helpers/configs';
import {
  openEventStream,
  routeTo,
  sendEventStream,
  sendJson,
  startServer,
  stopServers,
  whenClosed,
  type FakeServer,
  type Handler,
} from '../helpers/server';
import { collect, studentRequest, textOf } from '../helpers/student';

afterEach(stopServers);

const API_KEY = 'tgp_test-key-0123456789';
const delays: number[] = [];
const retry = {
  sleep: async (ms: number) => {
    delays.push(ms);
  },
  random: () => 0,
};

type PresetKey = Parameters<typeof studentEndpoint>[0];

/** A hosted preset whose requests are routed to a fake server, so its real base URL is used. */
async function hostedOn(
  key: PresetKey,
  handler: Handler,
  options: { apiKey?: string | null } = {},
): Promise<{ student: StudentAdapter; server: FakeServer }> {
  delays.length = 0;
  const server = await startServer(handler);
  const apiKey = options.apiKey === null ? undefined : (options.apiKey ?? API_KEY);
  const student = createOpenAICompatibleStudent(studentEndpoint(key), {
    apiKey,
    fetch: routeTo(server),
    retry,
  });
  return { student, server };
}

/** A local server (llama.cpp style), reached at its own address. */
async function localOn(handler: Handler): Promise<{ student: StudentAdapter; server: FakeServer }> {
  delays.length = 0;
  const server = await startServer(handler);
  const student = createOpenAICompatibleStudent(
    studentEndpoint('together-glimmer', {
      baseUrl: `${server.url}/v1`,
      model: 'local-glimmer',
    }),
    { retry },
  );
  return { student, server };
}

const reply = (text = 'ok') => textReply(text);
const answer: Handler = (_request, res) => sendEventStream(res, reply());

async function failure(promise: Promise<unknown>): Promise<AdapterError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AdapterError);
  return error as AdapterError;
}

const lastBody = (server: FakeServer): Record<string, unknown> =>
  server.requests.at(-1)?.json() ?? {};

describe('the request to a hosted student', () => {
  it('streams a chat completion with the harness sampling and the runner’s seed', async () => {
    const { student, server } = await hostedOn('together-glimmer', answer);
    const decoding = DecodingSchema.parse({
      temperature: 0.8,
      topP: 0.9,
      topK: 50,
      maxOutputTokens: 1200,
      thinking: 'medium',
    });
    await collect(student.chat(studentRequest({ decoding, seed: 42 })));

    const [request] = server.requests;
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe('/v1/chat/completions');
    expect(request?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request?.headers.accept).toBe('text/event-stream');
    expect(request?.json()).toEqual({
      model: studentEndpoint('together-glimmer').model,
      messages: [
        { role: 'system', content: 'Reasoning strength: medium.' },
        { role: 'user', content: 'Total invoice 12.' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 1200,
      temperature: 0.8,
      top_p: 0.9,
      top_k: 50,
      seed: 42,
    });
  });

  it('puts the reasoning strength in the system message for hosts that read it there', async () => {
    const { student, server } = await hostedOn('together-glimmer', answer);
    await collect(
      student.chat(
        studentRequest({
          messages: [
            { role: 'system', content: 'You are the service desk.' },
            { role: 'user', content: 'Hi' },
          ],
          decoding: DecodingSchema.parse({ thinking: 'high' }),
        }),
      ),
    );
    const body = lastBody(server);
    expect(body['messages']).toEqual([
      { role: 'system', content: 'You are the service desk.\n\nReasoning strength: high.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('chat_template_kwargs');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('adds a system message when the transcript has none', async () => {
    const { student, server } = await hostedOn('deepinfra-glimmer', answer);
    await collect(student.chat(studentRequest()));
    expect(server.requests[0]?.path).toBe('/v1/openai/chat/completions');
    expect(lastBody(server)['messages']).toEqual([
      { role: 'system', content: 'Reasoning strength: low.' },
      { role: 'user', content: 'Total invoice 12.' },
    ]);
  });

  it('sends OpenRouter the reasoning effort in its own field and in the system line', async () => {
    const { student, server } = await hostedOn('openrouter-glimmer', answer);
    await collect(
      student.chat(
        studentRequest({
          messages: [
            { role: 'system', content: 'You are the service desk.' },
            { role: 'user', content: 'Hi' },
          ],
          decoding: DecodingSchema.parse({ thinking: 'medium' }),
        }),
      ),
    );
    const body = lastBody(server);
    expect(body['reasoning']).toEqual({ effort: 'medium' });
    // Some of OpenRouter's providers ignore the field and read Glimmer's system line instead.
    expect(body['messages']).toEqual([
      { role: 'system', content: 'You are the service desk.\n\nReasoning strength: medium.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(body).not.toHaveProperty('chat_template_kwargs');
    // Any provider may serve it unless the endpoint pins one.
    expect(body).not.toHaveProperty('provider');
  });

  it('keeps OpenRouter on the providers an endpoint pins, with no fallback to others', async () => {
    delays.length = 0;
    const server = await startServer(answer);
    const student = createOpenAICompatibleStudent(
      studentEndpoint('openrouter-glimmer', { providers: ['DeepInfra'] }),
      { apiKey: API_KEY, fetch: routeTo(server), retry },
    );
    await collect(student.chat(studentRequest()));
    expect(lastBody(server)['provider']).toEqual({ order: ['DeepInfra'], allow_fallbacks: false });
  });

  it('sends a local server the strength as a template variable and leaves the prompt alone', async () => {
    const { student, server } = await localOn(answer);
    await collect(
      student.chat(
        studentRequest({
          messages: [
            { role: 'system', content: 'You are the service desk.' },
            { role: 'user', content: 'Hi' },
          ],
          decoding: DecodingSchema.parse({ thinking: 'low' }),
        }),
      ),
    );
    const body = lastBody(server);
    expect(body['chat_template_kwargs']).toEqual({ reasoning_strength: 'low' });
    expect(body['messages']).toEqual([
      { role: 'system', content: 'You are the service desk.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(body).not.toHaveProperty('reasoning');
    expect(server.requests[0]?.path).toBe('/v1/chat/completions');
  });

  it('sends no Authorization header without a key', async () => {
    const { student, server } = await localOn(answer);
    await collect(student.chat(studentRequest()));
    expect(server.requests[0]?.headers).not.toHaveProperty('authorization');
  });

  it('leaves top_k out when it is 0, and tools out when there are none', async () => {
    const { student, server } = await hostedOn('together-glimmer', answer);
    await collect(student.chat(studentRequest({ decoding: DecodingSchema.parse({ topK: 0 }) })));
    const body = lastBody(server);
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('sends tools in the function format, and tool results with the tool name', async () => {
    const { student, server } = await hostedOn('together-glimmer', answer);
    const tool = {
      name: 'read_table',
      description: 'Read rows.',
      parameters: { type: 'object' as const, properties: { name: { type: 'string' } } },
    };
    await collect(
      student.chat(
        studentRequest({
          tools: [tool],
          messages: [
            { role: 'user', content: 'go' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'call_1', name: 'read_table', arguments: { name: 'a.csv' } }],
            },
            { role: 'tool', toolCallId: 'call_1', name: 'read_table', content: '[1]' },
          ],
        }),
      ),
    );
    const body = lastBody(server);
    expect(body['tools']).toEqual([{ type: 'function', function: tool }]);
    expect((body['messages'] as unknown[]).slice(1)).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_table', arguments: '{"name":"a.csv"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'read_table', content: '[1]' },
    ]);
  });

  it('never sends the Meta-only or Ollama-only fields', async () => {
    const { student, server } = await hostedOn('together-glimmer', answer);
    await collect(student.chat(studentRequest()));
    const body = lastBody(server);
    for (const key of ['max_completion_tokens', 'num_ctx', 'options', 'think', 'keep_alive']) {
      expect(body, key).not.toHaveProperty(key);
    }
  });
});

describe('the reply', () => {
  it('streams text and finishes with usage', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendEventStream(
        res,
        textReply(['The total ', 'is $5.'], { prompt_tokens: 120, completion_tokens: 18 }),
      ),
    );
    const events = await collect(student.chat(studentRequest()));
    expect(events).toEqual([
      { type: 'text', delta: 'The total ' },
      { type: 'text', delta: 'is $5.' },
      { type: 'done', usage: { inputTokens: 120, outputTokens: 18 }, finish: 'stop' },
    ]);
  });

  it('keeps reasoning out of the transcript but counts it', async () => {
    const { student } = await hostedOn('openrouter-glimmer', (_request, res) =>
      sendEventStream(res, [
        deltaChunk({ reasoning: 'Let me think. ' }),
        deltaChunk({ reasoning_content: 'Yes.' }),
        deltaChunk({ content: 'Answer.' }),
        deltaChunk({}, 'stop'),
        usageChunk({ prompt_tokens: 9, completion_tokens: 6 }),
        '[DONE]',
      ]),
    );
    const events = await collect(student.chat(studentRequest()));
    expect(textOf(events)).toBe('Answer.');
    expect(JSON.stringify(events)).not.toContain('think');
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 9, outputTokens: 6, reasoningTokens: 2 },
    });
  });

  it('reads cached and reasoning counts the server reports', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendEventStream(
        res,
        textReply('ok', {
          prompt_tokens: 500,
          completion_tokens: 120,
          prompt_tokens_details: { cached_tokens: 400 },
          completion_tokens_details: { reasoning_tokens: 90 },
        }),
      ),
    );
    const done = (await collect(student.chat(studentRequest()))).at(-1);
    expect(done).toMatchObject({
      usage: { inputTokens: 500, outputTokens: 120, reasoningTokens: 90, cachedInputTokens: 400 },
    });
  });

  it('passes on what OpenRouter says it charged for the call', async () => {
    const { student } = await hostedOn('openrouter-glimmer', (_request, res) =>
      sendEventStream(
        res,
        textReply('ok', { prompt_tokens: 30_000, completion_tokens: 800, cost: 0.01294 }),
      ),
    );
    const done = (await collect(student.chat(studentRequest()))).at(-1);
    expect(done).toEqual({
      type: 'done',
      usage: { inputTokens: 30_000, outputTokens: 800 },
      finish: 'stop',
      costUsd: 0.01294,
    });
  });

  it('reports zero usage rather than failing when a host sends none', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendEventStream(res, textReply('ok', null)),
    );
    const done = (await collect(student.chat(studentRequest()))).at(-1);
    expect(done).toEqual({
      type: 'done',
      usage: { inputTokens: 0, outputTokens: 0 },
      finish: 'stop',
    });
  });

  it('emits tool calls before done, numbered after the transcript’s earlier calls', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendEventStream(res, [
        deltaChunk({ tool_calls: [{ index: 0, function: { name: 'read_table', arguments: '' } }] }),
        deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '{"name":"a.csv"}' } }] }),
        deltaChunk({
          tool_calls: [
            { index: 1, id: 'call_xyz', function: { name: 'list_files', arguments: '{}' } },
          ],
        }),
        deltaChunk({}, 'tool_calls'),
        usageChunk({ prompt_tokens: 30, completion_tokens: 12 }),
        '[DONE]',
      ]),
    );
    const events = await collect(
      student.chat(
        studentRequest({
          messages: [
            { role: 'user', content: 'go' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'call_1', name: 'x', arguments: {} }],
            },
            { role: 'tool', toolCallId: 'call_1', name: 'x', content: '1' },
          ],
        }),
      ),
    );
    expect(events).toEqual([
      {
        type: 'tool_call',
        call: { id: 'call_2', name: 'read_table', arguments: { name: 'a.csv' } },
      },
      { type: 'tool_call', call: { id: 'call_xyz', name: 'list_files', arguments: {} } },
      { type: 'done', usage: { inputTokens: 30, outputTokens: 12 }, finish: 'tool_calls' },
    ]);
  });

  it('reports length when the reply hit the token limit', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendEventStream(res, textReply('cut off', undefined, 'length')),
    );
    expect((await collect(student.chat(studentRequest()))).at(-1)).toMatchObject({
      finish: 'length',
    });
  });

  it('raises "blocked" when the host’s filter stops the reply', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendEventStream(res, textReply('', undefined, 'content_filter')),
    );
    expect((await failure(collect(student.chat(studentRequest())))).code).toBe('blocked');
  });
});

describe('failures', () => {
  it('tells the person to check the key in Settings, without repeating it', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendJson(res, 401, { error: { message: `Invalid API key ${API_KEY}` } }),
    );
    const error = await failure(collect(student.chat(studentRequest())));
    expect(error.code).toBe('auth');
    expect(error.message).toContain('Check the key in Settings.');
    expect(error.message).not.toContain(API_KEY);
  });

  it('retries a rate limit that asks for a wait, then a 503, and then succeeds', async () => {
    let served = 0;
    const { student, server } = await hostedOn('together-glimmer', (_request, res) => {
      served += 1;
      if (served === 1) sendJson(res, 429, { error: 'slow' }, { 'retry-after': '2' });
      else if (served === 2) sendJson(res, 503, { error: 'warming up' });
      else sendEventStream(res, reply('finally'));
    });
    const events = await collect(student.chat(studentRequest()));
    expect(textOf(events)).toBe('finally');
    expect(server.requests).toHaveLength(3);
    expect(delays).toEqual([2000, 1000]);
  });

  it('does not retry a rejected request', async () => {
    const { student, server } = await hostedOn('together-glimmer', (_request, res) =>
      sendJson(res, 400, { error: { message: 'bad parameter' } }),
    );
    await failure(collect(student.chat(studentRequest())));
    expect(server.requests).toHaveLength(1);
  });

  it('names the model on a 404', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendJson(res, 404, {}),
    );
    const error = await failure(collect(student.chat(studentRequest())));
    expect(error.code).toBe('not_found');
    expect(error.message).toContain(studentEndpoint('together-glimmer').model);
  });

  it('stops at the signal mid-stream and drops the connection', async () => {
    let closed: Promise<void> = Promise.resolve();
    const { student } = await hostedOn('together-glimmer', (_request, res) => {
      closed = whenClosed(res);
      openEventStream(res);
      res.write(`data: ${JSON.stringify(deltaChunk({ content: 'first' }))}\n\n`);
    });
    const controller = new AbortController();
    const seen: string[] = [];
    const error = await failure(
      (async () => {
        for await (const event of student.chat(studentRequest(), controller.signal)) {
          if (event.type === 'text') seen.push(event.delta);
          controller.abort();
        }
      })(),
    );
    expect(error.code).toBe('aborted');
    expect(seen).toEqual(['first']);
    await closed;
  });

  it('drops the connection when the consumer stops reading', async () => {
    let closed: Promise<void> = Promise.resolve();
    const { student } = await hostedOn('together-glimmer', (_request, res) => {
      closed = whenClosed(res);
      openEventStream(res);
      res.write(`data: ${JSON.stringify(deltaChunk({ content: 'first' }))}\n\n`);
    });
    for await (const _event of student.chat(studentRequest())) break;
    await closed;
  });
});

describe('testConnection', () => {
  const listing =
    (...ids: string[]): Handler =>
    (request, res) => {
      if (request.method === 'GET') sendJson(res, 200, { data: ids.map((id) => ({ id })) });
      else sendEventStream(res, reply('ready'));
    };
  const model = studentEndpoint('together-glimmer').model;

  it('confirms the model from the free model list', async () => {
    const { student, server } = await hostedOn('together-glimmer', listing(model));
    const result = await student.testConnection();
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.detail).toBe(`Connected to api.together.ai. ${model} is available.`);
    expect(server.requests.map((request) => request.method)).toEqual(['GET']);
    expect(server.requests[0]?.path).toBe('/v1/models');
  });

  it('reads the bare array that some hosts return', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendJson(res, 200, [{ id: model }]),
    );
    expect(await student.testConnection()).toMatchObject({ ok: true });
  });

  it('asks for a few tokens when the model is not listed, since lists can be incomplete', async () => {
    const { student, server } = await hostedOn('together-glimmer', listing('something-else'));
    const result = await student.testConnection();

    expect(result).toMatchObject({
      ok: true,
      detail: 'Connected to api.together.ai. The model answered.',
    });
    expect(server.requests.map((request) => request.method)).toEqual(['GET', 'POST']);
    const body = lastBody(server);
    expect(body['max_tokens']).toBe(64);
    expect(body).toMatchObject({
      temperature: GLIMMER_SAMPLING.temperature,
      top_p: GLIMMER_SAMPLING.topP,
      top_k: GLIMMER_SAMPLING.topK,
    });
  });

  it('asks for a few tokens when the host has no model list', async () => {
    const { student, server } = await localOn((request, res) => {
      if (request.method === 'GET') sendJson(res, 404, {});
      else sendEventStream(res, reply('ready'));
    });
    expect(await student.testConnection()).toMatchObject({ ok: true });
    expect(server.requests.map((request) => request.method)).toEqual(['GET', 'POST']);
  });

  it('says what the host does offer when the model is truly missing', async () => {
    const { student } = await hostedOn('together-glimmer', (request, res) => {
      if (request.method === 'GET') sendJson(res, 200, { data: [{ id: 'a' }, { id: 'b' }] });
      else sendJson(res, 404, { error: 'no such model' });
    });
    expect(await student.testConnection()).toEqual({
      ok: false,
      error: `api.together.ai doesn't offer "${model}".`,
      hint: 'It offers a, b.',
    });
  });

  it('turns a rejected key into a message with the next step', async () => {
    const { student } = await hostedOn('together-glimmer', (_request, res) =>
      sendJson(res, 401, { error: 'no' }),
    );
    expect(await student.testConnection()).toEqual({
      ok: false,
      error: "api.together.ai didn't accept the API key (HTTP 401).",
      hint: 'Check the key in Settings.',
    });
  });

  it('does not retry while testing', async () => {
    const { student, server } = await hostedOn('together-glimmer', (request, res) => {
      if (request.method === 'GET') sendJson(res, 200, { data: [] });
      else sendJson(res, 503, { error: 'busy' });
    });
    expect(await student.testConnection()).toMatchObject({ ok: false });
    expect(server.requests).toHaveLength(2);
    expect(delays).toEqual([]);
  });
});

describe('identity', () => {
  it('knows whether it talks to this machine', () => {
    const hosted = createOpenAICompatibleStudent(studentEndpoint('together-glimmer'));
    const local = createOpenAICompatibleStudent(
      studentEndpoint('together-glimmer', { baseUrl: 'http://127.0.0.1:8080/v1' }),
    );
    expect(hosted.isLocal).toBe(false);
    expect(local.isLocal).toBe(true);
  });

  it('is labelled by its host unless told otherwise, and describes only the model', async () => {
    const endpoint = studentEndpoint('openrouter-glimmer');
    const student = createOpenAICompatibleStudent(endpoint);
    expect(student).toMatchObject({
      label: 'openrouter.ai',
      model: endpoint.model,
      baseUrl: endpoint.baseUrl,
    });
    expect(createOpenAICompatibleStudent(endpoint, { label: 'Glimmer (hosted)' }).label).toBe(
      'Glimmer (hosted)',
    );
    expect(await student.describe()).toEqual({ model: endpoint.model });
    await expect(student.release()).resolves.toBeUndefined();
  });
});
