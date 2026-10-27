import type { MentorConfig } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { testMentor, testStudent } from '../../../src/main/connections';
import { fakeServer, sendJson, type FakeServer } from './http';

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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('testMentor', () => {
  it("connects with the key saved under the config's ref", async () => {
    const host = await modelHost();
    const result = await testMentor(mentor(host.url), keys);
    expect(result).toMatchObject({ ok: true });
    expect(host.requests).toEqual([
      { method: 'GET', path: '/v1/models', authorization: 'Bearer sk-test' },
    ]);
  });

  it('says to add a key, without calling the mentor, when none is saved', async () => {
    const host = await modelHost();
    expect(await testMentor(mentor(host.url), noKeys)).toEqual({
      ok: false,
      error: 'No key is saved for Test mentor.',
      hint: 'Add the key in Settings, then test again.',
    });
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
