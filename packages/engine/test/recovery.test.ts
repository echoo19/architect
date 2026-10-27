import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredAttempt } from '../src/store/records';
import { hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
const engines: Engine[] = [];

function open(): Engine {
  const engine = openEngine(world);
  engines.push(engine);
  return engine;
}

/** Freezes the engine mid-attempt, as if the process died: nothing more reaches the disk. */
function crashAt(matches: (taskId: string, version: number) => boolean) {
  const crashed = deferred();
  world.runtime.beforeAttempt = (task, ctx) => {
    if (!matches(task.id, ctx.harness.meta.version)) return;
    world.runtime.beforeAttempt = undefined;
    crashed.resolve();
    return new Promise<void>(() => {});
  };
  return crashed.promise;
}

function evaluationKey(attempt: StoredAttempt): string {
  return [
    attempt.split,
    attempt.round,
    attempt.harnessVersion,
    attempt.target,
    attempt.taskId,
  ].join('|');
}

beforeEach(async () => {
  world = await createWorld();
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice', { readyClaim: true }),
      hypothesis('Swap in the overdue rules', 'Service desk.\nfix:overdue'),
    ][call - 1];
});

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  world.cleanup();
});

async function startArchitect(engine: Engine): Promise<string> {
  const job = await engine.jobs.importFile(world.jobFile);
  return (await engine.controller.start(job.id, 'architect', 7)).id;
}

describe('restart recovery', () => {
  it('resumes a run killed mid-round without redoing completed attempts', async () => {
    let trainSeen = 0;
    const crashed = crashAt((taskId) => taskId.startsWith('train-') && ++trainSeen === 3);
    const first = open();
    const runId = await startArchitect(first);
    await crashed;
    first.store.close();
    engines.splice(engines.indexOf(first), 1);

    const second = open();
    const survived = second.store.attempts.list({ runId }).map(evaluationKey);
    expect(survived).toHaveLength(11);
    expect(second.store.runs.get(runId)?.run.status).toBe('running');
    const before = world.runtime.attempts.length;

    second.controller.recover();
    await second.controller.idle();

    const record = second.store.runs.get(runId);
    expect(second.errors).toEqual([]);
    expect(record?.run).toMatchObject({
      status: 'finished',
      stopReason: 'rounds',
      currentVersion: 2,
      devCurrent: { pass: 3, total: 9 },
    });
    const attempts = second.store.attempts.list({ runId });
    expect(attempts).toHaveLength(63);
    expect(new Set(attempts.map(evaluationKey)).size).toBe(63);
    const redone = world.runtime.attempts.slice(before);
    expect(redone).toHaveLength(52);
    const panel = record?.seeds.devPanel;
    expect(redone.some((attempt) => attempt.seed === panel)).toBe(false);
    expect(world.mentor.requests).toHaveLength(2);
    expect(record?.run.totals.attempts).toBe(63);
    expect(second.store.reports.get(runId, 'local')?.test.score).toEqual({ pass: 2, total: 6 });
    expect(
      second.events.some(
        (e) => e.type === 'run.updated' && e.run.id === runId && e.run.status === 'queued',
      ),
    ).toBe(true);
  });

  it('never pays for the same mentor reply twice after a crash', async () => {
    let candidateSeen = 0;
    const crashed = crashAt(
      (taskId, version) => taskId.startsWith('dev-') && version === 2 && ++candidateSeen === 2,
    );
    const first = open();
    const runId = await startArchitect(first);
    await crashed;
    first.store.close();
    engines.splice(engines.indexOf(first), 1);
    expect(world.mentor.requests).toHaveLength(1);

    const second = open();
    expect(second.store.rounds.get(runId, 1)?.round.status).toBe('evaluating');
    second.controller.recover();
    await second.controller.idle();

    expect(world.mentor.requests).toHaveLength(2);
    expect(second.store.costs.list(runId).filter((cost) => cost.role === 'mentor')).toHaveLength(2);
    expect(second.store.lineage.list(runId).map((row) => row.decision)).toEqual([
      'kept',
      'reverted',
    ]);
    const attempts = second.store.attempts.list({ runId });
    expect(new Set(attempts.map(evaluationKey)).size).toBe(attempts.length);
  });

  it('pauses with the reason even when recording the error fails, and can resume', async () => {
    world.runtime.beforeAttempt = (task) => {
      if (task.id.startsWith('dev-')) throw new Error('The student endpoint is not answering.');
    };
    const engine = open();
    const update = engine.store.runs.update.bind(engine.store.runs);
    let broken = true;
    engine.store.runs.update = (record) => {
      if (broken && record.run.status === 'paused') {
        broken = false;
        throw new Error('database is locked');
      }
      update(record);
    };
    const runId = await startArchitect(engine);
    await engine.controller.idle();

    expect(engine.store.runs.get(runId)?.run).toMatchObject({
      status: 'paused',
      error: 'database is locked',
    });
    expect(engine.errors).toEqual([new Error('database is locked')]);
    expect(engine.events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        level: 'error',
        message: expect.stringContaining('database is locked'),
      }),
    );

    world.runtime.beforeAttempt = undefined;
    await engine.controller.resume(runId);
    await engine.controller.idle();
    expect(engine.store.runs.get(runId)?.run.status).toBe('finished');
  });

  it('pauses on an error with the reason, and finishes when resumed', async () => {
    let devSeen = 0;
    world.runtime.beforeAttempt = (task) => {
      if (task.id.startsWith('dev-') && ++devSeen === 4) {
        throw new Error('The student endpoint is not answering.');
      }
    };
    const engine = open();
    const runId = await startArchitect(engine);
    await engine.controller.idle();

    const paused = engine.store.runs.get(runId)?.run;
    expect(paused?.status).toBe('paused');
    expect(paused?.error).toBe('The student endpoint is not answering.');
    expect(engine.store.attempts.list({ runId })).toHaveLength(3);
    expect(
      engine.events.some(
        (e) => e.type === 'log' && e.level === 'error' && e.message.includes('not answering'),
      ),
    ).toBe(true);

    await engine.controller.resume(runId);
    await engine.controller.idle();
    const finished = engine.store.runs.get(runId)?.run;
    expect(finished?.status).toBe('finished');
    expect(finished?.error).toBeUndefined();
    const attempts = engine.store.attempts.list({ runId });
    expect(attempts).toHaveLength(63);
    expect(new Set(attempts.map(evaluationKey)).size).toBe(63);
  });
});
