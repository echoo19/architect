import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardError, type TrainingJobRecord } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bufferSource,
  encodeGguf,
  metadataString,
  parseGgufHeader,
  readGgufHeader,
} from '../src/gguf';
import {
  authorizeCompute,
  buildTrainingDataset,
  computeUsage,
  countsAsRealTraining,
  describeTrainingJob,
  FileTrainingStore,
  STAND_IN_LABEL,
  StandInBackend,
  TrainingWorker,
  writeTrainingDataset,
  type TrainingStore,
} from '../src/training';
import { orderEpisode } from './support/episodes';
import { tinyBaseSpec } from './support/gguf';

const TRAINER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'trainer');
const BASE_REPO = 'meta-models/Muse-Glimmer-30B';
const MINUTE = 60_000;

let dataDir: string;
let now: number;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'architect-training-'));
  now = Date.UTC(2026, 9, 28, 12, 0, 0);
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const base = parseGgufHeader(bufferSource(encodeGguf(tinyBaseSpec({ blocks: 2 }))));

function datasetDir(name: string, order = '1182'): string {
  const dir = join(dataDir, 'datasets', name);
  writeTrainingDataset(
    dir,
    buildTrainingDataset([orderEpisode(`ep-${name}`, {}, order)], { destination: 'local' }),
  );
  return dir;
}

function standIn(options: { failWith?: string } = {}) {
  return new StandInBackend({
    stateDir: join(dataDir, 'training', 'stand-in'),
    baseHeader: () => base,
    now: () => now,
    queueMs: MINUTE,
    runMs: 10 * MINUTE,
    ...options,
  });
}

function worker(options: { store?: TrainingStore; failWith?: string } = {}) {
  return new TrainingWorker({
    store: options.store ?? new FileTrainingStore(dataDir),
    backends: { 'stand-in': standIn(options) },
    trainerDir: TRAINER,
    now: () => now,
    watch: false,
  });
}

const request = (dir: string) => ({
  scope: 'job_returns',
  maxComputeUsd: 0,
  backend: 'stand-in' as const,
  datasetDir: dir,
  baseModel: { repo: BASE_REPO },
});

describe('the stand-in backend', () => {
  it('goes through the whole lifecycle and labels every result as a stand-in', async () => {
    const training = worker();
    const submitted = await training.submit(request(datasetDir('a')));
    expect(submitted).toMatchObject({
      state: 'queued',
      backend: 'stand-in',
      real: false,
      label: STAND_IN_LABEL,
      baseModel: { repo: BASE_REPO, revision: '0'.repeat(40) },
      compute: { flavor: 'stand-in', pricePerHourUsd: 0, usd: 0 },
    });

    now += 30_000;
    expect((await training.poll(submitted.id)).state).toBe('queued');
    now += 2 * MINUTE;
    expect((await training.poll(submitted.id)).state).toBe('running');
    now += 10 * MINUTE;
    const ready = await training.poll(submitted.id);

    expect(ready.state).toBe('ready');
    expect(ready.artifacts).toMatchObject({
      standIn: true,
      revision: null,
      ggufLora: 'artifacts/adapter.gguf',
    });
    expect(ready.artifacts?.files.map((file) => file.kind)).toEqual([
      'peft_config',
      'peft_weights',
      'gguf_lora',
      'manifest',
    ]);
    const jobDir = join(dataDir, 'training', 'jobs', ready.id);
    const adapter = readGgufHeader(join(jobDir, 'artifacts', 'adapter.gguf'));
    expect(metadataString(adapter, 'architect.adapter.kind')).toBe('stand-in');
    expect(
      JSON.parse(readFileSync(join(jobDir, 'artifacts', 'manifest.json'), 'utf8')),
    ).toMatchObject({
      stand_in: true,
      job_id: ready.id,
    });
    expect(countsAsRealTraining(ready)).toBe(false);
    expect(describeTrainingJob(ready)).toBe(
      'Adapter ready. Stand-in: no model is trained, and its adapter changes nothing.',
    );
    expect(ready.history.map((entry) => entry.state)).toEqual([
      'submitting',
      'queued',
      'running',
      'succeeded',
      'ready',
    ]);
    expect(await training.logs(ready.id)).toContain('No model is trained');
  });

  it('never sends the same job twice, unless the first one failed', async () => {
    const dir = datasetDir('a');
    const first = await worker({ failWith: 'out of luck' }).submit(request(dir));
    const again = await worker().submit(request(dir));
    expect(again.id).toBe(first.id);
    expect(readdirSync(join(dataDir, 'training', 'stand-in'))).toHaveLength(1);

    // Two submissions of one dataset at once share one job too.
    const same = worker();
    const second = datasetDir('b', '2002');
    const [x, y] = await Promise.all([same.submit(request(second)), same.submit(request(second))]);
    expect(x.id).toBe(y.id);

    now += 20 * MINUTE;
    const failed = await worker({ failWith: 'out of luck' }).poll(first.id);
    expect(failed).toMatchObject({
      state: 'failed',
      error: { code: 'provider_failed', message: 'out of luck' },
    });
    const retried = await worker().submit(request(dir));
    expect(retried.id).not.toBe(first.id);
  });

  it('picks up an unfinished job after a restart, without sending it again', async () => {
    const dir = datasetDir('a');
    const before = await worker().submit(request(dir));

    // The app restarts: a new worker over the same folder.
    const after = worker();
    expect(after.resume()).toEqual([before.id]);
    now += 15 * MINUTE;
    expect((await after.poll(before.id)).state).toBe('ready');
    expect(readdirSync(join(dataDir, 'training', 'stand-in'))).toHaveLength(1);
    expect(after.resume()).toEqual([]);
  });

  it('finds a job whose submission the app was cut off in, and gives up on one never received', async () => {
    const store = new FileTrainingStore(dataDir);
    let puts = 0;
    const crashing: TrainingStore = {
      list: () => store.list(),
      get: (id) => store.get(id),
      jobDir: (id) => store.jobDir(id),
      put: (record: TrainingJobRecord) => {
        puts += 1;
        // The app dies right after the backend took the job, before the record says so.
        if (puts === 2) throw new Error('The app stopped.');
        store.put(record);
      },
    };
    await expect(worker({ store: crashing }).submit(request(datasetDir('a')))).rejects.toThrow(
      'The app stopped.',
    );
    const [stuck] = store.list();
    expect(stuck?.state).toBe('submitting');

    const restarted = worker();
    expect(restarted.resume()).toEqual([stuck?.id]);
    const found = await restarted.poll(stuck?.id ?? '');
    expect(found.state).toBe('queued');
    expect(found.history.at(-1)?.note).toBe(
      'Found the job the provider received before the app stopped',
    );

    // A record left in "submitting" whose job the backend never got.
    rmSync(join(dataDir, 'training', 'stand-in'), { recursive: true });
    store.put({
      ...found,
      id: 'trn_lost1',
      state: 'submitting',
      provider: null,
      idempotencyKey: 'f'.repeat(64),
    });
    const lost = await restarted.poll('trn_lost1');
    expect(lost).toMatchObject({ state: 'failed', error: { code: 'interrupted' } });
  });

  it('cancels a job on request', async () => {
    const training = worker();
    const job = await training.submit(request(datasetDir('a')));
    expect((await training.cancel(job.id)).state).toBe('cancelling');
    expect((await training.poll(job.id)).state).toBe('cancelled');
    expect(existsSync(join(dataDir, 'training', 'jobs', job.id, 'artifacts'))).toBe(false);
  });
});

describe('the compute budget', () => {
  const record = (
    overrides: Partial<TrainingJobRecord['compute']>,
    state: TrainingJobRecord['state'],
    scope = 'job_a',
  ) =>
    ({
      scope,
      state,
      compute: { authorizedUsd: 0, usd: 0, seconds: 0, ...overrides },
    }) as TrainingJobRecord;

  it('counts finished jobs at what they cost and running ones at what they may still cost', () => {
    const usage = computeUsage(
      [
        record({ usd: 0.6, seconds: 1200 }, 'ready'),
        record({ authorizedUsd: 1.2, usd: 0.3, seconds: 600 }, 'running'),
        record({ usd: 9, seconds: 1 }, 'ready', 'job_b'),
      ],
      'job_a',
      2,
    );
    expect(usage).toEqual({
      maxUsd: 2,
      spentUsd: 0.6,
      reservedUsd: 1.2,
      leftUsd: expect.closeTo(0.2, 9) as unknown as number,
      seconds: 1800,
      jobs: 2,
    });
  });

  it('cuts a job to what is left, and refuses one too short to be worth it', () => {
    const usage = computeUsage([], 'job_a', 1.2);
    expect(authorizeCompute(usage, 1.8, 3 * 3600, 2100, 'one L40S')).toEqual({
      seconds: 2400,
      usd: 1.2,
    });
    expect(authorizeCompute(usage, 1.8, 2200, 2100, 'one L40S')).toEqual({
      seconds: 2200,
      usd: 1.1,
    });
    expect(() =>
      authorizeCompute(computeUsage([], 'job_a', 0.5), 1.8, 3 * 3600, 2100, 'one L40S'),
    ).toThrow(
      new GuardError(
        'budget',
        'The compute budget has $0.50 left, 16 minutes on one L40S; a training job needs at least 35.',
      ),
    );
  });
});
