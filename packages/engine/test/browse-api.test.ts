import { join } from 'node:path';
import { CodedError, type RunEvent } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectEngine, type EngineClient } from '../src/host/client';
import { createEngineHost, type EngineHost } from '../src/host/engine-host';
import type { EnginePort } from '../src/host/port';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { portPair } from './fakes/ports';
import { createWorld, type World } from './fakes/world';
import { writeOrgJobFolder } from './support/organizations';

/*
 * What a developer can browse (decision 084): a field's practice and check tasks, its sealed
 * splits by count only, a run's practice and check attempts page by page, and a version's files.
 * Each read is held to never carrying a sealed task, a sealed organization or a locked-test attempt.
 */

let world: World;
let host: EngineHost | undefined;
let client: EngineClient | undefined;
let port: EnginePort;

beforeEach(async () => {
  world = await createWorld();
  host = await createEngineHost({ dataDir: world.dataDir, deps: world.deps, clock: world.clock });
  const [hostPort, clientPort] = portPair();
  host.serve(hostPort);
  port = clientPort;
  client = connectEngine(clientPort);
});

afterEach(async () => {
  client?.close();
  await host?.close();
  host = undefined;
  client = undefined;
  world.cleanup();
});

const api = (): EngineClient => {
  if (!client) throw new Error('Not connected.');
  return client;
};

function finished(runId: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = api().runs.onEvent((event: RunEvent) => {
      if (event.type !== 'graduate.ready' || event.runId !== runId) return;
      stop();
      resolve();
    });
  });
}

/** Sends a raw request on the port, as a page that skipped the client would. */
function raw(method: string, params: unknown[]): Promise<Record<string, unknown>> {
  const id = 9_000 + Math.floor(Math.random() * 1_000);
  return new Promise((resolve) => {
    port.onMessage((reply) => {
      const response = reply as Record<string, unknown>;
      if (response.kind === 'response' && response.id === id) resolve(response);
    });
    port.postMessage({ kind: 'request', id, method, params });
  });
}

describe("a field's tasks", () => {
  it('lists practice and check tasks of the taught organizations only, and the sealed splits by count', async () => {
    const job = await api().jobs.importFile(await writeOrgJobFolder(join(world.root, 'branches')));
    const train = await api().jobs.tasks(job.id, 'train');
    const dev = await api().jobs.tasks(job.id, 'dev');
    expect(train.split === 'train' && train.tasks.length).toBe(train.count);
    expect(dev.split === 'dev' && dev.tasks.length).toBe(dev.count);
    expect(train.count).toBeGreaterThan(0);
    expect(dev.count).toBeGreaterThan(0);
    const listed = [train, dev].flatMap((listing) => ('tasks' in listing ? listing.tasks : []));
    expect(new Set(listed.map((task) => task.org))).toEqual(new Set(['north', 'south']));

    // The test split and the never-seen organization's tasks are counted, never listed.
    expect(await api().jobs.tasks(job.id, 'test')).toEqual({ split: 'test', count: 12 });
    expect(await api().jobs.tasks(job.id, 'calibration')).toEqual({
      split: 'calibration',
      count: 0,
    });

    const everything = JSON.stringify(
      await Promise.all(
        (['train', 'dev', 'calibration', 'test'] as const).map((split) =>
          api().jobs.tasks(job.id, split),
        ),
      ),
    );
    for (const sealed of ['hillcrest', 'Hillcrest', 'HJ-9001', 'test-', 'xfer-']) {
      expect(everything).not.toContain(sealed);
    }
  });

  it('refuses any other split by its code, over the client and over a raw request', async () => {
    const job = await api().jobs.createSample();
    for (const split of ['certify', 'vault', '../test', 'TEST']) {
      const refused = await api()
        .jobs.tasks(job.id, split as 'test')
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refused).toBeInstanceOf(CodedError);
      expect(refused).toMatchObject({ code: 'split_sealed' });
    }
    const response = await raw('jobs.tasks', [job.id, 'certify']);
    expect(response).toMatchObject({ ok: false, error: { code: 'split_sealed' } });
    expect(JSON.stringify(response)).not.toContain('[test');
  });
});

describe("a run's attempts", () => {
  it('pages the practice and check attempts newest first, and never a locked-test attempt', async () => {
    const job = await api().jobs.createSample();
    const run = await api().runs.start(job.id, { method: 'bare', seed: 1 });
    await finished(run.id);

    const page = await api().runs.attempts(run.id);
    expect(page.total).toBe(9);
    expect(page.next).toBeNull();
    expect(page.attempts.every((attempt) => attempt.split === 'dev')).toBe(true);
    expect(page.attempts[0]?.prompt).toContain('[dev]');
    const times = page.attempts.map((attempt) => attempt.createdAt);
    expect(times).toEqual([...times].sort().reverse());

    const store = openEngineStore(new DataPaths(world.dataDir).database);
    const sealed = [
      ...store.attempts.list({ runId: run.id, split: 'test' }),
      ...store.attempts.list({ runId: run.id, split: 'certify' }),
    ].map((attempt) => attempt.id);
    store.close();
    expect(sealed.length).toBeGreaterThan(0);
    expect(page.attempts.some((attempt) => sealed.includes(attempt.id))).toBe(false);
    expect(JSON.stringify(page)).not.toContain('[test');

    const rest = await api().runs.attempts(run.id, { cursor: '5' });
    expect(rest.attempts.map((attempt) => attempt.id)).toEqual(
      page.attempts.slice(5).map((attempt) => attempt.id),
    );
    const passed = await api().runs.attempts(run.id, { passed: true });
    const failed = await api().runs.attempts(run.id, { passed: false });
    expect(passed.total + failed.total).toBe(9);
    expect(passed.attempts.every((attempt) => attempt.check.pass)).toBe(true);
    expect((await api().runs.attempts(run.id, { round: 1 })).total).toBe(0);
    const type = page.attempts[0]?.taskType ?? '';
    const typed = await api().runs.attempts(run.id, { type });
    expect(typed.attempts.every((attempt) => attempt.taskType === type)).toBe(true);

    // A cursor is a position, and nothing else gets through.
    const response = await raw('runs.attempts', [run.id, { cursor: '../test' }]);
    expect(response).toMatchObject({ ok: false });
  });
});

describe("a version's files", () => {
  it("reads a run's harness version and a graduate version's files, the same for the same version", async () => {
    const job = await api().jobs.createSample();
    const run = await api().runs.start(job.id, { method: 'bare', seed: 1 });
    await finished(run.id);
    const graduate = await api().graduates.accept(run.id);

    const ofRun = await api().runs.harnessFiles(run.id, 1);
    const ofVersion = await api().graduates.harnessFiles(graduate.id, graduate.activeVersion);
    expect(ofRun.length).toBeGreaterThan(0);
    expect(ofRun.map((file) => file.path)).toEqual([...ofRun.map((file) => file.path)].sort());
    expect(ofVersion).toEqual(ofRun);
    expect(JSON.stringify(ofVersion)).not.toContain('[test');
    await expect(api().graduates.harnessFiles(graduate.id, 99)).rejects.toThrow();
  });
});
