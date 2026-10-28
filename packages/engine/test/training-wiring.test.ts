import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngineHost } from '../src/host/engine-host';
import { createEngineDeps } from '../src/host/wiring';
import { hostAdapterRuntime } from '../src/local-runtime';
import type { TrainingWorkerApi } from '../src/loop/deps';
import { createWorld, type World } from './fakes/world';
import { TRAINER_DIR } from './support/training-world';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'architect-wiring-'));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe('the training worker in the engine', () => {
  it('offers Hugging Face Jobs only while a token resolves, and the stand-in otherwise', async () => {
    const saved: { token?: string } = {};
    const deps = createEngineDeps({
      dataDir,
      getSecret: async () => undefined,
      trainerDir: TRAINER_DIR,
      huggingFaceToken: async () => saved.token,
    });
    const training = deps.training;
    if (!training) throw new Error('No training worker was set up.');
    expect(await training.backend()).toEqual({
      kind: 'stand-in',
      real: false,
      pricePerHourUsd: 0,
    });
    saved.token = 'hf_test-token';
    expect(await training.backend()).toEqual({
      kind: 'hf-jobs',
      real: true,
      pricePerHourUsd: 1.8,
    });
    expect(training.datasetDir('run_1', 2)).toBe(
      join(dataDir, 'training', 'datasets', 'run_1', 'round-2'),
    );
    expect(training.worker.list()).toEqual([]);
  });

  it('is left out without a trainer folder, which puts weights off the menu', () => {
    const deps = createEngineDeps({ dataDir, getSecret: async () => undefined });
    expect(deps.training).toBeUndefined();
    expect(deps.adapters.createActor).toBeDefined();
    // An adapter is served only through the process's one runtime, when it is given.
    expect(deps.adapters.createAdapterStudent).toBeUndefined();
    const adapterRuntime = hostAdapterRuntime({
      runtimeDir: join(dataDir, 'runtime'),
      settings: () => ({}),
    });
    const served = createEngineDeps({ dataDir, getSecret: async () => undefined, adapterRuntime });
    expect(served.adapters.createAdapterStudent).toBeDefined();
  });
});

describe('the engine host', () => {
  let world: World;
  afterEach(() => world.cleanup());

  it('resumes unfinished training jobs when it starts and stops watching when it closes', async () => {
    world = await createWorld();
    const calls: string[] = [];
    const worker = {
      resume: () => {
        calls.push('resume');
        return [];
      },
      close: () => calls.push('close'),
    } as unknown as TrainingWorkerApi;
    world.deps.training = {
      worker,
      backend: async () => null,
      baseModel: { repo: 'base' },
      datasetDir: () => dataDir,
      adapterPath: () => dataDir,
      trainedTokens: () => 0,
    };
    const host = await createEngineHost({
      dataDir: world.dataDir,
      deps: world.deps,
      clock: world.clock,
    });
    expect(calls).toEqual(['resume']);
    await host.close();
    expect(calls).toEqual(['resume', 'close']);
  });
});
