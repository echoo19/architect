import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GLIMMER_TRAINING_BASE,
  type Harness,
  type Task,
  type TrainedAdapter,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bufferSource, encodeGguf, parseGgufHeader } from '../src/gguf';
import { settleExperimentCompute } from '../src/loop/experiments';
import {
  FileTrainingStore,
  loadRecipe,
  StandInBackend,
  trainingDeps,
  TrainingWorker,
  type TrainingBackend,
} from '../src/training';
import { diagnosis, hypothesis } from './fakes/adapters';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';
import { tinyBaseSpec } from './support/gguf';
import { TRAINER_DIR, withStandInTraining } from './support/training-world';

let world: World;
const engines: Engine[] = [];

function open(): Engine {
  const engine = openEngine(world);
  engines.push(engine);
  return engine;
}

const BASE = parseGgufHeader(bufferSource(encodeGguf(tinyBaseSpec({ blocks: 2 }))));

/** Round 1 keeps a harness fix for invoices; round 2 trains weights on an overdue failure. */
function scriptHarnessThenWeights(): void {
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
      diagnosis('Train the overdue reading', {
        findings: [{ taskId: 'train-overdue-1' }],
        intervention: { type: 'weights' },
      }),
    ][call - 1];
}

async function startArchitect(engine: Engine): Promise<string> {
  const job = await engine.jobs.importFile(world.jobFile);
  return (await engine.controller.start(job.id, 'architect', 7)).id;
}

/** Resolves once the run's phase is `phase`. */
function reaches(engine: Engine, runId: string, phase: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = engine.controller.onEvent((event) => {
      if (event.runId === runId && event.type === 'run.updated' && event.run.phase === phase) {
        stop();
        resolve();
      }
    });
  });
}

/** Moves the run's clock a minute at a time until the engine has nothing left to do. */
async function untilIdle(engine: Engine): Promise<void> {
  let idle = false;
  const done = engine.controller.idle().then(() => {
    idle = true;
  });
  while (!idle) {
    world.clock.advance(60_000);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await done;
}

/** A backend with the stand-in's lifecycle under another kind or price, as a test needs. */
function delegate(
  inner: StandInBackend,
  overrides: Partial<Pick<TrainingBackend, 'kind' | 'label'>> & { pricePerHourUsd?: number },
): TrainingBackend {
  return {
    kind: overrides.kind ?? inner.kind,
    real: false,
    label: overrides.label ?? inner.label,
    flavor: (id) =>
      overrides.pricePerHourUsd === undefined
        ? inner.flavor()
        : {
            id,
            label: 'test hardware',
            pricePerHourUsd: overrides.pricePerHourUsd,
            gpuMemoryGb: 48,
          },
    resolveRevision: () => inner.resolveRevision(),
    outputRepo: () => inner.outputRepo(),
    submit: (submission) => inner.submit(submission),
    recover: (id) => inner.recover(id),
    status: (handle) => inner.status(handle),
    logs: (handle) => inner.logs(handle),
    cancel: (handle) => inner.cancel(handle),
    fetchArtifacts: (handle, dir) => inner.fetchArtifacts(handle, dir),
  };
}

/** A worker over the world's data folder with the given backends, wired into its deps. */
function trainWith(
  backends: Partial<Record<TrainingBackend['kind'], TrainingBackend>>,
  current: () => TrainingBackend | null,
): TrainingWorker {
  const store = new FileTrainingStore(world.dataDir);
  const worker = new TrainingWorker({
    store,
    backends,
    trainerDir: TRAINER_DIR,
    now: () => world.clock.now(),
    watch: false,
  });
  world.deps.training = trainingDeps({
    worker,
    store,
    backend: async () => current(),
    baseModel: { repo: GLIMMER_TRAINING_BASE.repo },
    flavor: loadRecipe(TRAINER_DIR).recipe.hardware.flavor,
    datasetsDir: join(world.dataDir, 'training', 'datasets'),
    offersStandIn: true,
  });
  return worker;
}

function standIn(runMs = 0): StandInBackend {
  return new StandInBackend({
    stateDir: join(world.dataDir, 'training', 'stand-in'),
    baseHeader: () => BASE,
    now: () => world.clock.now(),
    runMs,
  });
}

beforeEach(async () => {
  world = await createWorld();
  scriptHarnessThenWeights();
});

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  world.cleanup();
});

describe('a weights round after decision 045', () => {
  it('measures all four configurations on the same seeds after a confirmation', async () => {
    withStandInTraining(world);
    // Any adapter helps, so the first measurement clears the keep limits and is confirmed.
    world.runtime.passes = (subject: Task, harness: Harness, _seed: number, student: string) =>
      student.includes('@1') || harness.system.includes(`fix:${subject.type}`);
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    const weightsRound = engine.store.experiments.list(runId)[1];
    expect(weightsRound?.kind).toBe('weights');
    const measured = weightsRound?.measurements ?? [];
    expect(measured.map((item) => item.label)).toEqual(['H1/A0', 'H1/A1', 'H0/A0', 'H0/A1']);
    expect(weightsRound?.seeds.dev).toHaveLength(2);
    for (const item of measured) {
      expect(item.seeds).toEqual(weightsRound?.seeds.dev);
      // Nine dev tasks under each of the two seeds: every cell pairs with every other.
      expect(item.score.total).toBe(18);
    }
    expect(measured.find((item) => item.label === 'H0/A1')?.provenance).toMatch(
      /and again on new seeds/,
    );
  });

  it('keeps A0 the bare base once an adapter is kept, and measures the incumbent apart', async () => {
    withStandInTraining(world);
    const contents = 'GGUF kept adapter';
    const dir = join(world.dataDir, 'training', 'jobs', 'trn_kept', 'artifacts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'adapter.gguf'), contents);
    const kept: TrainedAdapter = {
      id: 'trn_kept',
      path: 'training/jobs/trn_kept/artifacts/adapter.gguf',
      sha256: createHash('sha256').update(contents).digest('hex'),
      standIn: false,
      label: 'Hugging Face Jobs',
    };
    // The kept adapter does as the harness says; a new one harms.
    world.runtime.passes = (subject, harness, _seed, student) =>
      student.includes('trn_kept@1') || !student.includes('@1')
        ? harness.system.includes(`fix:${subject.type}`)
        : false;
    const engine = open();
    const runId = await startArchitect(engine);
    const record = engine.store.runs.get(runId);
    if (!record) throw new Error('The run is missing.');
    engine.store.runs.update({ ...record, run: { ...record.run, currentAdapter: kept } });
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    const weightsRound = engine.store.experiments.list(runId)[1];
    const byLabel = Object.fromEntries(
      (weightsRound?.measurements ?? []).map((item) => [item.label, item]),
    );
    expect(Object.keys(byLabel)).toEqual(['incumbent', 'H1/A0', 'H1/A1', 'H0/A0', 'H0/A1']);
    expect(byLabel['incumbent']?.configuration.adapter).toEqual({ id: 'trn_kept', scale: 1 });
    expect(byLabel['H1/A0']?.configuration.adapter).toBeNull();
    expect(byLabel['H0/A0']?.configuration.adapter).toBeNull();
    const candidate = weightsRound?.inputs.candidateAdapter?.id;
    expect(byLabel['H1/A1']?.configuration.adapter).toEqual({ id: candidate, scale: 1 });
    // The keep rule judged the candidate against the incumbent as it runs, its adapter on.
    expect(weightsRound?.devBefore).toEqual(byLabel['incumbent']?.score);
    expect(weightsRound?.inputs.incumbentAdapter?.id).toBe('trn_kept');
    const keys = new Set(
      engine.store.attempts.list({ runId, round: 2, split: 'dev' }).map((item) => item.config),
    );
    expect(keys).toEqual(
      new Set([
        'student/llama.cpp/none',
        'student/llama.cpp/trn_kept@1',
        `student/llama.cpp/${candidate}@1`,
      ]),
    );
  });

  it.each([
    ['another backend', 'other'],
    ['no backend at all', 'none'],
  ] as const)(
    'never sends a second job when, after it was sent, %s is set up',
    async (_name, after) => {
      const inner = standIn();
      const other = delegate(inner, { kind: 'hf-jobs', label: 'Another backend' });
      let current: TrainingBackend | null = inner;
      const worker = trainWith({ 'stand-in': inner, 'hf-jobs': other }, () => current);
      const training = world.deps.training;
      if (!training) throw new Error('No training deps.');
      // The app closes after the job was sent and its record written, before the round knew it.
      let crashed = false;
      training.worker = {
        ...training.worker,
        list: () => worker.list(),
        get: (id) => worker.get(id),
        poll: (id, signal) => worker.poll(id, signal),
        cancel: (id, signal) => worker.cancel(id, signal),
        usage: (scope, max) => worker.usage(scope, max),
        submit: async (request, signal) => {
          const sent = await worker.submit(request, signal);
          if (!crashed) {
            crashed = true;
            throw new Error('The app closed while recording the job.');
          }
          return sent;
        },
      };
      const engine = open();
      const runId = await startArchitect(engine);
      await engine.controller.idle();
      expect(engine.store.runs.get(runId)?.run.status).toBe('paused');
      expect(engine.store.rounds.get(runId, 2)?.round.status).toBe('teaching');
      expect(worker.list()).toHaveLength(1);

      // A token appeared meanwhile, or went: new jobs would go elsewhere, or nowhere.
      current = after === 'other' ? other : null;
      await engine.controller.resume(runId);
      await engine.controller.idle();
      expect(worker.list()).toHaveLength(1);
      expect(worker.list()[0]?.backend).toBe('stand-in');
      expect(engine.store.interventions.get(runId, 2)?.trainingJobId).toBe(worker.list()[0]?.id);
      expect(engine.store.experiments.list(runId)[1]?.kind).toBe('weights');
    },
  );

  it('records a stopped round at the most its running job can cost, then settles it once it ends', async () => {
    world.cleanup();
    world = await createWorld({
      job: { budget: { maxRounds: 2, maxMentorUsd: 5, maxWallMinutes: 600, maxComputeUsd: 5.4 } },
    });
    scriptHarnessThenWeights();
    const inner = standIn(60 * 60_000);
    const priced = delegate(inner, { pricePerHourUsd: 1.8 });
    const worker = trainWith({ 'stand-in': priced }, () => priced);
    const engine = open();
    const runId = await startArchitect(engine);
    await reaches(engine, runId, 'training');
    await engine.controller.stop(runId);
    await untilIdle(engine);
    expect(engine.errors).toEqual([]);

    const stopped = engine.store.experiments.list(runId)[1];
    expect(stopped?.disposition).toBe('stopped');
    const job = worker.get(stopped?.inputs.trainingJobId ?? '');
    expect(job.state).toBe('cancelling');
    expect(stopped?.budget.computeSettled).toBe(false);
    expect(stopped?.budget.computeUsd).toBeCloseTo(job.compute.authorizedUsd, 6);
    expect(job.compute.authorizedUsd).toBeCloseTo(5.4, 6);

    // The provider stops the job later; its own time replaces the bound.
    world.clock.advance(60_000);
    const ended = await worker.poll(job.id);
    expect(ended.state).toBe('cancelled');
    const [settled] = settleExperimentCompute(engine.store, world.deps.training, runId);
    expect(settled?.round).toBe(2);
    const after = engine.store.experiments.get(runId, 2);
    expect(after?.budget.computeSettled).toBeUndefined();
    expect(after?.budget.computeUsd).toBeCloseTo(ended.compute.usd, 6);
    expect(after?.budget.computeUsd).toBeLessThan(5.4);
    expect(after?.disposition).toBe('stopped');
  });

  it("refuses an adapter whose file isn't the one its job downloaded and checked", async () => {
    const inner = standIn();
    const worker = trainWith({ 'stand-in': inner }, () => inner);
    const training = world.deps.training;
    if (!training) throw new Error('No training deps.');
    training.worker = {
      ...training.worker,
      list: () => worker.list(),
      get: (id) => worker.get(id),
      submit: (request, signal) => worker.submit(request, signal),
      cancel: (id, signal) => worker.cancel(id, signal),
      usage: (scope, max) => worker.usage(scope, max),
      poll: async (id, signal) => {
        const record = await worker.poll(id, signal);
        // Something changes the file between the download and the round reading it.
        if (record.state === 'ready') appendFileSync(training.adapterPath(record), 'tampered');
        return record;
      },
    };
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    const weightsRound = engine.store.experiments.list(runId)[1];
    expect(weightsRound?.disposition).toBe('invalid');
    expect(weightsRound?.reason).toMatch(
      /^The adapter file isn't the one its training job downloaded and checked: its sha256 begins [0-9a-f]{12}, not [0-9a-f]{12}\.$/,
    );
    expect(weightsRound?.measurements).toEqual([]);
    expect(engine.store.attempts.list({ runId, round: 2, split: 'dev' })).toHaveLength(0);
  });
});
