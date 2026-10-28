import type { Harness, Task } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAND_IN_LABEL } from '../src/training';
import { diagnosis, hypothesis } from './fakes/adapters';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';
import { withStandInTraining, type TrainingWorld } from './support/training-world';

let world: World;
let training: TrainingWorld;
const engines: Engine[] = [];

function open(): Engine {
  const engine = openEngine(world);
  engines.push(engine);
  return engine;
}

/** What an adapter does to the student, when one is applied. */
let adapterEffect: 'harms' | 'helps' | 'nothing' = 'harms';

function passes(subject: Task, harness: Harness, _seed: number, student: string): boolean {
  if (student.includes('@1') && adapterEffect !== 'nothing') return adapterEffect === 'helps';
  return harness.system.includes(`fix:${subject.type}`);
}

async function startArchitect(engine: Engine): Promise<string> {
  const job = await engine.jobs.importFile(world.jobFile);
  return (await engine.controller.start(job.id, 'architect', 7)).id;
}

beforeEach(async () => {
  world = await createWorld();
  training = withStandInTraining(world);
  world.runtime.passes = passes;
  adapterEffect = 'harms';
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
      diagnosis('Train the overdue reading', {
        findings: [{ taskId: 'train-overdue-1' }],
        intervention: { type: 'weights' },
      }),
    ][call - 1];
});

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  world.cleanup();
});

describe('a weights round', () => {
  it('measures the harness change and the adapter apart, and rejects a harmful adapter', async () => {
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    const [harnessRound, weightsRound] = engine.store.experiments.list(runId);
    expect(harnessRound).toMatchObject({ kind: 'harness', disposition: 'kept' });
    expect(weightsRound).toMatchObject({ kind: 'weights', disposition: 'rejected' });
    expect(weightsRound?.reason).toMatch(/^Dev 3\/9 → 0\/9, down 3/);

    const measured = Object.fromEntries(
      (weightsRound?.measurements ?? []).map((item) => [item.label, item]),
    );
    expect(Object.keys(measured)).toEqual(['H1/A0', 'H1/A1', 'H0/A0', 'H0/A1']);
    const adapterId = weightsRound?.inputs.candidateAdapter?.id;
    expect(measured['H1/A0']?.configuration).toEqual({
      harnessVersion: 2,
      actor: 'student',
      backend: 'llama.cpp',
      adapter: null,
    });
    expect(measured['H1/A1']?.configuration).toEqual({
      harnessVersion: 2,
      actor: 'student',
      backend: 'llama.cpp',
      adapter: { id: adapterId, scale: 1 },
    });
    expect(measured['H0/A0']?.configuration.harnessVersion).toBe(1);
    expect(measured['H0/A1']?.configuration.harnessVersion).toBe(1);
    expect(
      ['H1/A0', 'H1/A1', 'H0/A0', 'H0/A1'].map((label) => measured[label]?.score.pass),
    ).toEqual([3, 0, 0, 0]);

    expect(weightsRound?.inputs).toMatchObject({
      baseVersion: 2,
      candidateVersion: 2,
      incumbentAdapter: null,
      candidateAdapter: { standIn: true, label: STAND_IN_LABEL },
      trainingBackend: STAND_IN_LABEL,
    });
    expect(weightsRound?.inputs.datasetSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(weightsRound?.recipe?.name).toBeTruthy();
    expect(weightsRound?.budget.examples).toBe(1);

    // Adapter-on and adapter-off attempts are stored apart, on one server's adapter set.
    const keys = new Set(
      engine.store.attempts.list({ runId, round: 2, split: 'dev' }).map((item) => item.config),
    );
    expect(keys).toEqual(new Set(['student/llama.cpp/none', `student/llama.cpp/${adapterId}@1`]));
    expect(
      world.adapterRequests.every(
        (request) => request.adapters.map((adapter) => adapter.key).join() === adapterId,
      ),
    ).toBe(true);

    // The prior version stays: the run graduates on its kept harness, with no adapter.
    const record = engine.store.runs.get(runId);
    expect(record?.run).toMatchObject({ status: 'finished', currentVersion: 2 });
    expect(record?.run.currentAdapter).toBeUndefined();
    expect(record?.freeze?.configuration?.adapter ?? null).toBeNull();
    expect(training.worker.list()).toHaveLength(1);
  });

  it('never keeps a stand-in adapter, however well it measures', async () => {
    adapterEffect = 'helps';
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();
    const weightsRound = engine.store.experiments.list(runId)[1];
    expect(weightsRound?.disposition).toBe('rejected');
    expect(weightsRound?.gates.find((gate) => gate.gate === 'stand_in')).toMatchObject({
      passed: false,
    });
    expect(weightsRound?.reason).toMatch(/but Its adapter came from the stand-in backend/);
    expect(engine.store.runs.get(runId)?.run.currentAdapter).toBeUndefined();
  });

  it('rejects a stand-in adapter that changes nothing, since a hard gate failed', async () => {
    adapterEffect = 'nothing';
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();
    const weightsRound = engine.store.experiments.list(runId)[1];
    expect(weightsRound?.disposition).toBe('rejected');
    expect(weightsRound?.gates.find((gate) => gate.gate === 'stand_in')?.passed).toBe(false);
  });

  it('is off the menu when the locked test runs on the hosted copy, which loads no adapter', async () => {
    const engine = open();
    const job = await engine.jobs.importFile(world.jobFile);
    const runId = (
      await engine.controller.start(job.id, 'architect', 7, { lockedTestOn: 'hosted' })
    ).id;
    await engine.controller.idle();
    expect(engine.store.interventions.get(runId, 2)?.invalidReason).toBe(
      "A weights intervention isn't possible in this run: This run's locked test runs on the hosted copy of the student, which can't load an adapter.",
    );
  });

  it('is off the menu in the app when only the stand-in backend is set up', async () => {
    training = withStandInTraining(world, { offersStandIn: false });
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();
    expect(engine.store.interventions.get(runId, 2)?.invalidReason).toBe(
      "A weights intervention isn't possible in this run: Only the stand-in backend is set up here, and it trains nothing. Add a Hugging Face token to train an adapter.",
    );
  });

  it('records a training job that failed as an invalid round', async () => {
    world.cleanup();
    world = await createWorld();
    training = withStandInTraining(world, { failWith: 'The GPU ran out of memory.' });
    world.runtime.passes = passes;
    world.mentor.script = (_request, call) =>
      [
        hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
        diagnosis('Train it', {
          findings: [{ taskId: 'train-overdue-1' }],
          intervention: { type: 'weights' },
        }),
      ][call - 1];
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();
    const weightsRound = engine.store.experiments.list(runId)[1];
    expect(weightsRound).toMatchObject({
      disposition: 'invalid',
      reason: 'The training job ended without an adapter: The GPU ran out of memory.',
    });
  });

  it('resumes polling its job after a restart, without sending a second one', async () => {
    world.cleanup();
    world = await createWorld();
    training = withStandInTraining(world, { runMs: 10 * 60_000 });
    world.runtime.passes = passes;
    world.mentor.script = (_request, call) =>
      [
        hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
        diagnosis('Train it', {
          findings: [{ taskId: 'train-overdue-1' }],
          intervention: { type: 'weights' },
        }),
      ][call - 1];
    const first = open();
    const runId = await startArchitect(first);
    await new Promise<void>((resolve) => {
      const stop = first.controller.onEvent((event) => {
        if (event.type === 'run.updated' && event.run.phase === 'training') {
          stop();
          resolve();
        }
      });
    });
    await first.close();
    engines.splice(engines.indexOf(first), 1);
    expect(training.worker.list()).toHaveLength(1);
    const lessonsBefore = training.worker.list()[0]?.dataset.exampleCount;

    // A new engine, with a new worker over the same records, after the job finished.
    training = withStandInTraining(world, { runMs: 10 * 60_000 });
    world.clock.advance(11 * 60_000);
    const second = open();
    expect(second.store.rounds.get(runId, 2)?.round.status).toBe('training');
    second.controller.recover();
    await second.controller.idle();
    expect(second.errors).toEqual([]);
    expect(training.worker.list()).toHaveLength(1);
    expect(training.worker.list()[0]?.dataset.exampleCount).toBe(lessonsBefore);
    expect(second.store.lessons.list({ runId, status: 'verified' })).toHaveLength(1);
    expect(second.store.experiments.list(runId).map((item) => item.kind)).toEqual([
      'harness',
      'weights',
    ]);
  });
});
