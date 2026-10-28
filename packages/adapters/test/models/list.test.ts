import { afterEach, describe, expect, it } from 'vitest';
import { listModels, verifyKey } from '../../src/models/list';
import { openRouterPricing } from '../../src/models/openrouter';
import { fitsStrictSubset } from '../../src/json-schema';
import { routeTo, sendJson, startServer, stopServers, type Handler } from '../helpers/server';

afterEach(stopServers);

const KEY = 'sk-list-0123456789';

async function serve(handler: Handler) {
  const server = await startServer(handler);
  return { server, fetch: routeTo(server) };
}

describe('listModels', () => {
  it('reads an OpenAI-style list with the key, leaves out non-chat models and sorts by id', async () => {
    const { server, fetch } = await serve((_request, res) =>
      sendJson(res, 200, {
        object: 'list',
        data: [
          { id: 'gpt-6-sol' },
          { id: 'text-embedding-3-large' },
          { id: 'gpt-6-luna' },
          { id: 'gpt-image-2' },
          { id: 'gpt-realtime-2' },
        ],
      }),
    );
    const models = await listModels({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: KEY,
      fetch,
    });
    expect(models).toEqual([{ id: 'gpt-6-luna' }, { id: 'gpt-6-sol' }]);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("drops Google's models/ prefix and keeps its names", async () => {
    const { fetch } = await serve((_request, res) =>
      sendJson(res, 200, {
        object: 'list',
        data: [
          { id: 'models/gemini-3.5-flash-lite', display_name: 'Gemini 3.5 Flash-Lite' },
          { id: 'models/gemini-embedding-2', display_name: 'Gemini Embedding 2' },
        ],
      }),
    );
    const models = await listModels({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: KEY,
      fetch,
    });
    expect(models).toEqual([{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' }]);
  });

  it('reads a bare array, as Together sends', async () => {
    const { fetch } = await serve((_request, res) =>
      sendJson(res, 200, [{ id: 'meta-models/Muse-Glimmer-30B', context_length: 131_072 }]),
    );
    const models = await listModels({
      provider: 'together',
      baseUrl: 'https://api.together.ai/v1',
      apiKey: KEY,
      fetch,
    });
    expect(models).toEqual([{ id: 'meta-models/Muse-Glimmer-30B', contextLength: 131_072 }]);
  });

  it("reads every page of Anthropic's list with its own headers", async () => {
    const { server, fetch } = await serve((request, res) => {
      const second = request.path.includes('after_id=claude-b');
      sendJson(res, 200, {
        data: second
          ? [{ id: 'claude-c', display_name: 'Claude C', max_input_tokens: 200_000 }]
          : [
              { id: 'claude-a', display_name: 'Claude A', max_input_tokens: 1_000_000 },
              { id: 'claude-b', display_name: 'Claude B' },
            ],
        has_more: !second,
        last_id: second ? 'claude-c' : 'claude-b',
      });
    });
    const models = await listModels({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: KEY,
      fetch,
    });
    expect(models.map((model) => model.id)).toEqual(['claude-a', 'claude-b', 'claude-c']);
    expect(models[0]).toEqual({ id: 'claude-a', label: 'Claude A', contextLength: 1_000_000 });
    expect(server.requests[0]?.headers['x-api-key']).toBe(KEY);
    expect(server.requests[0]?.headers['anthropic-version']).toBe('2026-10-21');
    expect(server.requests[0]?.headers).not.toHaveProperty('authorization');
    expect(server.requests).toHaveLength(2);
  });

  it("reads OpenRouter's public catalogue, with prices, and keeps the key home", async () => {
    const { server, fetch } = await serve((_request, res) =>
      sendJson(res, 200, {
        data: [
          {
            id: 'meta/muse-glimmer-30b',
            name: 'Meta: Muse Glimmer 30B',
            context_length: 131_072,
            pricing: {
              prompt: '0.0000003',
              completion: '0.0000012',
              input_cache_read: '0.00000004',
            },
          },
          {
            id: 'openrouter/auto',
            name: 'Auto Router',
            pricing: { prompt: '-1', completion: '-1' },
          },
        ],
      }),
    );
    const models = await listModels({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: KEY,
      fetch,
    });
    expect(models).toEqual([
      {
        id: 'meta/muse-glimmer-30b',
        label: 'Meta: Muse Glimmer 30B',
        contextLength: 131_072,
        pricing: { inputPerM: 0.3, cachedInputPerM: 0.04, outputPerM: 1.2 },
      },
      { id: 'openrouter/auto', label: 'Auto Router' },
    ]);
    expect(server.requests[0]?.headers).not.toHaveProperty('authorization');
  });

  it('lists what Ollama has downloaded, with sizes', async () => {
    const { server, fetch } = await serve((_request, res) =>
      sendJson(res, 200, {
        models: [
          { name: 'granite4.2:8b', size: 5_300_000_000, digest: 'a1' },
          { name: 'nomic-embed-text:latest', size: 270_000_000, digest: 'b2' },
        ],
      }),
    );
    const models = await listModels({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      fetch,
    });
    expect(models).toEqual([{ id: 'granite4.2:8b', sizeBytes: 5_300_000_000 }]);
    expect(server.requests[0]?.path).toBe('/api/tags');
  });

  it('names an added endpoint by its host when it fails', async () => {
    const { fetch } = await serve((_request, res) => sendJson(res, 401, { error: 'no' }));
    await expect(
      listModels({ provider: 'other', baseUrl: 'https://llm.example.com/v1', apiKey: KEY, fetch }),
    ).rejects.toThrow("llm.example.com didn't accept the API key");
  });
});

describe('verifyKey', () => {
  it('asks OpenRouter about the key itself, since its catalogue is public', async () => {
    const { server, fetch } = await serve((request, res) => {
      if (request.path === '/api/v1/key') {
        if (request.headers.authorization === `Bearer ${KEY}`) {
          sendJson(res, 200, { data: { label: 'Architect', limit: null } });
        } else sendJson(res, 401, { error: { message: 'No auth credentials found', code: 401 } });
        return;
      }
      sendJson(res, 200, {
        data: [
          { id: 'nvidia/nemotron-3.5-super-vl:free', pricing: { prompt: '0', completion: '0' } },
        ],
      });
    });
    const models = await verifyKey({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: KEY,
      fetch,
    });
    expect(models.map((model) => model.id)).toEqual(['nvidia/nemotron-3.5-super-vl:free']);
    expect(server.requests.map((request) => request.path)).toEqual([
      '/api/v1/key',
      '/api/v1/models',
    ]);

    const refused = await verifyKey({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-wrong-000000',
      fetch,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toMatchObject({ code: 'auth' });
  });

  it('lists with the key for every other provider', async () => {
    const { server, fetch } = await serve((_request, res) =>
      sendJson(res, 200, { data: [{ id: 'claude-haiku-5-5' }], has_more: false }),
    );
    await verifyKey({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: KEY,
      fetch,
    });
    expect(server.requests[0]?.headers['x-api-key']).toBe(KEY);
  });
});

describe('openRouterPricing', () => {
  it('turns dollars per token into dollars per million, with the long-prompt rates', () => {
    expect(
      openRouterPricing({
        prompt: '0.0000001',
        completion: '0.0000005',
        input_cache_read: '0.00000001',
        overrides: [
          {
            min_prompt_tokens: 100_000,
            prompt: '0.0000005',
            completion: '0.0000025',
            input_cache_read: '0.00000005',
          },
        ],
      }),
    ).toEqual({
      inputPerM: 0.1,
      cachedInputPerM: 0.01,
      outputPerM: 0.5,
      longContext: {
        aboveInputTokens: 99_999,
        inputPerM: 0.5,
        cachedInputPerM: 0.05,
        outputPerM: 2.5,
      },
    });
  });

  it('has no price for a router whose cost depends on the route, and charges cache reads as input when unlisted', () => {
    expect(openRouterPricing({ prompt: '-1', completion: '-1' })).toBeNull();
    expect(openRouterPricing(null)).toBeNull();
    expect(openRouterPricing({ prompt: '0', completion: '0' })).toEqual({
      inputPerM: 0,
      cachedInputPerM: 0,
      outputPerM: 0,
    });
  });
});

describe('fitsStrictSubset', () => {
  it('accepts closed objects whose properties are all required, at every depth', () => {
    expect(
      fitsStrictSubset({
        type: 'object',
        additionalProperties: false,
        required: ['edits', 'title'],
        properties: {
          title: { type: 'string', description: 'A name.' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path'],
              properties: { path: { type: 'string' } },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('refuses an open object, or one with an optional property, however deep', () => {
    expect(fitsStrictSubset({ type: 'object', properties: {} })).toBe(false);
    expect(
      fitsStrictSubset({
        type: 'object',
        additionalProperties: false,
        required: [],
        properties: { title: { type: 'string' } },
      }),
    ).toBe(false);
    expect(
      fitsStrictSubset({
        type: 'object',
        additionalProperties: false,
        required: ['inner'],
        properties: { inner: { anyOf: [{ type: 'object', properties: {} }, { type: 'null' }] } },
      }),
    ).toBe(false);
  });
});
