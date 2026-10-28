import { afterEach, describe, expect, it } from 'vitest';
import { capabilityBreakdown } from '../src/loop/progress';
import { hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { defaultTasks, task } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

/** A finished Architect run with one kept change. */
async function finishedRun(tasks = defaultTasks()) {
  world = await createWorld({
    tasks,
    job: { budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 60 } },
  });
  engine = openEngine(world);
  world.mentor.script = () => hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
  const job = await engine.jobs.importFile(world.jobFile);
  const run = await engine.controller.start(job.id, 'architect', 7);
  await engine.controller.idle();
  expect(engine.store.runs.get(run.id)?.run.status).toBe('finished');
  world.runtime.askStudent = true;
  return run.id;
}

describe('Spark as a reference', () => {
  it('runs on dev with its own cap and configuration, and touches nothing mentoring reads', async () => {
    const runId = await finishedRun();
    const before = engine.store.runs.get(runId);
    const mentorCalls = world.mentor.requests.length;
    const card = engine.store.reports.get(runId, 'local');

    await engine.controller.reference(runId, 'dev', 1);
    await engine.controller.idle();

    const [reference] = engine.store.references.list(runId);
    expect(reference).toMatchObject({
      split: 'dev',
      status: 'finished',
      model: 'fake-mentor-1',
      configKey: 'reference/meta/none',
      maxUsd: 1,
      score: { pass: 3, total: 9 },
    });
    expect(reference?.spentUsd).toBeGreaterThan(0);
    expect(reference?.spentUsd).toBeLessThanOrEqual(1);
    const attempts = engine.store.attempts.list({ runId, config: 'reference/meta/none' });
    expect(attempts).toHaveLength(9);
    expect(attempts.every((attempt) => attempt.split === 'dev')).toBe(true);
    const costs = engine.store.costs.list(runId).filter((cost) => cost.role === 'reference');
    expect(costs).toHaveLength(9);
    // The run, its card, its experiments and the mentor are as they were.
    expect(engine.store.runs.get(runId)?.run.totals).toEqual(before?.run.totals);
    expect(engine.store.reports.get(runId, 'local')).toEqual(card);
    expect(world.mentor.requests).toHaveLength(mentorCalls);
    await expect(engine.controller.reference(runId, 'dev', 1)).rejects.toThrow(
      "Spark was already measured on this run's dev tasks.",
    );
  });

  it("keeps its attempts out of the student's costs and capability numbers", async () => {
    world = await createWorld();
    engine = openEngine(world);
    const job = await engine.jobs.importFile(world.jobFile);
    const run = await engine.controller.start(job.id, 'bare', 7);
    await engine.controller.idle();
    world.runtime.askStudent = true;
    world.runtime.passes = () => true;
    const record = () => {
      const stored = engine.store.runs.get(run.id);
      if (!stored) throw new Error('The run is gone.');
      return stored;
    };
    const studentCosts = () =>
      engine.store.costs.list(run.id).filter((cost) => cost.role === 'student').length;
    const capabilities = async () =>
      capabilityBreakdown(engine.store, record(), await engine.jobs.forRun(record()), null);
    const costsBefore = studentCosts();
    const before = await capabilities();

    await engine.controller.reference(run.id, 'dev', 1);
    await engine.controller.idle();

    expect(engine.store.references.get(run.id, 'dev')?.status).toBe('finished');
    expect(studentCosts()).toBe(costsBefore);
    expect(await capabilities()).toEqual(before);
  });

  it('opens the locked test only after the mentor is released, and leaves the card as it was', async () => {
    const runId = await finishedRun();
    const card = engine.store.reports.get(runId, 'local');
    world.runtime.sequence.length = 0;
    await engine.controller.reference(runId, 'test', 1);
    await engine.controller.idle();
    const [reference] = engine.store.references.list(runId);
    expect(reference).toMatchObject({ split: 'test', status: 'finished' });
    expect(world.runtime.sequence[0]).toBe(`release:${runId}`);
    expect(engine.store.reports.get(runId, 'local')).toEqual(card);
    const studentTest = engine.store.attempts
      .list({ runId, split: 'test' })
      .filter((attempt) => attempt.config === undefined);
    expect(studentTest).toHaveLength(6);
  });

  it('is refused before the run has finished', async () => {
    world = await createWorld();
    engine = openEngine(world);
    world.mentor.script = () =>
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
    const job = await engine.jobs.importFile(world.jobFile);
    const run = await engine.controller.start(job.id, 'architect', 7);
    await expect(engine.controller.reference(run.id, 'test', 1)).rejects.toThrow(
      "Spark runs as a reference only on a finished run's tasks, once its mentoring is over.",
    );
    await engine.controller.idle();
  });

  it('resumes after a crash without repeating an attempt it already made', async () => {
    const runId = await finishedRun();
    const crashed = deferred();
    let seen = 0;
    world.runtime.beforeAttempt = () => {
      seen += 1;
      if (seen !== 4) return;
      crashed.resolve();
      return new Promise<void>(() => {});
    };
    void engine.controller.reference(runId, 'dev', 1);
    await crashed.promise;
    engine.store.close();

    engine = openEngine(world);
    expect(engine.store.references.get(runId, 'dev')?.status).toBe('running');
    world.runtime.beforeAttempt = undefined;
    const before = world.runtime.attempts.length;
    engine.controller.recover();
    await engine.controller.idle();

    expect(engine.errors).toEqual([]);
    expect(engine.store.references.get(runId, 'dev')?.status).toBe('finished');
    expect(engine.store.attempts.list({ runId, config: 'reference/meta/none' })).toHaveLength(9);
    expect(world.runtime.attempts.length - before).toBe(6);
  });

  it('refuses a dev request that would carry a locked test task, and pauses', async () => {
    const leaked = task('test', 'invoice', 1).prompt;
    const tasks = defaultTasks().map((item) =>
      item.id === 'dev-overdue-2' ? { ...item, prompt: `${item.prompt} ${leaked}` } : item,
    );
    const runId = await finishedRun(tasks);
    await engine.controller.reference(runId, 'dev', 1);
    await engine.controller.idle();
    const [reference] = engine.store.references.list(runId);
    expect(reference?.status).toBe('paused');
    expect(reference?.error).toBe('Refused a mentor call: its payload matched 1 locked test task.');
  });
});
