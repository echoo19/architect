import type { Job } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultJob } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

async function setUp(job?: Partial<Job>) {
  world = await createWorld({ job });
  engine = openEngine(world);
  return engine.jobs.importFile(world.jobFile);
}

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

/** The model of the student each locked-test attempt ran on, in the order they ran. */
function testStudents(): string[] {
  const models: string[] = [];
  world.runtime.beforeAttempt = (task, ctx) => {
    if (task.id.startsWith('test-')) models.push(ctx.student.model);
  };
  return models;
}

describe('where the locked test runs', () => {
  it('runs on the local student unless the run asks otherwise', async () => {
    const job = await setUp();
    const models = testStudents();
    const run = await engine.controller.start(job.id, 'bare', 3);
    await engine.controller.idle();

    expect(engine.store.runs.get(run.id)?.lockedTestOn).toBe('local');
    expect(models).toEqual(Array(6).fill('glimmer:test'));
    expect(engine.store.reports.get(run.id)).toMatchObject({
      testedOn: 'local',
      student: { model: 'glimmer:test', runtime: 'ollama', quantization: 'Q4_K_M' },
      test: { ranOffline: true },
    });
  });

  it('runs on the hosted copy when the run asks, and the card says it was not offline', async () => {
    const job = await setUp();
    const models = testStudents();
    const run = await engine.controller.start(job.id, 'bare', 3, { lockedTestOn: 'hosted' });
    await engine.controller.idle();

    expect(engine.store.runs.get(run.id)).toMatchObject({
      run: { status: 'finished' },
      lockedTestOn: 'hosted',
    });
    expect(models).toEqual(Array(6).fill('glimmer-hosted'));
    const attempts = engine.store.attempts.list({ runId: run.id });
    expect(attempts.filter((a) => a.split === 'test').map((a) => a.target)).toEqual(
      Array(6).fill('hosted'),
    );
    expect(attempts.filter((a) => a.split === 'dev').every((a) => a.target === 'local')).toBe(true);
    const card = engine.store.reports.get(run.id);
    expect(card).toMatchObject({ testedOn: 'hosted', test: { ranOffline: false } });
    expect(card?.student).toEqual({
      label: 'Glimmer',
      model: 'glimmer-hosted',
      runtime: 'openai_compatible',
    });
  });

  it('refuses a hosted locked test when the job has no hosted endpoint', async () => {
    const { label, local } = defaultJob().student;
    const job = await setUp({ student: { label, local, trainOn: 'local' } });
    await expect(
      engine.controller.start(job.id, 'bare', 3, { lockedTestOn: 'hosted' }),
    ).rejects.toThrow('"Service desk" has no hosted student endpoint.');
    expect(engine.store.runs.list(job.id)).toEqual([]);
  });
});
