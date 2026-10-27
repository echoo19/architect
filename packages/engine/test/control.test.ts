import { existsSync } from 'node:fs';
import type { Job, Task } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { STOPPED_ROUND } from '../src/loop/plan';
import { hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { defaultJob, defaultTasks, task } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

const MINUTE = 60_000;
let world: World;
let engine: Engine;

async function setUp(options: { job?: Partial<Job>; tasks?: Task[] } = {}) {
  world = await createWorld(options);
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
      hypothesis('Add the overdue procedure', 'Service desk.\nfix:invoice\nfix:overdue'),
      hypothesis('Add the scheduling procedure', 'fix:invoice\nfix:overdue\nfix:scheduling'),
    ][call - 1];
  engine = openEngine(world);
  return engine.jobs.importFile(world.jobFile);
}

/** Holds the matching attempt until released; resolves `reached` when it gets there. */
function holdAt(matches: (task: Task, version: number) => boolean) {
  const reached = deferred();
  const release = deferred();
  world.runtime.beforeAttempt = async (held, ctx) => {
    if (!matches(held, ctx.harness.meta.version)) return;
    world.runtime.beforeAttempt = undefined;
    reached.resolve();
    await release.promise;
  };
  return { reached: reached.promise, release: () => release.resolve() };
}

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

describe('pause and resume', () => {
  it('waits for the attempt in flight, and paused time is not counted', async () => {
    const job = await setUp();
    let devSeen = 0;
    const reached = deferred();
    const release = deferred();
    world.runtime.beforeAttempt = async (held) => {
      world.clock.advance(MINUTE);
      if (held.id.startsWith('dev-') && ++devSeen === 3) {
        reached.resolve();
        await release.promise;
      }
    };
    const run = await engine.controller.start(job.id, 'bare', 3);
    await reached.promise;

    let paused = false;
    const pausing = engine.controller.pause(run.id).then(() => (paused = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(paused).toBe(false);
    release.resolve();
    await pausing;

    expect(engine.store.runs.get(run.id)?.run.status).toBe('paused');
    expect(engine.store.attempts.list({ runId: run.id })).toHaveLength(3);
    world.clock.advance(30 * MINUTE);

    await engine.controller.resume(run.id);
    await engine.controller.idle();
    const finished = engine.store.runs.get(run.id)?.run;
    expect(finished?.status).toBe('finished');
    expect(finished?.totals.wallMs).toBe(15 * MINUTE);
    expect(engine.store.reports.get(run.id)?.cost.wallMs).toBe(15 * MINUTE);
    expect(engine.errors).toEqual([]);
  });

  it('runs one at a time; the next run waits its turn', async () => {
    const job = await setUp();
    const first = await engine.controller.start(job.id, 'bare', 1);
    const second = await engine.controller.start(job.id, 'bare', 2);
    expect(engine.store.runs.get(second.id)?.run.status).toBe('queued');
    await engine.controller.idle();
    const firstDone = engine.events.findIndex(
      (e) => e.type === 'graduate.ready' && e.runId === first.id,
    );
    const secondStarts = engine.events.findIndex(
      (e) => e.type === 'attempt.started' && e.runId === second.id,
    );
    expect(firstDone).toBeGreaterThanOrEqual(0);
    expect(secondStarts).toBeGreaterThan(firstDone);
    expect(engine.store.runs.get(second.id)?.run.status).toBe('finished');
  });
});

describe('stop', () => {
  it('ends a run that kept nothing without a locked test', async () => {
    const job = await setUp();
    const hold = holdAt((held) => held.id.startsWith('train-'));
    const run = await engine.controller.start(job.id, 'architect', 7);
    await hold.reached;
    await engine.controller.stop(run.id);
    expect(engine.store.runs.get(run.id)?.run.status).toBe('stopping');
    hold.release();
    await engine.controller.idle();

    const stopped = engine.store.runs.get(run.id)?.run;
    expect(stopped).toMatchObject({ status: 'stopped', phase: 'done', stopReason: 'user' });
    expect(engine.store.rounds.get(run.id, 1)?.round).toMatchObject({
      status: 'failed',
      error: STOPPED_ROUND,
    });
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toEqual([]);
    expect(engine.store.attempts.list({ runId: run.id, split: 'train' })).toHaveLength(1);
    expect(engine.store.reports.get(run.id)).toBeNull();
    expect(engine.store.graduates.forRun(run.id)).toBeNull();
    expect(world.mentor.requests).toHaveLength(0);
    expect(world.vault.opened).toEqual([]);
  });

  it('after a kept change, finishes the step, skips to the locked test and graduates', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 5, maxMentorUsd: 5, maxWallMinutes: 60 } },
    });
    const hold = holdAt((held, version) => held.id.startsWith('train-') && version === 1);
    const run = await engine.controller.start(job.id, 'architect', 7);
    await hold.reached;
    await engine.controller.stop(run.id);
    hold.release();
    await engine.controller.idle();

    const finished = engine.store.runs.get(run.id)?.run;
    expect(finished).toMatchObject({ status: 'finished', stopReason: 'user', currentVersion: 1 });
    expect(engine.store.rounds.get(run.id, 2)?.round.status).toBe('failed');
    expect(world.mentor.requests).toHaveLength(1);
    expect(engine.store.reports.get(run.id)?.test.score).toEqual({ pass: 2, total: 6 });
    expect(engine.store.runs.get(run.id)?.freeze?.harnessVersion).toBe(1);
  });

  it('ends a paused run at once when nothing was kept', async () => {
    const job = await setUp();
    const hold = holdAt((held) => held.id.startsWith('dev-'));
    const run = await engine.controller.start(job.id, 'architect', 7);
    await hold.reached;
    const pausing = engine.controller.pause(run.id);
    hold.release();
    await pausing;
    await engine.controller.stop(run.id);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'stopped',
      stopReason: 'user',
    });
    await engine.controller.idle();
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toEqual([]);
  });
});

describe('budgets during a run', () => {
  it('never starts a mentor call that could cross the dollar cap, and still tests', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 3, maxMentorUsd: 0.01, maxWallMinutes: 60 } },
    });
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(world.mentor.requests).toHaveLength(0);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'finished',
      stopReason: 'usd',
      currentVersion: 0,
    });
    expect(engine.store.rounds.get(run.id, 1)?.round.error).toMatch(
      /could cost up to .* left in the budget/,
    );
    expect(engine.store.reports.get(run.id)?.cost.mentorUsd).toBe(0);
  });

  it('stops training when the wall clock runs out, mid-evaluation, but runs the test', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 3, maxMentorUsd: 5, maxWallMinutes: 5 } },
    });
    world.runtime.beforeAttempt = () => world.clock.advance(2 * MINUTE);
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    const finished = engine.store.runs.get(run.id)?.run;
    expect(finished).toMatchObject({
      status: 'finished',
      stopReason: 'wall_clock',
      devBaseline: null,
    });
    expect(engine.store.attempts.list({ runId: run.id, split: 'dev' })).toHaveLength(3);
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toHaveLength(6);
    expect(world.mentor.requests).toHaveLength(0);
  });

  it('stops when rounds in a row bring no kept change', async () => {
    const job = await setUp({
      job: {
        budget: { maxRounds: 10, maxMentorUsd: 5, maxWallMinutes: 60 },
        evaluation: { trainBatch: 6, minDevGain: 2, maxTypeRegression: 1, patience: 2 },
      },
    });
    world.mentor.script = () => hypothesis('Reword the rules', 'Service desk, reworded.');
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.run.stopReason).toBe('patience');
    expect(engine.store.rounds.list(run.id)).toHaveLength(2);
  });

  it('stops as soon as dev meets the target', async () => {
    const job = await setUp({ job: { requirements: { passRate: 0.3 } } });
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      stopReason: 'target_met',
      devCurrent: { pass: 3, total: 9 },
    });
    expect(world.mentor.requests).toHaveLength(1);
  });
});

describe('the split guard during a run', () => {
  it('refuses a mentor payload that carries a test prompt, logs it, and goes on', async () => {
    const leaky = task('test', 'invoice', 1).prompt;
    const tasks = defaultTasks().map((t) =>
      t.id === 'train-invoice-1' ? { ...t, prompt: `${t.prompt} Same as: ${leaky}` } : t,
    );
    const job = await setUp({
      tasks,
      job: { budget: { ...defaultJob().budget, maxRounds: 1 } },
    });
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(world.mentor.requests).toHaveLength(0);
    expect(engine.store.rounds.get(run.id, 1)?.round).toMatchObject({
      status: 'failed',
      error: 'Refused a mentor call: its payload matched 1 locked test task.',
    });
    expect(
      engine.events.some(
        (e) =>
          e.type === 'log' && e.level === 'error' && e.message.startsWith('Refused a mentor call'),
      ),
    ).toBe(true);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'finished',
      stopReason: 'rounds',
    });
    expect(engine.events.some((e) => e.type === 'mentor.started')).toBe(false);
    expect(existsSync(engine.paths.mentorFile(job.id, run.id, 1))).toBe(false);
  });
});
