import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOpenAICompatibleStudent } from '@architect/adapters';
import type { Job, StudentEndpoint } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredRun } from '../src/store/records';
import { hypothesis } from './fakes/adapters';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

/*
 * Bringing a trained model back (decision 086) with a fake OpenAI-compatible server on this
 * computer standing in for the model: no real model, no GPU, no money.
 */

const MODEL = 'tutor-ft-7b';

let world: World;
let engine: Engine;
let server: Server | undefined;

afterEach(async () => {
  await engine.close();
  world.cleanup();
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
    server = undefined;
  });
});

/** The requests a fake model server heard, by path and, for chat, the model it was asked for. */
interface Heard {
  paths: string[];
  chatModels: string[];
}

/** A server that lists its model and answers every chat with one streamed reply. */
async function fakeModelServer(): Promise<{ baseUrl: string; heard: Heard }> {
  const heard: Heard = { paths: [], chatModels: [] };
  server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => parts.push(part));
    request.on('end', () => {
      heard.paths.push(request.url ?? '');
      if (request.url?.endsWith('/models')) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: [{ id: MODEL }] }));
        return;
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as { model: string };
      heard.chatModels.push(body.model);
      response.setHeader('content-type', 'text/event-stream');
      const chunks = [
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'ANSWER: {"ok":true}' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 40, completion_tokens: 6 } },
      ];
      response.end(
        `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
      );
    });
  });
  const open = server;
  await new Promise<void>((resolve) => open.listen(0, '127.0.0.1', resolve));
  const { port } = open.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, heard };
}

async function finishedRun(job?: Partial<Job>): Promise<StoredRun> {
  world = await createWorld({ job });
  engine = openEngine(world);
  const imported = await engine.jobs.importFile(world.jobFile);
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice', { readyClaim: true }),
      hypothesis('Swap in the overdue rules', 'Service desk.\nfix:overdue'),
    ][call - 1];
  const run = await engine.controller.start(imported.id, 'architect', 7);
  await engine.controller.idle();
  expect(engine.errors).toEqual([]);
  const record = engine.store.runs.get(run.id);
  if (!record) throw new Error('The run is missing.');
  return record;
}

/** Real OpenAI-compatible students for the trained endpoint, the fakes for everything else. */
function useRealStudentsOn(baseUrl: string): void {
  const fake = world.deps.adapters.createStudent;
  world.deps.adapters.createStudent = (endpoint: StudentEndpoint, deps) =>
    endpoint.baseUrl === baseUrl
      ? createOpenAICompatibleStudent(endpoint, deps)
      : fake(endpoint, deps);
  // Each attempt asks the student one turn, so the server is what it is asked.
  world.runtime.askStudent = true;
}

describe('qualifying a model trained elsewhere', () => {
  it('runs the frozen harness’s locked test on the local endpoint and files its card apart from the run', async () => {
    const record = await finishedRun();
    const { baseUrl, heard } = await fakeModelServer();
    useRealStudentsOn(baseUrl);
    const before = engine.store.reports.get(record.run.id, 'local');
    const costsBefore = engine.store.costs.list(record.run.id);
    const hashBefore = JSON.stringify(engine.store.runs.get(record.run.id));

    const started = engine.controller.qualify({
      runId: record.run.id,
      endpoint: { baseUrl, model: MODEL, contextLength: 8192 },
    });
    expect(started).toMatchObject({ status: 'testing', model: MODEL, baseUrl });
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    const [done] = engine.store.qualifications.ofJob(record.run.jobId);
    expect(done).toMatchObject({ status: 'finished', model: MODEL, runId: record.run.id });
    // The same locked test the run took: its six tasks, answered by the model on this computer.
    expect(done?.card?.test.score.total).toBe(6);
    expect(done?.card).toMatchObject({
      testedOn: 'local',
      student: {
        label: `${MODEL} (trained elsewhere)`,
        model: MODEL,
        runtime: 'openai_compatible',
      },
      test: { ranOffline: true },
    });
    expect(heard.chatModels).toEqual(Array(6).fill(MODEL));
    expect(heard.paths.every((path) => path.startsWith('/v1/'))).toBe(true);

    // Costs nothing, and the run and its own card are exactly as they were.
    const added = engine.store.costs.list(record.run.id).slice(costsBefore.length);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((cost) => cost.role === 'student' && cost.usd === 0)).toBe(true);
    expect(engine.store.reports.get(record.run.id, 'local')).toEqual(before);
    expect(JSON.stringify(engine.store.runs.get(record.run.id))).toBe(hashBefore);
    expect(
      engine.store.attempts
        .list({ runId: record.run.id, split: 'test' })
        .filter((attempt) => !attempt.config?.includes('trained:')),
    ).toHaveLength(6);

    // A finished qualification is evidence: it cannot be changed.
    expect(() => engine.store.qualifications.update({ ...done!, status: 'paused' })).toThrow(
      /evidence/,
    );
  });

  it('accepts localhost and [::1] and refuses everything that is not on this computer', async () => {
    const record = await finishedRun();
    const refused = async (baseUrl: string) => {
      await expect(async () =>
        engine.controller.qualify({
          runId: record.run.id,
          endpoint: { baseUrl, model: MODEL, contextLength: 8192 },
        }),
      ).rejects.toThrow();
    };
    await refused('https://api.together.xyz/v1');
    await refused('http://192.168.1.20:8000/v1');
    await refused('http://10.0.0.4:8000/v1');
    await refused('http://my-box.local:8000/v1');
    await refused('http://127.0.0.1/v1');
    await refused('ftp://127.0.0.1:8000/v1');
    expect(engine.store.qualifications.ofJob(record.run.jobId)).toEqual([]);

    for (const baseUrl of ['http://localhost:8000/v1', 'http://[::1]:8000/v1']) {
      expect(
        engine.controller.qualify({
          runId: record.run.id,
          endpoint: { baseUrl, model: MODEL, contextLength: 8192 },
        }),
      ).toMatchObject({ baseUrl });
    }
    await engine.controller.idle();
  });

  it('pauses with the reason when the server is not answering, and resumes on asking again', async () => {
    const record = await finishedRun();
    const { baseUrl } = await fakeModelServer();
    // The address of a server that is not there.
    const closed = baseUrl.replace(/:\d+/, ':1');
    useRealStudentsOn(closed);
    const request = {
      runId: record.run.id,
      endpoint: { baseUrl: closed, model: MODEL, contextLength: 8192 },
    };
    engine.controller.qualify(request);
    await engine.controller.idle();

    const [paused] = engine.store.qualifications.ofJob(record.run.jobId);
    expect(paused?.status).toBe('paused');
    expect(paused?.error).toBeTruthy();
    expect(
      engine.store.attempts
        .list({ runId: record.run.id, split: 'test' })
        .filter((a) => a.config?.includes('trained:')),
    ).toEqual([]);

    // Asking again for the same model resumes the same record.
    engine.controller.qualify(request);
    await engine.controller.idle();
    expect(engine.store.qualifications.ofJob(record.run.jobId)).toHaveLength(1);
  });

  it('refuses a run that has no frozen harness to test with', async () => {
    const record = await finishedRun();
    const { baseUrl } = await fakeModelServer();
    expect(() =>
      engine.controller.qualify({
        runId: 'run_missing',
        endpoint: { baseUrl, model: MODEL, contextLength: 8192 },
      }),
    ).toThrow(/no run/i);
    expect(record.run.status).toBe('finished');
  });
});
