import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GLIMMER_TRAINING_BASE,
  GuardError,
  type TrainerOutput,
  type TrainingJobRecord,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeGguf, float32Bytes } from '../src/gguf';
import {
  bootstrapScript,
  buildTrainingDataset,
  countsAsRealTraining,
  describeTrainingJob,
  FileTrainingStore,
  HfJobsBackend,
  loadRecipe,
  MIN_JOB_SECONDS,
  TrainingWorker,
  writeTrainingDataset,
  type TrainingStore,
} from '../src/training';
import { HubClient, HubError } from '../src/hub';
import { orderEpisode } from './support/episodes';
import { FAKE_HUB_TOKEN, startFakeHub, type FakeHub } from './support/fake-hub';

const TRAINER = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'trainer');
const BASE_REPO = GLIMMER_TRAINING_BASE.repo;

let dataDir: string;
let hub: FakeHub;
let now: number;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'architect-hf-jobs-'));
  hub = await startFakeHub();
  now = Date.now();
  // The base model's repository, so its revision can be looked up and pinned.
  hub.repos.set(BASE_REPO, { private: false, commits: [] });
  hub.commit(BASE_REPO, { 'config.json': Buffer.from('{}') });
});
afterEach(async () => {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function datasetDir(name: string, order = '1182'): string {
  const dir = join(dataDir, 'datasets', name);
  writeTrainingDataset(
    dir,
    buildTrainingDataset([orderEpisode(`ep-${name}`, {}, order)], { destination: 'remote' }),
  );
  return dir;
}

function setUp(options: { token?: string; store?: TrainingStore } = {}) {
  const token = async () => options.token ?? FAKE_HUB_TOKEN;
  const client = new HubClient({ endpoint: hub.url, token });
  const backend = new HfJobsBackend({
    hub: client,
    recipe: loadRecipe(TRAINER),
    token,
    logWaitMs: 300,
  });
  const store = options.store ?? new FileTrainingStore(dataDir);
  const worker = new TrainingWorker({
    store,
    backends: { 'hf-jobs': backend },
    trainerDir: TRAINER,
    now: () => now,
    watch: false,
  });
  return { worker, backend, store };
}

const request = (dir: string, maxComputeUsd = 10) => ({
  scope: 'job_returns',
  maxComputeUsd,
  backend: 'hf-jobs' as const,
  datasetDir: dir,
  baseModel: { repo: BASE_REPO },
});

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** What a finished job uploads: a converted adapter, the PEFT files and a manifest of hashes. */
function outputsFor(record: TrainingJobRecord, tamper = false): Record<string, Buffer> {
  const adapter = encodeGguf({
    metadata: [
      ['general.architecture', { type: 'string', value: 'muse-glimmer' }],
      ['general.type', { type: 'string', value: 'adapter' }],
      ['adapter.type', { type: 'string', value: 'lora' }],
      ['adapter.lora.alpha', { type: 'float32', value: 32 }],
    ],
    tensors: [
      {
        name: 'blk.0.attn_q.weight.lora_a',
        dims: [64, 16],
        type: 'F32',
        bytes: () => float32Bytes(new Float32Array(64 * 16).fill(0.01)),
      },
      {
        name: 'blk.0.attn_q.weight.lora_b',
        dims: [16, 32],
        type: 'F32',
        bytes: () => float32Bytes(new Float32Array(16 * 32).fill(0.02)),
      },
    ],
  });
  const files: Record<string, Buffer> = {
    'peft/adapter_config.json': Buffer.from('{"r": 16, "lora_alpha": 32}\n'),
    'peft/adapter_model.safetensors': Buffer.from('safetensors bytes'),
    'adapter.gguf': adapter,
  };
  const kinds = {
    'peft/adapter_config.json': 'peft_config',
    'peft/adapter_model.safetensors': 'peft_weights',
    'adapter.gguf': 'gguf_lora',
  } as const;
  const manifest: TrainerOutput = {
    format: 'architect.trainer-output/1',
    job_id: record.id,
    stand_in: false,
    base_model: record.baseModel,
    dataset: {
      sha256: record.dataset.sha256,
      example_count: 1,
      trained_examples: 1,
      trained_tokens: 42,
      skipped: [],
    },
    recipe: record.recipe,
    lora: { r: 16, alpha: 32, target_modules: 'q_proj' },
    converter: { commit: '60eeeb6082c1126bb8bc72902c83123cd056811b', outtype: 'f16' },
    versions: { python: '3.12.3', peft: '0.20.0' },
    metrics: {
      steps: 4,
      loss_first: 1.9,
      loss_last: 0.7,
      train_seconds: 1500,
      convert_seconds: 80,
      stopped_early: false,
    },
    files: Object.entries(files).map(([path, content]) => ({
      path,
      sha256: sha256(content),
      bytes: content.length,
      kind: kinds[path as keyof typeof kinds],
    })),
  };
  if (tamper) files['adapter.gguf'] = Buffer.concat([adapter, Buffer.from('x')]);
  return Object.fromEntries([
    ...Object.entries(files).map(([path, content]) => [`outputs/${path}`, content] as const),
    ['outputs/manifest.json', Buffer.from(JSON.stringify(manifest))],
  ]);
}

const jobPosts = () =>
  hub.requests.filter(
    (entry) => entry.method === 'POST' && /^\/api\/jobs\/[^/]+$/.test(entry.path),
  );

describe('Hugging Face Jobs', () => {
  it('starts the job by fetching its inputs at their commit, then running the recipe', () => {
    const script = bootstrapScript(loadRecipe(TRAINER));
    expect(script).toContain('pip install --no-cache-dir --quiet huggingface_hub==1.33.0');
    expect(script).toContain('revision=os.environ["ARCHITECT_INPUT_REVISION"]');
    expect(script.split('\n').at(-1)).toBe(
      'python pipeline.py --job job.json --inputs /work/inputs --out /work/outputs --upload',
    );
  });

  it('sends a job the way huggingface_hub would: private repo, inputs commit, pinned image, token as a secret', async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a')));
    const recipe = loadRecipe(TRAINER).recipe;

    const repo = `jake/architect-${record.id.replace('_', '-')}`;
    expect(hub.repos.get(repo)?.private).toBe(true);
    const inputs = [...(hub.repos.get(repo)?.commits[0]?.files.keys() ?? [])];
    expect(inputs).toEqual([
      'inputs/job.json',
      'inputs/dataset.json',
      'inputs/examples.jsonl',
      'inputs/recipe.json',
      'inputs/pipeline.py',
      'inputs/train_qlora.py',
      'inputs/chat_spans.py',
    ]);
    const sentJob = JSON.parse(
      hub.repos.get(repo)?.commits[0]?.files.get('inputs/job.json')?.toString() ?? '{}',
    ) as Record<string, unknown>;
    expect(sentJob).toMatchObject({
      job_id: record.id,
      base_model: { repo: BASE_REPO, revision: hub.repos.get(BASE_REPO)?.commits[0]?.sha },
      output: { repo },
    });

    const [post] = jobPosts();
    const spec = JSON.parse(post?.body ?? '{}') as Record<string, unknown>;
    expect(spec).toMatchObject({
      dockerImage: recipe.image,
      flavor: 'l40sx1',
      timeoutSeconds: 3 * 3600,
      arguments: [],
      secrets: { HF_TOKEN: FAKE_HUB_TOKEN },
      environment: {
        ARCHITECT_TRAINING_JOB: record.id,
        ARCHITECT_REPO: repo,
        ARCHITECT_INPUT_REVISION: hub.repos.get(repo)?.commits[0]?.sha,
      },
    });
    expect((spec['command'] as string[]).slice(0, 2)).toEqual(['bash', '-c']);

    expect(record).toMatchObject({
      state: 'queued',
      real: true,
      label: 'Hugging Face Jobs',
      providerUrl: `${hub.url}/jobs/jake/${[...hub.jobs.keys()][0]}`,
      compute: {
        flavor: 'l40sx1',
        pricePerHourUsd: 1.8,
        authorizedSeconds: 10_800,
        authorizedUsd: 5.4,
      },
    });
    // The token goes only into the job's secrets: never into a record or a file on disk.
    const jobDir = join(dataDir, 'training', 'jobs', record.id);
    for (const file of [
      'record.json',
      ...readdirSync(join(jobDir, 'inputs')).map((name) => join('inputs', name)),
    ]) {
      expect(readFileSync(join(jobDir, file), 'utf8')).not.toContain(FAKE_HUB_TOKEN);
    }
  });

  it("downloads a finished job's outputs by hash, without taking the token to the download host", async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a')));
    const [jobId] = [...hub.jobs.keys()];

    now += 20 * 60_000;
    expect((await worker.poll(record.id)).state).toBe('running');
    hub.commit(`jake/architect-${record.id.replace('_', '-')}`, outputsFor(record));
    hub.setStage(jobId ?? '', 'COMPLETED');
    now += 10 * 60_000;
    const ready = await worker.poll(record.id);

    expect(ready.state).toBe('ready');
    expect(ready.artifacts).toMatchObject({
      standIn: false,
      trainSeconds: 1500,
      ggufLora: 'artifacts/adapter.gguf',
    });
    expect(ready.artifacts?.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(ready.compute.seconds).toBeGreaterThanOrEqual(30 * 60 - 5);
    expect(ready.compute.usd).toBeCloseTo((ready.compute.seconds / 3600) * 1.8, 6);
    expect(hub.downloads.map((entry) => entry.authorized)).toEqual([false, false]);
    expect(hub.downloads).toHaveLength(2);
    expect(countsAsRealTraining(ready)).toBe(true);
    expect(describeTrainingJob(ready)).toMatch(
      /^Adapter ready on Hugging Face Jobs\. 1 examples\. 30 min on l40sx1, \$0\.9\d of \$5\.40 allowed\.$/,
    );
  });

  it('refuses outputs that do not match their manifest', async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a')));
    hub.commit(`jake/architect-${record.id.replace('_', '-')}`, outputsFor(record, true));
    hub.setStage([...hub.jobs.keys()][0] ?? '', 'COMPLETED');
    const failed = await worker.poll(record.id);
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'artifacts_invalid' } });
    expect(failed.error?.message).toMatch(/adapter\.gguf doesn't match the hash its job recorded/);
    expect(countsAsRealTraining(failed)).toBe(false);
  });

  it("records a failure in the provider's own words", async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a')));
    hub.setStage([...hub.jobs.keys()][0] ?? '', 'ERROR', 'CUDA out of memory');
    expect(await worker.poll(record.id)).toMatchObject({
      state: 'failed',
      error: { code: 'provider_failed', message: 'CUDA out of memory' },
    });
  });

  it('reads the log so far and cancels on request', async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a')));
    expect(await worker.logs(record.id)).toBe('===== Job started =====\nInstalling packages\n');
    expect((await worker.cancel(record.id)).state).toBe('cancelling');
    expect(hub.requests.some((entry) => entry.path.endsWith('/cancel'))).toBe(true);
    expect((await worker.poll(record.id)).state).toBe('cancelled');
  });

  it('finds the job after a restart that cut off its submission, and never sends it twice', async () => {
    const store = new FileTrainingStore(dataDir);
    let puts = 0;
    const crashing: TrainingStore = {
      list: () => store.list(),
      get: (id) => store.get(id),
      jobDir: (id) => store.jobDir(id),
      put: (record) => {
        puts += 1;
        if (puts === 2) throw new Error('The app stopped.');
        store.put(record);
      },
    };
    const dir = datasetDir('a');
    await expect(setUp({ store: crashing }).worker.submit(request(dir))).rejects.toThrow(
      'The app stopped.',
    );
    expect(jobPosts()).toHaveLength(1);

    const { worker } = setUp();
    const [id] = worker.resume();
    const recovered = await worker.poll(id ?? '');
    expect(recovered).toMatchObject({ state: 'running', provider: { namespace: 'jake' } });
    expect(await worker.submit(request(dir))).toMatchObject({ id });
    expect(jobPosts()).toHaveLength(1);
  });

  it('keeps compute under its cap: cut to what is left, refused when too little, stopped when over', async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a'), 1.2));
    expect(record.compute).toMatchObject({ authorizedSeconds: 2400, authorizedUsd: 1.2 });
    expect(JSON.parse(jobPosts()[0]?.body ?? '{}')).toMatchObject({ timeoutSeconds: 2400 });

    // The first job holds the whole cap while it runs, so a second one can't start.
    const repos = hub.repos.size;
    await expect(worker.submit(request(datasetDir('b', '2002'), 1.2))).rejects.toThrow(GuardError);
    expect(jobPosts()).toHaveLength(1);
    expect(hub.repos.size).toBe(repos);

    // Seen running well past its limit, the worker stops it itself.
    now += (2400 + 200) * 1000;
    const stopping = await worker.poll(record.id);
    expect(stopping.state).toBe('cancelling');
    expect(stopping.history.at(-1)?.note).toBe('Stopped at its compute limit');
    const stopped = await worker.poll(record.id);
    expect(stopped.state).toBe('cancelled');
    // The Hub stops a job at its timeout, so it costs at most what was authorized.
    expect(stopped.compute).toMatchObject({ seconds: 2400, usd: 1.2 });
    expect(worker.usage('job_returns', 1.2)).toMatchObject({
      leftUsd: 0,
      reservedUsd: 0,
      spentUsd: 1.2,
    });

    await expect(worker.submit(request(datasetDir('c', '3003'), 0.5))).rejects.toThrow(
      /a training job needs at least 35/,
    );
    expect(MIN_JOB_SECONDS).toBe(2100);
  });

  it('never lets two jobs sent at once spend the same dollars', async () => {
    const { worker } = setUp();
    const results = await Promise.allSettled([
      worker.submit(request(datasetDir('a'), 6)),
      worker.submit(request(datasetDir('b', '2002'), 6)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { guard: 'budget' },
    });
    expect(jobPosts()).toHaveLength(1);
    expect(worker.usage('job_returns', 6).reservedUsd).toBeCloseTo(5.4, 9);
  });

  it('counts time in the queue as neither cost nor overrun', async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a'), 1.2));
    const [jobId] = [...hub.jobs.keys()];
    hub.setStage(jobId ?? '', 'SCHEDULING');
    now += 4 * 3600 * 1000;
    const waiting = await worker.poll(record.id);
    expect(waiting).toMatchObject({
      state: 'queued',
      compute: { startedAt: null, seconds: 0, usd: 0 },
    });

    hub.setStage(jobId ?? '', 'RUNNING');
    now += 10 * 60_000;
    const running = await worker.poll(record.id);
    expect(running.state).toBe('running');
    expect(running.compute.seconds).toBe(10 * 60);
  });

  it('charges a job the app saw end a day late no more than it was allowed', async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a')));
    hub.commit(`jake/architect-${record.id.replace('_', '-')}`, outputsFor(record));
    hub.setStage([...hub.jobs.keys()][0] ?? '', 'COMPLETED');
    now += 24 * 3600 * 1000;
    const ready = await worker.poll(record.id);
    expect(ready.state).toBe('ready');
    expect(ready.compute).toMatchObject({ seconds: 3 * 3600, usd: 5.4 });
  });

  it('fails a finished job whose outputs never arrived, instead of trying forever', async () => {
    const { worker } = setUp();
    const record = await worker.submit(request(datasetDir('a')));
    hub.setStage([...hub.jobs.keys()][0] ?? '', 'COMPLETED');
    const failed = await worker.poll(record.id);
    expect(failed).toMatchObject({
      state: 'failed',
      error: {
        code: 'artifacts_invalid',
        message: "The job finished, but its outputs aren't in its repository.",
      },
    });
    expect(worker.usage('job_returns', 10).reservedUsd).toBe(0);
  });

  it('says what to do when Hugging Face refuses the token', async () => {
    const { worker } = setUp({ token: 'hf_wrong' });
    const failure = await worker.submit(request(datasetDir('a'))).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HubError);
    expect(failure).toMatchObject({
      code: 'auth',
      hint: 'Check the Hugging Face token in Settings; it needs write access.',
    });
    expect((failure as Error).message).not.toContain('hf_wrong');
    expect(new FileTrainingStore(dataDir).list()).toEqual([]);
  });

  it('refuses a dataset that may not leave this computer', async () => {
    const { worker } = setUp();
    const dir = join(dataDir, 'datasets', 'private');
    writeTrainingDataset(
      dir,
      buildTrainingDataset([orderEpisode('private', { sharing: { remoteTraining: false } })], {
        destination: 'local',
      }),
    );
    await expect(worker.submit(request(dir))).rejects.toMatchObject({ guard: 'permission' });
    expect(jobPosts()).toHaveLength(0);
  });
});
