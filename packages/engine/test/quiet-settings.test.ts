import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecodingSchema, type StudentEndpoint } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createEngineDeps } from '../src/host/wiring';

/*
 * Quiet local models: the thread cap and the rests a student follows are the settings as they
 * stand at each request, so switching quiet mode on or off reaches a student that is already
 * working, such as a run's, and not only the next one made.
 */

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ENDPOINT: StudentEndpoint = {
  runtime: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'muse-glimmer:30b',
  contextLength: 16_384,
};

/** A fetch that is Ollama answering one short reply, and remembers what it was asked. */
function fakeOllama() {
  const options: Record<string, unknown>[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/show')) {
      return Response.json({ capabilities: ['completion', 'tools', 'thinking'] });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { options?: Record<string, unknown> };
    options.push(body.options ?? {});
    const lines = [
      { message: { role: 'assistant', content: 'ok' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
    ];
    return new Response(lines.map((line) => JSON.stringify(line)).join('\n') + '\n', {
      headers: { 'content-type': 'application/x-ndjson' },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, options };
}

async function reply(student: ReturnType<ReturnType<typeof deps>['adapters']['createStudent']>) {
  const events = student.chat({
    messages: [{ role: 'user', content: 'Hello.' }],
    tools: [],
    decoding: DecodingSchema.parse({}),
    seed: 1,
  });
  for await (const _event of events) void _event;
}

function deps(settings: {
  threads?: () => number | undefined;
  cooldown?: () => number | undefined;
}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'architect-quiet-'));
  roots.push(dataDir);
  return createEngineDeps({
    dataDir,
    getSecret: async () => undefined,
    ...(settings.threads === undefined ? {} : { localThreads: settings.threads }),
    ...(settings.cooldown === undefined ? {} : { localCooldown: settings.cooldown }),
  });
}

describe('a student made for a run', () => {
  it('is held to the thread cap in force at each request', async () => {
    let cap: number | undefined;
    const ollama = fakeOllama();
    const student = deps({ threads: () => cap }).adapters.createStudent(ENDPOINT, {
      fetch: ollama.fetch,
    });
    await reply(student);
    cap = 4;
    await reply(student);
    cap = undefined;
    await reply(student);
    const [before, during, after] = ollama.options;
    expect(before).not.toHaveProperty('num_thread');
    expect(during).toMatchObject({ num_thread: 4 });
    expect(after).not.toHaveProperty('num_thread');
  });

  it('rests only while quiet mode is on', async () => {
    let share: number | undefined;
    const rests: number[] = [];
    const ollama = fakeOllama();
    const student = deps({ cooldown: () => share }).adapters.createStudent(ENDPOINT, {
      fetch: ollama.fetch,
      rest: async (ms) => {
        rests.push(ms);
      },
    });
    await reply(student);
    share = 0.75;
    await reply(student);
    share = undefined;
    await reply(student);
    expect(rests).toHaveLength(1);
  });
});
