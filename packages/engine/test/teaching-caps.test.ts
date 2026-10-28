import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LESSONS_PER_CATEGORY } from '../src/loop/teach';
import { diagnosis, hypothesis } from './fakes/adapters';
import { defaultTasks, task } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

describe('the caps on teaching', () => {
  it('plan no more lessons for one category than it may hold, and say what they set aside', async () => {
    const extra = [3, 4, 5, 6, 7, 8, 9].map((n) => task('train', 'invoice', n));
    world = await createWorld({
      tasks: [...defaultTasks(), ...extra],
      job: {
        evaluation: { trainBatch: 13, minDevGain: 2, maxTypeRegression: 1, patience: 3 },
      },
    });
    world.mentor.script = (_request, call) =>
      [
        diagnosis('Fix invoices', {
          system: 'Service desk.\nfix:invoice',
          findings: [
            { taskId: 'train-invoice-1' },
            { taskId: 'train-invoice-2' },
            { taskId: 'train-invoice-3' },
          ],
          intervention: { practicePerFinding: 3 },
        }),
        hypothesis('Nothing more', 'Service desk.\nfix:invoice\nAgain.'),
      ][call - 1];
    engine = openEngine(world);
    const job = await engine.jobs.importFile(world.jobFile);
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(engine.errors).toEqual([]);
    const teaching = engine.store.interventions.get(run.id, 1)?.teaching;
    expect(teaching?.items).toHaveLength(MAX_LESSONS_PER_CATEGORY);
    expect(teaching?.items.filter((item) => item.kind === 'repair')).toHaveLength(3);
    expect(teaching?.skipped).toEqual([
      expect.objectContaining({
        reason: `its category already has ${MAX_LESSONS_PER_CATEGORY} verified lessons`,
      }),
      expect.objectContaining({
        reason: `its category already has ${MAX_LESSONS_PER_CATEGORY} verified lessons`,
      }),
    ]);
    expect(engine.store.lessons.list({ runId: run.id, round: 1 })).toHaveLength(
      MAX_LESSONS_PER_CATEGORY,
    );
  });
});
