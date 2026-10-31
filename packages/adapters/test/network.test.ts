import { AdapterError } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMentor, createStudent, listModels, verifyKey } from '../src';
import type { NetworkDeps } from '../src/deps';
import { createHttpClient } from '../src/http/client';
import { mentorConfig, studentEndpoint } from './helpers/configs';
import { fakeOllama } from './helpers/student';
import { sendJson, startServer, stopServers } from './helpers/server';

afterEach(stopServers);

const API_KEY = 'sk-test-0123456789';
const Models = z.object({ data: z.array(z.unknown()) });

/** A fetch that answers every request itself and remembers the URLs it was asked for. */
function recordingFetch(): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const stub = async (input: string | URL | Request): Promise<Response> => {
    urls.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify({ data: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: stub as typeof fetch, urls };
}

function refusal(run: () => unknown): AdapterError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }
  throw new Error('Expected a refusal.');
}

describe('a closed network', () => {
  it('refuses a teacher outside it when the adapter is made, before anything is sent', () => {
    const { fetch, urls } = recordingFetch();
    const config = mentorConfig('meta-spark');
    const host = new URL(config.baseUrl).host;
    const error = refusal(() =>
      createMentor(config, {
        apiKey: API_KEY,
        fetch,
        network: { allowed: ['spark.lab.internal', 'vllm.lab.internal:8000'] },
      }),
    );
    expect(error.code).toBe('outside_network');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('outside the closed network, so nothing was sent there');
    expect(error.message).toContain(`Add ${host} to the closed network in Settings`);
    expect(error.message).not.toContain(API_KEY);
    expect(urls).toEqual([]);
  });

  it('refuses a hosted student outside it the same way', () => {
    const { fetch, urls } = recordingFetch();
    const endpoint = studentEndpoint('ollama-glimmer', { baseUrl: 'https://glimmer.example.com' });
    const error = refusal(() =>
      createStudent(
        { ...endpoint, runtime: 'openai_compatible' },
        { fetch, network: { allowed: [] } },
      ),
    );
    expect(error.code).toBe('outside_network');
    expect(urls).toEqual([]);
  });

  it('admits a named host and this computer, and tells each request host, never its path', async () => {
    const contacts: [string, boolean][] = [];
    const network: NetworkDeps = {
      allowed: ['vllm.lab.internal:8000'],
      contacted: (host, inside) => contacts.push([host, inside]),
    };
    const { fetch, urls } = recordingFetch();
    const client = createHttpClient({
      baseUrl: 'http://vllm.lab.internal:8000/v1',
      service: 'vLLM',
      headers: { authorization: `Bearer ${API_KEY}` },
      secrets: [API_KEY],
      fetch,
      network,
    });
    await client.getJson('/models?token=private', Models);
    expect(urls).toEqual(['http://vllm.lab.internal:8000/v1/models?token=private']);

    const server = await startServer(fakeOllama({ models: [] }));
    const local = createStudent(studentEndpoint('ollama-glimmer', { baseUrl: server.url }), {
      network,
    });
    // Its model isn't there, which doesn't matter here: what counts is where the requests went.
    await local.testConnection();

    const here = new URL(server.url).host;
    expect(contacts).toEqual([
      ['vllm.lab.internal:8000', true],
      [here, true],
      [here, true],
    ]);
  });

  it('holds an adapter already made to the setting as it is at each request', async () => {
    let allowed: readonly string[] | undefined;
    const contacts: [string, boolean][] = [];
    const { fetch, urls } = recordingFetch();
    const client = createHttpClient({
      baseUrl: 'https://spark.lab.internal/v1',
      service: 'Spark Open',
      fetch,
      network: {
        allowed: () => allowed,
        contacted: (host, inside) => contacts.push([host, inside]),
      },
    });
    // No closed network yet: the request goes, recorded as outside one.
    await client.getJson('/models', Models);
    allowed = ['vllm.lab.internal'];
    const error = await client.getJson('/models', Models).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('outside_network');
    expect((error as AdapterError).message).toContain('Spark Open at spark.lab.internal');
    allowed = ['spark.lab.internal'];
    await client.getJson('/models', Models);
    expect(urls).toHaveLength(2);
    expect(contacts).toEqual([
      ['spark.lab.internal', false],
      ['spark.lab.internal', true],
    ]);
  });
});

describe('model lists and key checks under a closed network', () => {
  it('are refused outside it before anything is sent, key and all', async () => {
    const { fetch, urls } = recordingFetch();
    const network: NetworkDeps = { allowed: ['vllm.lab.internal:8000'] };
    for (const run of [
      () =>
        listModels({
          provider: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          fetch,
          network,
        }),
      () =>
        verifyKey({
          provider: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: API_KEY,
          fetch,
          network,
        }),
    ]) {
      const error = await run().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe('outside_network');
      expect((error as AdapterError).message).not.toContain(API_KEY);
    }
    expect(urls).toEqual([]);
    const inside = await listModels({
      provider: 'other',
      baseUrl: 'http://vllm.lab.internal:8000/v1',
      fetch,
      network,
    });
    expect(inside).toEqual([]);
    expect(urls).toEqual(['http://vllm.lab.internal:8000/v1/models']);
  });
});

describe('redirects', () => {
  it('are never followed: the body and the key never reach the host they point to', async () => {
    const elsewhere = await startServer((_req, res) => sendJson(res, 200, { data: [] }));
    const first = await startServer((_req, res) => {
      res.writeHead(307, { location: `${elsewhere.url}/v1/steal?token=private` });
      res.end();
    });
    const contacts: string[] = [];
    const client = createHttpClient({
      baseUrl: `${first.url}/v1`,
      service: 'Teacher',
      headers: { 'x-api-key': API_KEY },
      secrets: [API_KEY],
      retry: { sleep: async () => {}, random: () => 0 },
      network: { allowed: [], contacted: (host) => contacts.push(host) },
    });
    const error = await client
      .postJson('/messages', { secret: 'prompt' }, Models)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('bad_response');
    expect((error as AdapterError).message).toContain(
      `answered with a redirect to ${new URL(elsewhere.url).host}, which Architect doesn't follow`,
    );
    expect((error as AdapterError).message).not.toContain('private');
    expect(first.requests).toHaveLength(1);
    expect(elsewhere.requests).toHaveLength(0);
    // Only the host that was asked is recorded: nothing went to the other one.
    expect(contacts).toEqual([new URL(first.url).host]);
  });
});
