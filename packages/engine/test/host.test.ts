import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseReportJson } from '@architect/harness';
import {
  AdapterError,
  CodedError,
  GuardError,
  PublishProgressSchema,
  RunEventSchema,
  type PublishProgress,
  type RunEvent,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectEngine, type EngineClient } from '../src/host/client';
import { createEngineHost, type EngineHost, type EngineHostOptions } from '../src/host/engine-host';
import { HubClient } from '../src/hub';
import { FAKE_HUB_TOKEN, startFakeHub } from './support/fake-hub';
import type { EnginePort } from '../src/host/port';
import { fromErrorPayload, toErrorPayload } from '../src/host/protocol';
import { openEngineStore } from '../src/store/engine-store';
import { DataPaths } from '../src/loop/paths';
import { hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { portPair } from './fakes/ports';
import { createWorld, type World } from './fakes/world';

let world: World;
let host: EngineHost | undefined;
let client: EngineClient | undefined;

beforeEach(async () => {
  world = await createWorld();
});

afterEach(async () => {
  client?.close();
  await host?.close();
  host = undefined;
  client = undefined;
  world.cleanup();
});

async function connect(
  options: Pick<EngineHostOptions, 'hub'> = {},
): Promise<{ client: EngineClient; port: EnginePort; events: RunEvent[] }> {
  host = await createEngineHost({
    dataDir: world.dataDir,
    deps: world.deps,
    clock: world.clock,
    ...options,
  });
  const [hostPort, clientPort] = portPair();
  host.serve(hostPort);
  client = connectEngine(clientPort);
  const events: RunEvent[] = [];
  client.runs.onEvent((event) => events.push(event));
  return { client, port: clientPort, events };
}

function next(client: EngineClient, matches: (event: RunEvent) => boolean): Promise<RunEvent> {
  return new Promise((resolve) => {
    const stop = client.runs.onEvent((event) => {
      if (!matches(event)) return;
      stop();
      resolve(event);
    });
  });
}

/** Sends a raw message on the port and waits for the response with that id. */
function raw(port: EnginePort, message: { id: number } & Record<string, unknown>) {
  return new Promise<Record<string, unknown>>((resolve) => {
    port.onMessage((reply) => {
      const response = reply as Record<string, unknown>;
      if (response.kind === 'response' && response.id === message.id) resolve(response);
    });
    port.postMessage(message);
  });
}

describe('the engine host', () => {
  it('answers requests and streams validated run events over a port', async () => {
    const { client, events } = await connect();
    const job = await client.jobs.createSample();
    expect(job.name).toBe('Service desk');
    expect(await client.jobs.createSample()).toEqual(job);
    expect(await client.jobs.list()).toMatchObject([{ id: job.id, taskCount: 21 }]);

    const graduated = next(client, (event) => event.type === 'graduate.ready');
    const run = await client.runs.start(job.id, { method: 'bare', seed: 1 });
    expect(run).toMatchObject({ status: 'queued', method: 'bare', seed: 1 });
    await graduated;

    const detail = await client.runs.get(run.id);
    expect(detail.run.status).toBe('finished');
    expect(detail.job.id).toBe(job.id);
    expect(detail.recentAttempts).toHaveLength(9);
    expect(detail.recentAttempts.every((attempt) => attempt.split === 'dev')).toBe(true);
    expect(detail.recentAttempts[0]?.prompt).toContain('[dev]');
    expect((await client.runs.list(job.id)).map((listed) => listed.id)).toEqual([run.id]);
    expect(await client.runs.list()).toHaveLength(1);

    const devAttempt = detail.recentAttempts[0];
    expect((await client.runs.trace(devAttempt?.id ?? '')).taskId).toBe(devAttempt?.taskId);
    const testAttempt = events.find(
      (event) => event.type === 'attempt.finished' && event.attempt.split === 'test',
    );
    if (testAttempt?.type !== 'attempt.finished') throw new Error('No test attempt was streamed.');
    await expect(client.runs.trace(testAttempt.attempt.id)).rejects.toThrow(
      'Locked-test traces are not kept',
    );

    expect(await client.reports.get(run.id)).toMatchObject({
      method: 'bare',
      test: { score: { total: 6 } },
    });
    const [graduate] = await client.graduates.list();
    expect(graduate?.manifest.acceptedAt).toBeUndefined();
    const accepted = await client.graduates.accept(run.id);
    expect(accepted.manifest.acceptedAt).toBe(new Date(world.clock.now()).toISOString());
    expect((await client.graduates.list())[0]?.manifest.acceptedAt).toBe(
      accepted.manifest.acceptedAt,
    );
    await expect(client.runs.roundDiff(run.id, 1)).rejects.toThrow('This run has no round 1.');

    expect(events.length).toBeGreaterThan(20);
    expect(events.every((event) => RunEventSchema.safeParse(event).success)).toBe(true);
    const types = events.map((event) => event.type);
    expect(types.indexOf('eval.finished')).toBeLessThan(types.indexOf('graduate.ready'));
  });

  it('offers the ready-made agent only where the build ships it, and copies its data once', async () => {
    const { client } = await connect();
    expect(await client.graduates.hasSampleAgent()).toBe(false);
    await expect(client.graduates.prepareSampleAgent()).rejects.toThrow(
      "The ready-made agent isn't available in this build.",
    );

    const shipped = join(world.root, 'sample-agent');
    await mkdir(join(shipped, 'data'), { recursive: true });
    await writeFile(join(shipped, 'data', 'returns.csv'), 'return_id\nR-1\n', 'utf8');
    await writeFile(join(shipped, 'returns-desk.architect.zip'), 'a package', 'utf8');
    world.deps.sampleAgent = {
      packageFile: join(shipped, 'returns-desk.architect.zip'),
      dataDir: join(shipped, 'data'),
    };
    expect(await client.graduates.hasSampleAgent()).toBe(true);

    const sample = await client.graduates.prepareSampleAgent();
    expect(sample).toEqual({
      package: join(shipped, 'returns-desk.architect.zip'),
      data: join(world.dataDir, 'samples', 'returns-desk', 'data'),
    });
    await writeFile(join(sample.data, 'returns.csv'), 'return_id\nR-1\nR-2\n', 'utf8');
    expect(await client.graduates.prepareSampleAgent()).toEqual(sample);
    expect(await readFile(join(sample.data, 'returns.csv'), 'utf8')).toBe('return_id\nR-1\nR-2\n');
    expect(await readdir(sample.data)).toEqual(['returns.csv']);
  });

  it('keeps every event a run sent, in the order sent, beside its records', async () => {
    const { client, events } = await connect();
    const job = await client.jobs.createSample();
    const graduated = next(client, (event) => event.type === 'graduate.ready');
    const run = await client.runs.start(job.id, { method: 'bare', seed: 1 });
    await graduated;

    const file = new DataPaths(world.dataDir).eventsFile(job.id, run.id);
    const kept = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => RunEventSchema.parse(JSON.parse(line)));
    const seen = events.filter((event) => event.runId === run.id);
    expect(seen.length).toBeGreaterThan(20);
    // Events still on their way to the client when the run graduated are kept too.
    expect(kept.length).toBeGreaterThanOrEqual(seen.length);
    expect(kept.slice(0, seen.length)).toEqual(seen);
    expect(kept.every((event) => event.runId === run.id)).toBe(true);
    // A locked-test attempt's request text is never streamed, so it is never kept either.
    const test = kept.filter(
      (event) => event.type === 'attempt.finished' && event.attempt.split === 'test',
    );
    expect(test.length).toBeGreaterThan(0);
    expect(
      test.every((event) => event.type === 'attempt.finished' && event.prompt === undefined),
    ).toBe(true);
  });

  it('rejects malformed requests with a typed error instead of acting on them', async () => {
    const { client, port } = await connect();
    const invalid = await raw(port, {
      kind: 'request',
      id: 901,
      method: 'runs.start',
      params: [42],
    });
    expect(invalid).toMatchObject({ ok: false, error: { name: 'ValidationError' } });
    const unknown = await raw(port, {
      kind: 'request',
      id: 902,
      method: 'runs.explode',
      params: [],
    });
    expect(unknown).toMatchObject({
      ok: false,
      error: { message: 'There is no "runs.explode" request.' },
    });
    await expect(client.jobs.draftStart('Invoices for a plumber', [])).rejects.toThrow(
      "Drafting a job with the mentor isn't available in this build.",
    );
    await expect(client.reports.get('run_missing')).rejects.toThrow(
      'There is no run "run_missing".',
    );
    await expect(client.reports.list('run_missing')).rejects.toThrow(
      'There is no run "run_missing".',
    );
    await expect(client.runs.get('run_missing')).rejects.toThrow('There is no run "run_missing".');
  });

  it('says what is gone with a code a screen can word, on top of the precise message', async () => {
    const { client } = await connect();
    const job = await client.jobs.createSample();
    const graduated = next(client, (event) => event.type === 'graduate.ready');
    const run = await client.runs.start(job.id, { method: 'bare', seed: 1 });
    await graduated;
    const code = async (request: Promise<unknown>) => {
      const error: unknown = await request.then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(CodedError);
      return (error as CodedError).code;
    };
    expect(await code(client.runs.get('run_missing'))).toBe('run_not_found');
    expect(await code(client.reports.get('run_missing'))).toBe('run_not_found');
    expect(await code(client.jobs.get('job_missing'))).toBe('job_not_found');
    expect(await code(client.mentoring.categories('job_missing'))).toBe('job_not_found');
    expect(await code(client.graduates.settings('grd_missing'))).toBe('agent_not_found');
    expect(await code(client.runs.attempt('att_missing'))).toBe('record_not_found');
    expect(await code(client.mentoring.lessonTrace('les_missing'))).toBe('record_not_found');
    expect(await code(client.runs.roundDiff(run.id, 99))).toBe('record_not_found');
  });

  it('tests a run on the hosted copy when asked, files its card there, and refuses unknown options', async () => {
    const { client, port } = await connect();
    const job = await client.jobs.createSample();
    const graduated = next(client, (event) => event.type === 'graduate.ready');
    const run = await client.runs.start(job.id, {
      method: 'bare',
      seed: 1,
      lockedTestOn: 'hosted',
    });
    await graduated;
    expect(await client.reports.list(run.id)).toEqual(['hosted']);
    expect(await client.reports.get(run.id)).toMatchObject({
      testedOn: 'hosted',
      test: { ranOffline: false },
    });
    expect(await client.reports.get(run.id, 'hosted')).toEqual(await client.reports.get(run.id));
    await expect(client.reports.get(run.id, 'local')).rejects.toThrow(
      "This run's graduate hasn't been tested on the local student.",
    );

    const misspelled = await raw(port, {
      kind: 'request',
      id: 904,
      method: 'runs.start',
      params: [job.id, { method: 'bare', lockedTestOnn: 'hosted' }],
    });
    expect(misspelled).toMatchObject({ ok: false, error: { name: 'ValidationError' } });
    expect(await client.runs.list(job.id)).toHaveLength(1);
  });

  it('re-tests a finished run’s graduate on the other student and files that card too', async () => {
    const { client, port } = await connect();
    const job = await client.jobs.createSample();
    const graduated = next(client, (event) => event.type === 'graduate.ready');
    const run = await client.runs.start(job.id, {
      method: 'bare',
      seed: 1,
      lockedTestOn: 'hosted',
    });
    await graduated;

    const retested = next(
      client,
      (event) => event.type === 'eval.finished' && event.split === 'test',
    );
    await client.runs.retest(run.id, 'local');
    await retested;
    expect(await client.reports.list(run.id)).toEqual(['hosted', 'local']);
    expect(await client.reports.get(run.id)).toMatchObject({ testedOn: 'hosted' });
    expect(await client.reports.get(run.id, 'local')).toMatchObject({
      testedOn: 'local',
      test: { ranOffline: true },
    });
    expect((await client.runs.get(run.id)).run).toMatchObject({ status: 'finished' });
    await expect(client.runs.retest(run.id, 'local')).rejects.toThrow(
      "This run's graduate was already re-tested on the local student.",
    );

    const accepted = await client.graduates.accept(run.id);
    const evidence = await readFile(join(accepted.path, 'evidence', 'report.json'), 'utf8');
    expect(parseReportJson(evidence)).toEqual(await client.reports.get(run.id, 'hosted'));

    const invalid = await raw(port, {
      kind: 'request',
      id: 905,
      method: 'runs.retest',
      params: [run.id, 'cloud'],
    });
    expect(invalid).toMatchObject({ ok: false, error: { name: 'ValidationError' } });
  });

  it('lists the re-tests of a run with where each stands, a paused one with why', async () => {
    const { client } = await connect();
    const job = await client.jobs.createSample();
    const graduated = next(client, (event) => event.type === 'graduate.ready');
    const run = await client.runs.start(job.id, {
      method: 'bare',
      seed: 1,
      lockedTestOn: 'hosted',
    });
    await graduated;
    // A run nobody has put through its test again lists none.
    expect((await client.runs.get(run.id)).retests).toBeUndefined();

    // The computer's model is no longer the frozen build, so the re-test stops and says why.
    world.localDigest = 'sha256:newer';
    const stopped = next(client, (event) => event.type === 'log' && event.level === 'error');
    await client.runs.retest(run.id, 'local');
    await stopped;
    const [paused, ...others] = (await client.runs.get(run.id)).retests ?? [];
    expect(others).toEqual([]);
    expect(paused).toMatchObject({
      target: 'local',
      status: 'paused',
      error: expect.stringContaining("isn't the model this graduate was frozen with"),
    });
    expect(paused?.endedAt).toBeUndefined();

    // Asked again with the right model, it finishes and no longer carries the error.
    world.localDigest = 'sha256:fake';
    const finished = next(
      client,
      (event) => event.type === 'eval.finished' && event.split === 'test',
    );
    await client.runs.retest(run.id, 'local');
    await finished;
    expect((await client.runs.get(run.id)).retests).toEqual([
      {
        target: 'local',
        status: 'finished',
        startedAt: expect.any(String),
        endedAt: expect.any(String),
      },
    ]);
  });

  it('keeps settings per graduate, starting from the job’s write permission', async () => {
    const { client, port } = await connect();
    const job = await client.jobs.createSample();
    const graduated = next(client, (event) => event.type === 'graduate.ready');
    await client.runs.start(job.id, { method: 'bare', seed: 1 });
    const ready = await graduated;
    if (ready.type !== 'graduate.ready') throw new Error('No graduate was announced.');

    expect(await client.graduates.settings(ready.graduateId)).toEqual({ writeMode: 'ask' });
    expect(await client.graduates.updateSettings(ready.graduateId, { writeMode: 'never' })).toEqual(
      {
        writeMode: 'never',
      },
    );
    expect(await client.graduates.settings(ready.graduateId)).toEqual({ writeMode: 'never' });
    const invalid = await raw(port, {
      kind: 'request',
      id: 903,
      method: 'graduates.updateSettings',
      params: [ready.graduateId, { writeMode: 'never', unknown: true }],
    });
    expect(invalid).toMatchObject({ ok: false, error: { name: 'ValidationError' } });
    await expect(client.graduates.settings('grd_missing')).rejects.toThrow(
      'There is no graduate "grd_missing".',
    );
  });

  it('serves Teach this over the port: the overview, sharing, and an improvement in its run', async () => {
    const { client } = await connect();
    const job = await client.jobs.createSample();
    const graduated = next(client, (event) => event.type === 'graduate.ready');
    await client.runs.start(job.id, { method: 'bare', seed: 1 });
    const ready = await graduated;
    if (ready.type !== 'graduate.ready') throw new Error('No graduate was announced.');
    const { graduateId } = ready;

    expect(await client.teach.overview(graduateId)).toEqual({
      graduateId,
      correctionCapUsd: 0.25,
      sharesCorrections: false,
      mentor: 'Spark',
      improve: {
        fromVersion: 1,
        budget: { maxRounds: 2, maxMentorUsd: 5, maxWallMinutes: 60 },
        training: false,
        waits: false,
      },
    });
    expect(await client.teach.shareCorrections(graduateId, true)).toMatchObject({
      sharesCorrections: true,
    });

    // A reply in the workspace, flagged and queued, then Improve agent on it.
    const store = openEngineStore(new DataPaths(world.dataDir).database);
    const at = '2026-10-28T09:00:00.000Z';
    store.chats.insert({
      id: 'cht_1',
      graduateId,
      title: 'Overdue invoices',
      createdAt: at,
      updatedAt: at,
      running: false,
      waiting: false,
      graduateVersion: 1,
    });
    for (const [id, role, text] of [
      ['msg_1', 'user', 'Which invoices are overdue?'],
      ['msg_2', 'agent', 'INV-1 and INV-2 are overdue.'],
    ] as const) {
      store.messages.insert({
        id,
        chatId: 'cht_1',
        role,
        createdAt: at,
        text,
        steps: [],
        blocks: [],
        status: 'done',
        ...(role === 'agent' ? { graduateVersion: 1, trace: [] } : {}),
      });
    }
    store.close();
    world.mentor.script = (request) =>
      request.json?.name === 'correction'
        ? {
            kind: 'weakness',
            lesson: 'Overdue means unpaid and past its due date.',
            reason: 'The rule is in the policy and it still went wrong.',
            instruction: '',
            question: '',
            taskType: 'overdue',
          }
        : hypothesis('Teach the overdue rule', 'Service desk.\nfix:overdue');
    const proposed = await client.teach.propose('cht_1', 'msg_2', {
      wrong: 'INV-1 was paid, so it is not overdue.',
      consent: true,
    });
    await client.teach.queue(proposed.id);
    const candidate = next(client, (event) => event.type === 'graduate.ready');
    const start = await client.teach.improve(graduateId, { maxRounds: 1, maxMentorUsd: 1 });
    expect((await client.runs.get(start.runId)).improves).toEqual({
      graduateId,
      version: 1,
      corrections: [proposed.id],
    });
    await candidate;
    expect((await client.runs.get(start.runId)).run.status).toBe('finished');
    // The version it improved still answers; the new one waits as a candidate.
    expect(
      (await client.graduates.versions(graduateId)).map(({ version, active }) => [version, active]),
    ).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it("streams a publication's progress to the client while publish waits, and then stops", async () => {
    const hub = await startFakeHub();
    try {
      const { client } = await connect({
        hub: new HubClient({ endpoint: hub.url, token: async () => FAKE_HUB_TOKEN }),
      });
      const job = await client.jobs.createSample();
      const graduated = next(client, (event) => event.type === 'graduate.ready');
      await client.runs.start(job.id, { method: 'bare', seed: 1 });
      const ready = await graduated;
      if (ready.type !== 'graduate.ready') throw new Error('No graduate was announced.');

      const heard: PublishProgress[] = [];
      const stop = client.graduates.onPublishProgress((progress) => heard.push(progress));
      const result = await client.graduates.publish(ready.graduateId, {
        repository: 'jake/service-desk',
      });
      expect(result.publication.status).toBe('complete');
      // Every update was sent before the answer, and each one matches its schema.
      expect([...new Set(heard.map((progress) => progress.stage))]).toEqual([
        'connecting',
        'uploading',
        'verifying',
        'describing',
      ]);
      expect(heard.every((progress) => PublishProgressSchema.safeParse(progress).success)).toBe(
        true,
      );
      expect(heard.at(-1)).toMatchObject({
        graduateId: ready.graduateId,
        version: 1,
        repository: 'jake/service-desk',
        stage: 'describing',
      });

      stop();
      const count = heard.length;
      await client.graduates.publish(ready.graduateId, { repository: 'jake/desk-two' });
      expect(heard).toHaveLength(count);
    } finally {
      await hub.close();
    }
  });

  it('carries guard and adapter errors across with their meaning', () => {
    const guard = fromErrorPayload(toErrorPayload(new GuardError('split', 'Refused.')));
    expect(guard).toBeInstanceOf(GuardError);
    expect(guard).toMatchObject({ guard: 'split', message: 'Refused.' });
    const adapter = fromErrorPayload(toErrorPayload(new AdapterError('rate_limit', 'Slow down.')));
    expect(adapter).toMatchObject({ name: 'AdapterError', code: 'rate_limit', retryable: true });
    const plain = fromErrorPayload(toErrorPayload(new TypeError('Nope.')));
    expect(plain).toMatchObject({ name: 'TypeError', message: 'Nope.' });
  });

  it('carries a coded error across with its code, and drops a code it does not know', () => {
    const gone = fromErrorPayload(
      toErrorPayload(new CodedError('run_not_found', 'There is no run "run_1".')),
    );
    expect(gone).toBeInstanceOf(CodedError);
    expect(gone).toMatchObject({ code: 'run_not_found', message: 'There is no run "run_1".' });
    const unknown = fromErrorPayload({
      name: 'CodedError',
      message: 'Newer.',
      code: 'from_the_future',
    });
    expect(unknown).not.toBeInstanceOf(CodedError);
    expect(unknown.message).toBe('Newer.');
  });

  it('resumes a run that was active when the app closed', async () => {
    const first = await connect();
    const job = await first.client.jobs.createSample();
    const reached = deferred();
    let devSeen = 0;
    world.runtime.beforeAttempt = (held, _ctx, options) => {
      if (!held.id.startsWith('dev-') || ++devSeen !== 4) return;
      reached.resolve();
      return new Promise<void>((_, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
      });
    };
    const run = await first.client.runs.start(job.id, { method: 'bare', seed: 1 });
    await reached.promise;
    first.client.close();
    await host?.close();
    world.runtime.beforeAttempt = undefined;

    const second = await connect();
    const graduated = next(second.client, (event) => event.type === 'graduate.ready');
    await graduated;
    expect((await second.client.runs.get(run.id)).run.status).toBe('finished');
    second.client.close();
    await host?.close();
    host = undefined;

    const store = openEngineStore(new DataPaths(world.dataDir).database);
    const attempts = store.attempts.list({ runId: run.id });
    store.close();
    expect(attempts).toHaveLength(15);
    expect(new Set(attempts.map((a) => `${a.split}|${a.taskId}`)).size).toBe(15);
  });
});
