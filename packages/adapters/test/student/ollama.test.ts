import { AdapterError, DecodingSchema, type StudentAdapter } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createOllamaStudent } from '../../src/student/ollama';
import { studentEndpoint } from '../helpers/configs';
import {
  sendJson,
  startServer,
  stopServers,
  whenClosed,
  writeInPieces,
  type FakeServer,
  type RecordedRequest,
} from '../helpers/server';
import {
  chatLine,
  collect,
  doneLine,
  fakeOllama,
  GLIMMER_SHOW,
  ndjson,
  sendNdjson,
  studentRequest,
  textOf,
  type FakeOllama,
} from '../helpers/student';

afterEach(stopServers);

const MODEL = studentEndpoint('ollama-glimmer').model;
const retry = { sleep: async () => {}, random: () => 0 };

async function studentOn(
  options: FakeOllama = {},
  endpoint: Partial<ReturnType<typeof studentEndpoint>> = {},
  cpuThreads?: number,
): Promise<{ student: StudentAdapter; server: FakeServer }> {
  const server = await startServer(fakeOllama(options));
  const student = createOllamaStudent(
    studentEndpoint('ollama-glimmer', { baseUrl: server.url, ...endpoint }),
    cpuThreads === undefined ? { retry } : { retry, cpuThreads },
  );
  return { student, server };
}

const chatRequests = (server: FakeServer): RecordedRequest[] =>
  server.requests.filter((request) => request.path === '/api/chat');

async function failure(promise: Promise<unknown>): Promise<AdapterError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AdapterError);
  return error as AdapterError;
}

describe('the chat request', () => {
  it('posts the model, messages, sampling and a fixed seed to /api/chat', async () => {
    const { student, server } = await studentOn();
    const decoding = DecodingSchema.parse({
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 1500,
      thinking: 'medium',
    });
    await collect(student.chat(studentRequest({ decoding, seed: 99 })));

    const [request] = chatRequests(server);
    expect(request?.json()).toEqual({
      model: MODEL,
      messages: [{ role: 'user', content: 'Total invoice 12.' }],
      think: 'medium',
      stream: true,
      options: {
        num_ctx: 16_384,
        num_predict: 1500,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        seed: 99,
      },
    });
  });

  it('takes the seed from the request, never from the harness', async () => {
    const { student, server } = await studentOn();
    await collect(student.chat(studentRequest({ seed: 5 })));
    await collect(student.chat(studentRequest({ seed: 6 })));
    const seeds = chatRequests(server).map(
      (request) => (request.json()['options'] as { seed: number }).seed,
    );
    expect(seeds).toEqual([5, 6]);
  });

  it('caps the CPU threads only when asked to', async () => {
    const quiet = await studentOn({}, {}, 6);
    await collect(quiet.student.chat(studentRequest()));
    expect(chatRequests(quiet.server)[0]?.json()['options']).toMatchObject({ num_thread: 6 });
    const { student, server } = await studentOn();
    await collect(student.chat(studentRequest()));
    expect(chatRequests(server)[0]?.json()['options']).not.toHaveProperty('num_thread');
  });

  it('rests for a share of the reply time after each reply, only in quiet mode', async () => {
    const rests: number[] = [];
    const rest = async (ms: number) => {
      rests.push(ms);
    };
    const server = await startServer(fakeOllama({}));
    const quiet = createOllamaStudent(studentEndpoint('ollama-glimmer', { baseUrl: server.url }), {
      retry,
      cooldown: 0.75,
      rest,
    });
    const started = performance.now();
    await collect(quiet.chat(studentRequest()));
    const elapsed = performance.now() - started;
    expect(rests).toHaveLength(1);
    expect(rests[0]).toBeGreaterThan(0);
    expect(rests[0]).toBeLessThanOrEqual(elapsed * 0.75);
    const loud = createOllamaStudent(studentEndpoint('ollama-glimmer', { baseUrl: server.url }), {
      retry,
      rest,
    });
    await collect(loud.chat(studentRequest()));
    expect(rests).toHaveLength(1);
  });

  it('asks for the context size the job configured on every request', async () => {
    const { student, server } = await studentOn({}, { contextLength: 32_768 });
    await collect(student.chat(studentRequest()));
    expect((chatRequests(server)[0]?.json()['options'] as { num_ctx: number }).num_ctx).toBe(
      32_768,
    );
  });

  it.each(['low', 'medium', 'high'] as const)(
    'passes thinking level %s as think',
    async (level) => {
      const { student, server } = await studentOn();
      const decoding = DecodingSchema.parse({ thinking: level });
      await collect(student.chat(studentRequest({ decoding })));
      expect(chatRequests(server)[0]?.json()['think']).toBe(level);
    },
  );

  it('maps the transcript: tool calls with object arguments, results by tool name', async () => {
    const { student, server } = await studentOn();
    await collect(
      student.chat(
        studentRequest({
          messages: [
            { role: 'system', content: 'You are the service desk.' },
            { role: 'user', content: 'Total invoice 12.' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [
                { id: 'call_1', name: 'read_table', arguments: { name: 'invoices.csv' } },
              ],
            },
            { role: 'tool', toolCallId: 'call_1', name: 'read_table', content: '[{"id":12}]' },
            { role: 'assistant', content: 'Working on it.' },
          ],
        }),
      ),
    );
    expect(chatRequests(server)[0]?.json()['messages']).toEqual([
      { role: 'system', content: 'You are the service desk.' },
      { role: 'user', content: 'Total invoice 12.' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'read_table', arguments: { name: 'invoices.csv' } } }],
      },
      { role: 'tool', tool_name: 'read_table', content: '[{"id":12}]' },
      { role: 'assistant', content: 'Working on it.' },
    ]);
  });

  it('sends tools in the function format, and none when there are none', async () => {
    const { student, server } = await studentOn();
    const tool = {
      name: 'read_table',
      description: 'Read rows.',
      parameters: { type: 'object' as const, properties: { name: { type: 'string' } } },
    };
    await collect(student.chat(studentRequest({ tools: [tool] })));
    await collect(student.chat(studentRequest()));

    const [withTools, withoutTools] = chatRequests(server);
    expect(withTools?.json()['tools']).toEqual([{ type: 'function', function: tool }]);
    expect(withoutTools?.json()).not.toHaveProperty('tools');
  });

  it('never asks for a JSON format or sets keep_alive on a normal request', async () => {
    const { student, server } = await studentOn();
    await collect(student.chat(studentRequest()));
    const sent = chatRequests(server)[0]?.json() ?? {};
    expect(sent).not.toHaveProperty('format');
    expect(sent).not.toHaveProperty('keep_alive');
  });

  it('leaves think out for a model that cannot think, and looks that up only once', async () => {
    const { student, server } = await studentOn({
      show: { ...GLIMMER_SHOW, capabilities: ['completion', 'tools'] },
    });
    await collect(student.chat(studentRequest()));
    await collect(student.chat(studentRequest()));

    expect(chatRequests(server)).toHaveLength(2);
    for (const request of chatRequests(server)) {
      expect(request.json()).not.toHaveProperty('think');
    }
    expect(server.requests.filter((request) => request.path === '/api/show')).toHaveLength(1);
  });

  it('still sends think when Ollama does not list capabilities', async () => {
    const { student, server } = await studentOn({ show: { details: {} } });
    await collect(student.chat(studentRequest()));
    expect(chatRequests(server)[0]?.json()['think']).toBe('low');
  });
});

describe('the chat reply', () => {
  it('streams text and ends with usage from the final line', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(
          res,
          chatLine({ content: 'The total ' }),
          chatLine({ content: 'is $5.' }),
          doneLine({ prompt_eval_count: 321, eval_count: 45 }),
        ),
    });
    const events = await collect(student.chat(studentRequest()));

    expect(events).toEqual([
      { type: 'text', delta: 'The total ' },
      { type: 'text', delta: 'is $5.' },
      { type: 'done', usage: { inputTokens: 321, outputTokens: 45 }, finish: 'stop' },
    ]);
  });

  it('keeps reasoning out of the transcript but counts it', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(
          res,
          chatLine({ thinking: 'Let me ' }),
          chatLine({ thinking: 'think.' }),
          chatLine({ thinking: ' Yes.' }),
          chatLine({ content: 'Answer.' }),
          doneLine({ prompt_eval_count: 10, eval_count: 8 }),
        ),
    });
    const events = await collect(student.chat(studentRequest()));

    expect(textOf(events)).toBe('Answer.');
    expect(JSON.stringify(events)).not.toContain('think');
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 8, reasoningTokens: 3 },
    });
  });

  it('never reports more reasoning than the total it generated', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(
          res,
          chatLine({ thinking: 'a' }),
          chatLine({ thinking: 'b' }),
          doneLine({ eval_count: 1 }),
        ),
    });
    const done = (await collect(student.chat(studentRequest()))).at(-1);
    expect(done).toMatchObject({ usage: { outputTokens: 1, reasoningTokens: 1 } });
  });

  it('turns tool calls into events with ids numbered after the earlier ones in the transcript', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(
          res,
          chatLine({
            tool_calls: [
              {
                function: { index: 0, name: 'read_table', arguments: { name: 'a.csv', limit: 5 } },
              },
              { function: { index: 1, name: 'list_files', arguments: {} } },
            ],
          }),
          doneLine(),
        ),
    });
    const events = await collect(
      student.chat(
        studentRequest({
          messages: [
            { role: 'user', content: 'go' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'call_1', name: 'calculate', arguments: {} }],
            },
            { role: 'tool', toolCallId: 'call_1', name: 'calculate', content: '1' },
          ],
        }),
      ),
    );

    expect(events).toEqual([
      {
        type: 'tool_call',
        call: { id: 'call_2', name: 'read_table', arguments: { name: 'a.csv', limit: 5 } },
      },
      { type: 'tool_call', call: { id: 'call_3', name: 'list_files', arguments: {} } },
      { type: 'done', usage: { inputTokens: 11, outputTokens: 7 }, finish: 'tool_calls' },
    ]);
  });

  it('gives the same ids for the same transcript, run after run', async () => {
    const reply = (_request: RecordedRequest, res: Parameters<typeof sendNdjson>[0]) =>
      sendNdjson(
        res,
        chatLine({ tool_calls: [{ function: { name: 'list_files', arguments: {} } }] }),
        doneLine(),
      );
    const { student } = await studentOn({ chat: reply });
    const first = await collect(student.chat(studentRequest()));
    const second = await collect(student.chat(studentRequest()));
    expect(second).toEqual(first);
  });

  it('accepts tool arguments that arrive as JSON text', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(
          res,
          chatLine({
            tool_calls: [{ function: { name: 'read_table', arguments: '{"name":"a.csv"}' } }],
          }),
          doneLine(),
        ),
    });
    const events = await collect(student.chat(studentRequest()));
    expect(events[0]).toMatchObject({ call: { arguments: { name: 'a.csv' } } });
  });

  it('reports length when the reply hit the token limit', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(res, chatLine({ thinking: 'hmm' }), doneLine({ done_reason: 'length' })),
    });
    expect((await collect(student.chat(studentRequest()))).at(-1)).toMatchObject({
      type: 'done',
      finish: 'length',
    });
  });

  it('reads lines that arrive split across network chunks', async () => {
    const whole = ndjson(chatLine({ content: 'héllo ' }), chatLine({ content: '😀' }), doneLine());
    const { student } = await studentOn({
      chat: async (_request, res) => {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        const pieces = [];
        for (let i = 0; i < whole.length; i += 17) pieces.push(whole.slice(i, i + 17));
        await writeInPieces(res, pieces);
        res.end();
      },
    });
    const events = await collect(student.chat(studentRequest()));
    expect(textOf(events)).toBe('héllo 😀');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });
});

describe('chat failures', () => {
  it('points at the pull when the model is missing', async () => {
    const { student } = await studentOn({
      chat: (_request, res) => sendJson(res, 404, { error: `model '${MODEL}' not found` }),
    });
    const error = await failure(collect(student.chat(studentRequest())));
    expect(error.code).toBe('not_found');
    expect(error.message).toContain(`Ollama has no model "${MODEL}"`);
    expect(error.message).toContain(`Pull ${MODEL} first.`);
  });

  it('quotes Ollama when it rejects a request', async () => {
    const { student } = await studentOn({
      chat: (_request, res) => sendJson(res, 400, { error: `"${MODEL}" does not support tools` }),
    });
    const error = await failure(collect(student.chat(studentRequest())));
    expect(error.code).toBe('bad_request');
    expect(error.message).toContain('does not support tools');
  });

  it('retries a busy server and then succeeds', async () => {
    let served = 0;
    const { student, server } = await studentOn({
      chat: (_request, res) => {
        served += 1;
        if (served < 3) sendJson(res, 503, { error: 'server busy' });
        else sendNdjson(res, chatLine({ content: 'ok' }), doneLine());
      },
    });
    const events = await collect(student.chat(studentRequest()));
    expect(textOf(events)).toBe('ok');
    expect(chatRequests(server)).toHaveLength(3);
  });

  it('does not retry a rejected request', async () => {
    const { student, server } = await studentOn({
      chat: (_request, res) => sendJson(res, 400, { error: 'bad' }),
    });
    await failure(collect(student.chat(studentRequest())));
    expect(chatRequests(server)).toHaveLength(1);
  });

  it('raises an error line the runner sends mid-stream', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(res, chatLine({ content: 'par' }), {
          error: 'llama runner process has terminated: exit status 2',
        }),
    });
    const error = await failure(collect(student.chat(studentRequest())));
    expect(error.code).toBe('server');
    expect(error.message).toContain('llama runner process has terminated');
  });

  it('reports a stream that stops before the final line as a dropped connection', async () => {
    const { student } = await studentOn({
      chat: (_request, res) => sendNdjson(res, chatLine({ content: 'half' })),
    });
    const error = await failure(collect(student.chat(studentRequest())));
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('reports a line that is not JSON, or has the wrong shape, as a bad response', async () => {
    const garbled = await studentOn({
      chat: (_request, res) => {
        res.end('not json\n');
      },
    });
    expect((await failure(collect(garbled.student.chat(studentRequest())))).code).toBe(
      'bad_response',
    );

    const wrongShape = await studentOn({
      chat: (_request, res) => sendNdjson(res, { message: 'a string', done: 'yes' }),
    });
    expect((await failure(collect(wrongShape.student.chat(studentRequest())))).code).toBe(
      'bad_response',
    );
  });

  it('says so when tool arguments are not an object', async () => {
    const { student } = await studentOn({
      chat: (_request, res) =>
        sendNdjson(
          res,
          chatLine({ tool_calls: [{ function: { name: 'read_table', arguments: [1, 2] } }] }),
          doneLine(),
        ),
    });
    const error = await failure(collect(student.chat(studentRequest())));
    expect(error.code).toBe('bad_response');
    expect(error.message).toContain('"read_table"');
  });

  it('stops at the signal mid-stream and drops the connection', async () => {
    let closed: Promise<void> = Promise.resolve();
    const { student } = await studentOn({
      chat: (_request, res) => {
        closed = whenClosed(res);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(ndjson(chatLine({ content: 'first' })));
      },
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
    const { student } = await studentOn({
      chat: (_request, res) => {
        closed = whenClosed(res);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(ndjson(chatLine({ content: 'first' })));
      },
    });
    for await (const _event of student.chat(studentRequest())) break;
    await closed;
  });

  it('does not start when the signal is already aborted', async () => {
    const { student, server } = await studentOn();
    const error = await failure(collect(student.chat(studentRequest(), AbortSignal.abort())));
    expect(error.code).toBe('aborted');
    expect(chatRequests(server)).toHaveLength(0);
  });
});

describe('describe', () => {
  const tags = [
    { name: MODEL, size: 18_000_000_000, digest: 'sha256:abc123' },
    { name: 'other:latest', size: 1, digest: 'sha256:other' },
  ];

  it('reports quantization, context length, digest and size', async () => {
    const { student } = await studentOn({ models: tags });
    expect(await student.describe()).toEqual({
      model: MODEL,
      quantization: 'Q4_K_M',
      digest: 'sha256:abc123',
      sizeBytes: 18_000_000_000,
      contextLength: 131_072,
    });
  });

  it('matches a model written with or without :latest', async () => {
    const { student } = await studentOn(
      { models: [{ name: 'tiny:latest', size: 5, digest: 'sha256:t' }] },
      { model: 'tiny' },
    );
    expect(await student.describe()).toMatchObject({
      model: 'tiny',
      digest: 'sha256:t',
      sizeBytes: 5,
    });
  });

  it('leaves out what Ollama does not say', async () => {
    const { student } = await studentOn({ models: [], show: { details: {} } });
    expect(await student.describe()).toEqual({ model: MODEL });
  });

  it('points at the pull when the model is not downloaded', async () => {
    const { student } = await studentOn({ show: null });
    const error = await failure(student.describe());
    expect(error.code).toBe('not_found');
    expect(error.message).toContain(`Pull ${MODEL} first.`);
  });
});

describe('release', () => {
  it('asks Ollama to unload the model by sending keep_alive 0', async () => {
    const { student, server } = await studentOn({
      chat: (_request, res) =>
        sendJson(res, 200, { model: MODEL, done: true, done_reason: 'unload' }),
    });
    await student.release();
    expect(chatRequests(server)[0]?.json()).toEqual({
      model: MODEL,
      messages: [],
      keep_alive: 0,
      stream: false,
    });
  });

  it('raises the error when Ollama cannot be reached', async () => {
    const { student } = await studentOn();
    await stopServers();
    expect((await failure(student.release())).code).toBe('network');
  });
});

describe('testConnection', () => {
  const installed = [{ name: MODEL, size: 1, digest: 'sha256:abc' }];

  it('confirms the server version and that the model is downloaded', async () => {
    const { student } = await studentOn({ models: installed, version: '0.34.4' });
    const result = await student.testConnection();
    expect(result).toMatchObject({
      ok: true,
      detail: `Ollama 0.34.4 is running and ${MODEL} is ready.`,
    });
  });

  it('tells the person to install Ollama when nothing answers', async () => {
    const { student, server } = await studentOn();
    await stopServers();
    expect(await student.testConnection()).toEqual({
      ok: false,
      error: `Ollama isn't running at ${server.url}.`,
      hint: 'Install Ollama from ollama.com if you have not, then open it and test again.',
    });
  });

  it('tells the person which model to pull', async () => {
    const { student } = await studentOn({ models: [] });
    expect(await student.testConnection()).toEqual({
      ok: false,
      error: `${MODEL} isn't downloaded yet.`,
      hint: `Pull ${MODEL} to download it.`,
    });
  });

  it('asks for an update when Ollama is too old', async () => {
    const { student } = await studentOn({ models: installed, version: '0.31.9' });
    expect(await student.testConnection()).toEqual({
      ok: false,
      error: 'Ollama 0.31.9 is too old to run this model.',
      hint: 'Update Ollama to 0.32.7 or later.',
    });
  });

  it.each(['0.32.7', '0.32.8', '0.40.0', '1.0.0', '0.32.7-rc1', '0.0.0'])(
    'accepts Ollama %s',
    async (version) => {
      const { student } = await studentOn({ models: installed, version });
      expect(await student.testConnection()).toMatchObject({ ok: true });
    },
  );

  it('does not load the model to test it', async () => {
    const { student, server } = await studentOn({ models: installed });
    await student.testConnection();
    expect(chatRequests(server)).toHaveLength(0);
    expect(server.requests.map((request) => request.path)).toEqual(['/api/version', '/api/tags']);
  });

  it('shows what another server said when the address is wrong', async () => {
    const server = await startServer((_request, res) => sendJson(res, 404, {}));
    const student = createOllamaStudent(studentEndpoint('ollama-glimmer', { baseUrl: server.url }));
    const result = await student.testConnection();
    expect(result).toMatchObject({ ok: false, hint: 'Check the base URL.' });
  });
});

describe('identity', () => {
  it('knows whether it talks to this machine', async () => {
    const local = createOllamaStudent(studentEndpoint('ollama-glimmer'));
    const lan = createOllamaStudent(
      studentEndpoint('ollama-glimmer', { baseUrl: 'http://192.168.1.20:11434' }),
    );
    expect(local.isLocal).toBe(true);
    expect(lan.isLocal).toBe(false);
  });

  it('describes itself', () => {
    const endpoint = studentEndpoint('ollama-glimmer');
    expect(createOllamaStudent(endpoint)).toMatchObject({
      label: 'Ollama',
      model: endpoint.model,
      baseUrl: endpoint.baseUrl,
    });
    expect(createOllamaStudent(endpoint, { label: 'Glimmer' }).label).toBe('Glimmer');
  });
});
