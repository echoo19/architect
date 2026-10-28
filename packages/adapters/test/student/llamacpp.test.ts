import {
  AdapterError,
  DecodingSchema,
  type LlamaServerAccess,
  type LoraScale,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createLlamaCppStudent } from '../../src/student/llamacpp';
import { deltaChunk, textReply, usageChunk } from '../helpers/chat';
import {
  sendEventStream,
  sendJson,
  startServer,
  stopServers,
  type FakeServer,
  type Handler,
} from '../helpers/server';
import { collect, studentRequest, textOf } from '../helpers/student';

afterEach(stopServers);

const KEY = 'local-server-key-0123456789abcdef';

interface Server {
  server: FakeServer;
  access: LlamaServerAccess;
  /** What happened to the access, in order: acquire, release, check, describe, stop. */
  calls: string[];
}

/** A llama-server stand-in reached through the access a runtime would hand the student. */
async function llamaServer(
  handler: Handler,
  options: { model?: string; lora?: LoraScale[]; acquireFails?: Error } = {},
): Promise<Server> {
  const server = await startServer(handler);
  const calls: string[] = [];
  const access: LlamaServerAccess = {
    model: options.model ?? 'muse-glimmer:30b-iq2',
    baseUrl: 'http://127.0.0.1',
    acquire: async () => {
      calls.push('acquire');
      if (options.acquireFails) throw options.acquireFails;
      return {
        url: server.url,
        apiKey: KEY,
        lora: options.lora ?? [
          { id: 0, scale: 1 },
          { id: 1, scale: 0 },
        ],
        release: () => calls.push('release'),
      };
    },
    check: async () => {
      calls.push('check');
      return { ok: true, latencyMs: 3, detail: 'llama-server build 10472 can run it.' };
    },
    describe: async () => {
      calls.push('describe');
      return { model: 'muse-glimmer:30b-iq2', digest: `sha256:${'a'.repeat(64)}` };
    },
    stop: async () => {
      calls.push('stop');
    },
  };
  return { server, access, calls };
}

const READ = {
  name: 'read',
  description: 'Read a file.',
  parameters: { type: 'object' as const, properties: { path: { type: 'string' } } },
};

describe('the llama.cpp student', () => {
  it("asks for this student's adapter scales, Glimmer's sampling and reasoning strength, with the server's key", async () => {
    const { server, access, calls } = await llamaServer((_request, res) => {
      sendEventStream(res, [
        deltaChunk({ reasoning_content: 'The customer asks about one order.' }),
        deltaChunk({ reasoning_content: ' Read the orders first.' }),
        deltaChunk({
          tool_calls: [
            {
              index: 0,
              id: 'call_x',
              type: 'function',
              function: { name: 'read', arguments: '{"path":' },
            },
          ],
        }),
        deltaChunk({ tool_calls: [{ index: 0, function: { arguments: '"data/orders.csv"}' } }] }),
        deltaChunk({}, 'tool_calls'),
        usageChunk({ prompt_tokens: 410, completion_tokens: 38 }),
        '[DONE]',
      ]);
    });
    const student = createLlamaCppStudent(access);
    const events = await collect(
      student.chat(
        studentRequest({
          messages: [
            { role: 'system', content: 'You are the returns desk.' },
            { role: 'user', content: 'Was order 1182 late?' },
          ],
          tools: [READ],
          decoding: DecodingSchema.parse({ thinking: 'medium' }),
        }),
      ),
    );

    expect(events).toEqual([
      {
        type: 'tool_call',
        call: { id: 'call_x', name: 'read', arguments: { path: 'data/orders.csv' } },
      },
      {
        type: 'done',
        usage: { inputTokens: 410, outputTokens: 38, reasoningTokens: 2 },
        finish: 'tool_calls',
      },
    ]);
    const [request] = server.requests;
    expect(request?.path).toBe('/v1/chat/completions');
    expect(request?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request?.json()).toMatchObject({
      model: 'muse-glimmer:30b-iq2',
      stream: true,
      stream_options: { include_usage: true },
      lora: [
        { id: 0, scale: 1 },
        { id: 1, scale: 0 },
      ],
      chat_template_kwargs: { reasoning_strength: 'medium' },
      temperature: 1,
      top_p: 0.95,
      top_k: 64,
      seed: 1234,
      max_tokens: 4096,
      tools: [{ type: 'function', function: { name: 'read' } }],
    });
    expect(calls).toEqual(['acquire', 'release']);
  });

  it('streams a plain answer and leaves the reasoning out of it', async () => {
    const { access } = await llamaServer((_request, res) => {
      sendEventStream(res, [
        deltaChunk({ reasoning_content: 'Delivered the 19th, promised the 20th.' }),
        ...textReply(['ANSWER: ', '{"on_time": true}']),
      ]);
    });
    const events = await collect(createLlamaCppStudent(access).chat(studentRequest()));
    expect(textOf(events)).toBe('ANSWER: {"on_time": true}');
    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 1 },
      finish: 'stop',
    });
  });

  it('sends no template settings to a model that is not Glimmer', async () => {
    const { server, access } = await llamaServer(
      (_request, res) => sendEventStream(res, textReply('ok')),
      {
        model: 'qwen3.6:latest',
        lora: [],
      },
    );
    await collect(createLlamaCppStudent(access).chat(studentRequest()));
    expect(server.requests[0]?.json()).not.toHaveProperty('chat_template_kwargs');
    expect(server.requests[0]?.json()).toMatchObject({ lora: [] });
  });

  it('lets the server go even when the reply fails, and keeps its key out of the error', async () => {
    const { access, calls } = await llamaServer((_request, res) => {
      sendJson(res, 401, {
        error: { code: 401, message: `Invalid API Key ${KEY}`, type: 'authentication_error' },
      });
    });
    const failure = await collect(createLlamaCppStudent(access).chat(studentRequest())).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AdapterError);
    expect(failure).toMatchObject({ code: 'auth' });
    expect((failure as Error).message).not.toContain(KEY);
    expect(calls).toEqual(['acquire', 'release']);
  });

  it('passes on why the server could not start', async () => {
    const refused = new AdapterError(
      'not_found',
      "llama-server isn't installed, or isn't on PATH.",
    );
    const { access, calls } = await llamaServer(() => undefined, { acquireFails: refused });
    await expect(collect(createLlamaCppStudent(access).chat(studentRequest()))).rejects.toBe(
      refused,
    );
    expect(calls).toEqual(['acquire']);
  });

  it('rests after a reply in quiet mode, before letting the server go', async () => {
    const { access, calls } = await llamaServer((_request, res) =>
      sendEventStream(res, textReply('ok')),
    );
    const rests: number[] = [];
    const student = createLlamaCppStudent(access, {
      cooldown: 0.75,
      rest: async (ms) => {
        rests.push(ms);
        calls.push('rest');
      },
    });
    await collect(student.chat(studentRequest()));
    expect(rests).toHaveLength(1);
    expect(rests[0]).toBeGreaterThanOrEqual(0);
    expect(calls).toEqual(['acquire', 'rest', 'release']);
  });

  it('checks, describes and frees the GPU through the runtime, loading nothing to check', async () => {
    const { access, calls, server } = await llamaServer(() => undefined);
    const student = createLlamaCppStudent(access);
    expect(student).toMatchObject({
      label: 'llama.cpp',
      model: 'muse-glimmer:30b-iq2',
      isLocal: true,
    });
    await expect(student.testConnection()).resolves.toMatchObject({ ok: true });
    await expect(student.describe()).resolves.toMatchObject({ digest: `sha256:${'a'.repeat(64)}` });
    await student.release();
    expect(calls).toEqual(['check', 'describe', 'stop']);
    expect(server.requests).toEqual([]);
  });
});
