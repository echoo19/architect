import { expect, test } from '@playwright/test';
import type { ExperimentEvent, ExperimentInput } from '@architect/shared';
import { launchApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import { finishExperiments, installExperimentsFake } from './fixtures-experiments';
import { recordedComparisonReport } from './recorded';

/*
 * The experiments channels end to end through the bridge, on the stand-in engine screens build
 * against (decision 074): a plan is frozen by preregistering it, runs, and shows locked results
 * only once its tests are released.
 */

const INPUT: ExperimentInput = {
  name: 'Returns desk, mentoring against bare',
  jobDir: 'C:/jobs/returns-desk',
  arms: [{ arm: 'bare' }, { arm: 'draft' }, { arm: 'targeted', sparkUsd: 1.35 }],
  seeds: { mentoring: 1, lockedTest: [101] },
  rounds: 2,
  caps: { studentUsd: 7.5, sparkUsd: 2.5, computeUsd: 0, wallMinutes: 720 },
};

type Watched = Window & { experimentEvents: ExperimentEvent[] };

test('an experiment is planned, frozen, run and read through the bridge', async () => {
  const launched = await launchApp();
  try {
    const { app, page } = launched;
    await stubEngine(app, EMPTY_ENGINE);
    await installExperimentsFake(app, await recordedComparisonReport());
    await page.evaluate(() => {
      const watched = window as unknown as Watched;
      watched.experimentEvents = [];
      window.architect.experiments.onEvent((event) => watched.experimentEvents.push(event));
    });

    const planned = await page.evaluate((input) => window.architect.experiments.plan(input), INPUT);
    expect(planned.experiment.status).toBe('draft');
    expect(planned.report).toBeNull();
    const { id } = planned.experiment;

    const frozen = await page.evaluate((id) => window.architect.experiments.preregister(id), id);
    expect(frozen.preregistration?.sha256).toHaveLength(64);
    await expect(
      page.evaluate(([id, input]) => window.architect.experiments.revise(id, input), [
        id,
        INPUT,
      ] as const),
    ).rejects.toThrow(/preregistered/);

    await page.evaluate((id) => window.architect.experiments.start(id, {}), id);
    const running = await page.evaluate((id) => window.architect.experiments.get(id), id);
    expect(running).toMatchObject({ released: false, experiment: { status: 'running' } });
    expect(running.report?.backends).toEqual([]);

    await finishExperiments(app);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as Watched).experimentEvents.map((event) => event.experiment.status),
        ),
      )
      .toEqual(['preregistered', 'running', 'finished']);
    const finished = await page.evaluate((id) => window.architect.experiments.get(id), id);
    expect(finished.released).toBe(true);
    expect(finished.report?.backends.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.architect.experiments.list())).toHaveLength(1);
  } finally {
    await launched.close();
  }
});
