import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecodingSchema, type StudentEndpoint } from '@architect/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngineDeps, followedQuietSettings } from '../src/host/wiring';

/*
 * Quiet local models: the thread cap and the rest a run's student follows are the settings as they
 * stand at each request, so switching quiet mode on or off reaches a student that is already
 * working, and not only the next one made.
 */

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const OLLAMA: StudentEndpoint = {
  runtime: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'muse-glimmer:30b',
  contextLength: 16_384,
};

const HOSTED: StudentEndpoint = {
  runtime: 'openai_compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'meta/muse-glimmer-30b',
  contextLength: 16_384,
};

describe('the settings a student follows', () => {
  it('are the settings themselves, so a change shows at the next request', () => {
    let threads: number | undefined = undefined;
    let share: number | undefined = undefined;
    const { cpuThreads, cooldown } = followedQuietSettings(OLLAMA, {
      localThreads: () => threads,
      localCooldown: () => share,
    });
    if (typeof cpuThreads !== 'function' || typeof cooldown !== 'function') {
      throw new Error('The settings were copied instead of followed.');
    }
    expect([cpuThreads(), cooldown()]).toEqual([undefined, undefined]);
    threads = 4;
    share = 0.75;
    expect([cpuThreads(), cooldown()]).toEqual([4, 0.75]);
  });

  it('are none for a student that is not on Ollama here, or when nothing sets them', () => {
    expect(
      followedQuietSettings(HOSTED, { localThreads: () => 4, localCooldown: () => 0.5 }),
    ).toEqual({});
    expect(followedQuietSettings(OLLAMA, {})).toEqual({});
  });
});

describe('a student made for a run', () => {
  it('is held to the thread cap in force at each request', async () => {
    const asked: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/api/show')) {
        return Response.json({ capabilities: ['completion', 'tools', 'thinking'] });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { options?: Record<string, unknown> };
      asked.push(body.options ?? {});
      const lines = [
        { message: { role: 'assistant', content: 'ok' }, done: false },
        { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
      ];
      return new Response(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, {
        headers: { 'content-type': 'application/x-ndjson' },
      });
    });
    const dataDir = mkdtempSync(join(tmpdir(), 'architect-quiet-'));
    roots.push(dataDir);
    let cap: number | undefined;
    const student = createEngineDeps({
      dataDir,
      getSecret: async () => undefined,
      localThreads: () => cap,
    }).adapters.createStudent(OLLAMA, {});

    const reply = async () => {
      const events = student.chat({
        messages: [{ role: 'user', content: 'Hello.' }],
        tools: [],
        decoding: DecodingSchema.parse({}),
        seed: 1,
      });
      for await (const event of events) void event;
    };
    await reply();
    cap = 4;
    await reply();
    cap = undefined;
    await reply();
    const [before, during, after] = asked;
    expect(before).not.toHaveProperty('num_thread');
    expect(during).toMatchObject({ num_thread: 4 });
    expect(after).not.toHaveProperty('num_thread');
  });
});
