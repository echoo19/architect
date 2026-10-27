import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { devNoisePilot } from '../src/loop/pilot';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

beforeEach(async () => {
  world = await createWorld();
  engine = openEngine(world);
});

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

async function pilot(seeds?: number[]) {
  const job = await engine.jobs.importFile(world.jobFile);
  return devNoisePilot(
    { jobs: engine.jobs, paths: engine.paths, deps: world.deps, clock: world.clock },
    { jobId: job.id, seeds, seed: 11 },
  );
}

describe('devNoisePilot', () => {
  it('reports the tasks that flip between student seeds and how far dev moves', async () => {
    world.runtime.passes = (task, _harness, seed) =>
      task.type === 'invoice' || (task.id === 'dev-overdue-1' && seed % 2 === 0);
    const report = await pilot([2, 3, 4]);

    expect(report.runs.map((run) => [run.seed, run.score.pass, run.score.total])).toEqual([
      [2, 4, 9],
      [3, 3, 9],
      [4, 4, 9],
    ]);
    expect(report.runs[1]?.perType).toEqual([
      { type: 'invoice', pass: 3, total: 3 },
      { type: 'overdue', pass: 0, total: 3 },
      { type: 'scheduling', pass: 0, total: 3 },
    ]);
    expect(report.tasks.filter((task) => task.flipped)).toEqual([
      { taskId: 'dev-overdue-1', taskType: 'overdue', passes: [true, false, true], flipped: true },
    ]);
    expect(report).toMatchObject({
      flips: 1,
      spread: 1,
      margin: 2,
      marginHolds: true,
      harnessVersion: 0,
    });
    expect(new Set(world.runtime.attempts.map((attempt) => attempt.seed))).toEqual(
      new Set([2, 3, 4]),
    );
  });

  it('says the margin does not hold when noise alone reaches it', async () => {
    world.runtime.passes = (task, _harness, seed) =>
      ['dev-overdue-1', 'dev-scheduling-1'].includes(task.id) && seed % 2 === 0;
    const report = await pilot([2, 3, 4]);
    expect(report).toMatchObject({ flips: 2, spread: 2, marginHolds: false });
  });

  it('derives three different seeds when none are given, and records nothing', async () => {
    const report = await pilot();
    expect(new Set(report.seeds).size).toBe(3);
    expect(engine.store.runs.list()).toEqual([]);
    expect(world.runtime.sandboxesDisposed).toBe(1);
    expect(world.students[0]?.released).toBe(1);
  });

  it('needs at least two different seeds', async () => {
    await expect(pilot([5, 5])).rejects.toThrow('at least two different seeds');
  });
});
