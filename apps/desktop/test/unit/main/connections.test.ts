import { listModels, verifyKey } from '@architect/adapters';
import { AdapterError, type MentorConfig, type ModelEntry } from '@architect/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addConnection,
  detectLocalRuntimes,
  endpointAddress,
  listConnectionModels,
  removeConnection,
  testMentor,
  testStudent,
  type ConnectionDeps,
} from '../../../src/main/connections';
import { closedUrl, fakeServer, sendJson, type FakeServer } from './http';

const servers: FakeServer[] = [];

/** An OpenAI-compatible host that lists one model. */
async function modelHost(): Promise<FakeServer> {
  const server = await fakeServer((request, response) => {
    if (request.url === '/v1/models') return sendJson(response, { data: [{ id: 'spark-test' }] });
    sendJson(response, { error: { message: 'not found' } }, 404);
  });
  servers.push(server);
  return server;
}

function mentor(baseUrl: string): MentorConfig {
  return {
    kind: 'model',
    provider: 'other',
    label: 'Test mentor',
    baseUrl: `${baseUrl}/v1`,
    model: 'spark-test',
    reasoningEffort: 'low',
    secretRef: 'meta',
  };
}

const keys = async (ref: string) => (ref === 'meta' ? 'sk-test' : undefined);
const noKeys = async () => undefined;
/** The fake hosts run on 127.0.0.1, where the real rule would (rightly) never send a key. */
const anyHost = () => null;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('testMentor', () => {
  it("connects with the key saved under the config's ref", async () => {
    const host = await modelHost();
    const result = await testMentor(mentor(host.url), keys, anyHost);
    expect(result).toMatchObject({ ok: true });
    expect(host.requests).toEqual([
      { method: 'GET', path: '/v1/models', authorization: 'Bearer sk-test' },
    ]);
  });

  it('says to add a key, without calling the mentor, when none is saved', async () => {
    const host = await modelHost();
    expect(await testMentor(mentor(host.url), noKeys, anyHost)).toEqual({
      ok: false,
      error: 'No key is saved for Test mentor.',
      hint: 'Add the key in Settings, then test again.',
    });
    expect(host.requests).toEqual([]);
  });

  it('refuses to send a stored key to a host outside its service, before any request', async () => {
    const host = await modelHost();
    const result = await testMentor(mentor(host.url), keys);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toContain('This would send your Meta Model API key');
    expect(host.requests).toEqual([]);
  });

  it('explains that a coding agent cannot be a mentor yet', async () => {
    const result = await testMentor(
      { kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' },
      keys,
    );
    expect(result).toEqual({
      ok: false,
      error: "Claude Code can't be used as a mentor yet.",
      hint: 'Choose a model API instead.',
    });
  });
});

describe('testStudent', () => {
  it('connects to a hosted student with its key', async () => {
    const host = await modelHost();
    const result = await testStudent(
      {
        runtime: 'openai_compatible',
        baseUrl: `${host.url}/v1`,
        model: 'spark-test',
        secretRef: 'meta',
        contextLength: 16_384,
      },
      keys,
      anyHost,
    );
    expect(result).toMatchObject({ ok: true });
    expect(host.requests[0]?.authorization).toBe('Bearer sk-test');
  });

  it('says to add a key when the endpoint needs one that is missing', async () => {
    const result = await testStudent(
      {
        runtime: 'openai_compatible',
        baseUrl: 'https://api.together.ai/v1',
        model: 'meta-models/Muse-Glimmer-30B',
        secretRef: 'together',
        contextLength: 16_384,
      },
      noKeys,
    );
    expect(result).toEqual({
      ok: false,
      error: 'No key is saved for api.together.ai.',
      hint: 'Add the key in Settings, then test again.',
    });
  });
});

describe('testMentor on this computer', () => {
  it('needs no key and sends none', async () => {
    const host = await modelHost();
    const result = await testMentor(
      {
        kind: 'model',
        provider: 'lmstudio',
        label: 'LM Studio model',
        baseUrl: `${host.url}/v1`,
        model: 'spark-test',
        reasoningEffort: 'low',
      },
      noKeys,
    );
    expect(result).toMatchObject({ ok: true });
    expect(host.requests).toEqual([{ method: 'GET', path: '/v1/models' }]);
  });
});

describe('listConnectionModels', () => {
  it('lists with the saved key where the provider needs one', async () => {
    const host = await modelHost();
    const models = await listConnectionModels(
      { provider: 'other', baseUrl: `${host.url}/v1`, secretRef: 'meta' },
      keys,
      anyHost,
    );
    expect(models).toEqual([{ id: 'spark-test' }]);
    expect(host.requests[0]?.authorization).toBe('Bearer sk-test');
  });

  it('refuses before any request when the key would go to another host', async () => {
    const host = await modelHost();
    await expect(
      listConnectionModels(
        { provider: 'other', baseUrl: `${host.url}/v1`, secretRef: 'meta' },
        keys,
      ),
    ).rejects.toThrow('This would send your Meta Model API key');
    expect(host.requests).toEqual([]);
  });

  it('says to add the key when it is missing', async () => {
    await expect(
      listConnectionModels(
        { provider: 'openai', baseUrl: 'https://api.openai.com/v1', secretRef: 'openai' },
        noKeys,
      ),
    ).rejects.toThrow('No key is saved for OpenAI. Add it in Settings.');
  });
});

describe('detectLocalRuntimes', () => {
  const card = { name: 'NVIDIA GeForce RTX 4070 Ti', memoryBytes: 12_878_610_432, shared: false };

  it('finds Ollama and LM Studio with their chat models, what is loaded, and the GPU', async () => {
    const ollama = await fakeServer((request, response) => {
      if (request.url === '/api/version') return sendJson(response, { version: '0.40.9' });
      if (request.url === '/api/ps') {
        return sendJson(response, {
          models: [{ name: 'muse-glimmer:30b-iq2', size: 9_928_945_171, size_vram: 9_928_945_171 }],
        });
      }
      sendJson(response, {
        models: [
          { name: 'muse-glimmer:30b-iq2', size: 10_746_373_364, digest: 'sha256:a' },
          { name: 'granite4.2:8b', size: 5_300_000_000, digest: 'sha256:b' },
        ],
      });
    });
    const lmStudio = await fakeServer((_request, response) =>
      sendJson(response, { data: [{ id: 'qwen3-8b' }, { id: 'text-embedding-nomic' }] }),
    );
    servers.push(ollama, lmStudio);
    const runtimes = await detectLocalRuntimes({
      ollamaBaseUrl: ollama.url,
      lmStudioBaseUrl: `${lmStudio.url}/v1`,
      gpu: async () => card,
    });
    expect(runtimes).toEqual({
      ollama: {
        running: true,
        version: '0.40.9',
        baseUrl: ollama.url,
        models: [
          {
            id: 'muse-glimmer:30b-iq2',
            sizeBytes: 10_746_373_364,
            inMemory: { totalBytes: 9_928_945_171, gpuBytes: 9_928_945_171 },
          },
          { id: 'granite4.2:8b', sizeBytes: 5_300_000_000 },
        ],
      },
      lmstudio: { running: true, baseUrl: `${lmStudio.url}/v1`, models: [{ id: 'qwen3-8b' }] },
      gpu: card,
    });
    expect(ollama.requests.map((request) => request.path)).not.toContain('/api/chat');
  });

  it('says plainly when neither is running, and when the GPU is unknown', async () => {
    const nothing = await closedUrl();
    expect(
      await detectLocalRuntimes({
        ollamaBaseUrl: nothing,
        lmStudioBaseUrl: `${nothing}/v1`,
        gpu: async () => null,
      }),
    ).toEqual({
      ollama: { running: false, baseUrl: nothing, models: [] },
      lmstudio: { running: false, baseUrl: `${nothing}/v1`, models: [] },
      gpu: null,
    });
  });
});

function connectionDeps(overrides: Partial<ConnectionDeps> = {}) {
  const saved = new Map<string, string>();
  const endpoints: { baseUrl: string; label: string }[] = [];
  const deps: ConnectionDeps = {
    verifyKey: vi.fn(async () => [{ id: 'model-a' }, { id: 'model-b' }] as ModelEntry[]),
    listModels: vi.fn(async () => [{ id: 'model-a' }] as ModelEntry[]),
    saveKey: vi.fn(async (ref: string, value: string) => {
      saved.set(ref, value);
    }),
    clearKey: vi.fn(async (ref: string) => {
      saved.delete(ref);
    }),
    addEndpoint: vi.fn(async (endpoint: { baseUrl: string; label: string }) => {
      endpoints.push(endpoint);
    }),
    removeEndpoint: vi.fn(async () => undefined),
    ...overrides,
  };
  return { deps, saved, endpoints };
}

describe('addConnection', () => {
  it("checks a provider's key at its own address and saves it under the provider", async () => {
    const { deps, saved } = connectionDeps();
    const result = await addConnection({ provider: 'openai', key: ' sk-openai-1 ' }, deps);
    expect(deps.verifyKey).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai-1',
    });
    expect(saved.get('openai')).toBe('sk-openai-1');
    expect(result).toEqual({ secretRef: 'openai', models: 2 });
  });

  it('keeps a key the provider refuses out of the store', async () => {
    const { deps, saved } = connectionDeps({
      verifyKey: vi.fn(async () => {
        throw new AdapterError('auth', "Anthropic didn't accept the API key (HTTP 401).");
      }),
    });
    await expect(addConnection({ provider: 'anthropic', key: 'sk-ant-bad' }, deps)).rejects.toThrow(
      "Anthropic didn't accept that key. Check it and try again.",
    );
    expect(saved.size).toBe(0);
  });

  it('saves a key for a provider whose address has no model list', async () => {
    const { deps, saved } = connectionDeps({
      verifyKey: vi.fn(async () => {
        throw new AdapterError('not_found', 'Modal has nothing at that address (HTTP 404).');
      }),
    });
    expect(await addConnection({ provider: 'modal', key: 'wk-1.ws-2' }, deps)).toEqual({
      secretRef: 'modal',
    });
    expect(saved.get('modal')).toBe('wk-1.ws-2');
  });

  it('asks for the key, and needs none for a local runtime', async () => {
    const { deps } = connectionDeps();
    await expect(addConnection({ provider: 'groq' }, deps)).rejects.toThrow('Paste your Groq key.');
    await expect(addConnection({ provider: 'ollama', key: 'x' }, deps)).rejects.toThrow(
      'runs on this computer and needs no key',
    );
  });

  it('tries an added address with /v1 after it, and binds the key to that host', async () => {
    const host = await fakeServer((request, response) => {
      if (request.url === '/v1/models' && request.headers.authorization === 'Bearer sk-house') {
        return sendJson(response, { data: [{ id: 'house-model' }] });
      }
      sendJson(response, { error: 'not here' }, 404);
    });
    servers.push(host);
    const { deps, saved, endpoints } = connectionDeps({ verifyKey, listModels });
    const result = await addConnection(
      { provider: 'other', baseUrl: `${host.url}/`, key: 'sk-house' },
      deps,
    );
    const ref = `custom:${new URL(host.url).host}`;
    expect(result).toEqual({ secretRef: ref, models: 1 });
    expect(saved.get(ref)).toBe('sk-house');
    expect(endpoints).toEqual([{ baseUrl: `${host.url}/v1`, label: new URL(host.url).host }]);
    expect(host.requests.map((request) => request.path)).toEqual(['/models', '/v1/models']);
  });

  it('adds an endpoint that needs no key, and never sends a key in plain text off this computer', async () => {
    const { deps, saved, endpoints } = connectionDeps();
    expect(
      await addConnection({ provider: 'other', baseUrl: 'http://192.168.1.20:8000/v1' }, deps),
    ).toEqual({ models: 1 });
    expect(endpoints).toEqual([
      { baseUrl: 'http://192.168.1.20:8000/v1', label: '192.168.1.20:8000' },
    ]);

    await expect(
      addConnection(
        { provider: 'other', baseUrl: 'http://192.168.1.20:8000/v1', key: 'sk-1' },
        deps,
      ),
    ).rejects.toThrow('Architect sends a key only over HTTPS');
    expect(deps.verifyKey).not.toHaveBeenCalled();
    expect(saved.size).toBe(0);
  });

  it('says when an added address answers with no model list', async () => {
    const { deps } = connectionDeps({
      listModels: vi.fn(async () => {
        throw new AdapterError('not_found', 'llm.example.com has nothing there (HTTP 404).');
      }),
    });
    await expect(
      addConnection({ provider: 'other', baseUrl: 'https://llm.example.com' }, deps),
    ).rejects.toThrow('llm.example.com has no model list at that address. Check the address.');
  });
});

describe('endpointAddress', () => {
  it('tidies what was typed and refuses what is not an address', () => {
    expect(endpointAddress(' https://llm.example.com/v1/ ')).toBe('https://llm.example.com/v1');
    expect(endpointAddress('http://127.0.0.1:8080?x=1#y')).toBe('http://127.0.0.1:8080');
    expect(() => endpointAddress('llm.example.com')).toThrow('Enter the full address');
    expect(() => endpointAddress('ftp://llm.example.com')).toThrow('https:// or http://');
    expect(() => endpointAddress('https://user:secret@llm.example.com')).toThrow(
      'Put the key in its own field',
    );
  });
});

describe('removeConnection', () => {
  it("forgets a provider's key, and an added endpoint's key and address", async () => {
    const { deps } = connectionDeps();
    await removeConnection({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }, deps);
    expect(deps.clearKey).toHaveBeenCalledWith('openai');

    await removeConnection({ provider: 'other', baseUrl: 'https://llm.example.com/v1' }, deps);
    expect(deps.clearKey).toHaveBeenCalledWith('custom:llm.example.com');
    expect(deps.removeEndpoint).toHaveBeenCalledWith('https://llm.example.com/v1');

    await expect(
      removeConnection({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' }, deps),
    ).rejects.toThrow('Ollama has no key to remove.');
  });
});

describe('under a closed network', () => {
  const network = { allowed: ['spark.lab.internal'] };
  const outside = mentor('https://api.example.com');

  it('refuses a test or a model list outside it before any key is read', async () => {
    const read = vi.fn(keys);
    const allow = () => null;
    const tested = await testMentor(outside, read, allow, network);
    expect(tested).toMatchObject({ ok: false });
    expect(tested.ok ? '' : tested.error).toContain(
      'api.example.com is outside the closed network',
    );
    const student = await testStudent(
      {
        runtime: 'openai_compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'm',
        contextLength: 16_384,
        secretRef: 'meta',
      },
      read,
      allow,
      network,
    );
    expect(student).toMatchObject({ ok: false });
    await expect(
      listConnectionModels(
        { provider: 'other', baseUrl: 'https://api.example.com/v1', secretRef: 'meta' },
        read,
        allow,
        network,
      ),
    ).rejects.toMatchObject({ code: 'outside_network' });
    expect(read).not.toHaveBeenCalled();
  });

  it('lets a host on this computer through', async () => {
    const server = await modelHost();
    const tested = await testMentor(mentor(server.url), keys, () => null, network);
    expect(tested.ok, tested.ok ? '' : tested.error).toBe(true);
  });
});
