import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  runComparison,
  type ComparisonConfig,
  type ComparisonRequest,
} from '../src/comparisons';
import { ComparisonFiles } from '../src/comparisons/records';
import { systemClock } from '../src/loop/deps';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { comparisonWorld, RETURNS_DESK, type ComparisonWorld } from './support/comparison-world';

const worlds: ComparisonWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const CONFIG: ComparisonConfig = {
  ...DEFAULT_CONFIG,
  arms: ['bare', 'draft', 'targeted', 'reference', 'repeat'],
  caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, localMinutes: 0 },
  concurrency: 4,
};

function setUp(): { world: ComparisonWorld; request: ComparisonRequest } {
  const world = comparisonWorld({ clock: systemClock });
  worlds.push(world);
  return {
    world,
    request: {
      jobDir: RETURNS_DESK,
      out: world.out,
      config: CONFIG,
      models: DEFAULT_MODELS,
      confirm: true,
      planOnly: false,
    },
  };
}

/** What a comparison paid for: student attempts, Spark's calls, and the arms' runs. */
function paidFor(world: ComparisonWorld) {
  const store = openEngineStore(new DataPaths(join(world.out, 'data')).database);
  try {
    const runs = store.runs.list().filter((run) => run.protocol?.arm !== undefined);
    return {
      attempts: world.runtime.attempts.length,
      sparkCalls: world.mentor.requests.length,
      calibration: new ComparisonFiles(world.out).readSweep('calibration').length,
      runs: runs.map((run) => run.protocol?.arm).sort(),
      stored: runs.reduce((sum, run) => sum + store.attempts.list({ runId: run.run.id }).length, 0),
    };
  } finally {
    store.close();
  }
}

describe('the comparisons runner', () => {
  it('picks up after a crash without paying for any attempt or Spark call twice', async () => {
    const whole = setUp();
    const uninterrupted = await runComparison(whole.request, whole.world.env);
    expect(uninterrupted.outcome).toBe('finished');
    const expected = paidFor(whole.world);
    expect(expected.calibration).toBe(15);

    const { world, request } = setUp();
    // The first start dies at the sixth calibration attempt.
    let calibrated = 0;
    world.runtime.beforeAttempt = () => {
      calibrated += 1;
      if (calibrated === 6) throw new Error('The computer lost power.');
    };
    await expect(runComparison(request, world.env)).rejects.toThrow('The computer lost power.');
    expect(new ComparisonFiles(world.out).readSweep('calibration')).toHaveLength(5);
    world.runtime.beforeAttempt = undefined;

    // The second dies just after the targeted arm's run is made, before it has done anything.
    world.env.log = (line) => {
      if (line.startsWith('Targeted mentoring: started run')) throw new Error('Closed mid-run.');
    };
    await expect(runComparison(request, world.env)).rejects.toThrow('Closed mid-run.');
    world.env.log = () => undefined;

    const resumed = await runComparison(request, world.env);
    expect(resumed.outcome).toBe('finished');
    expect(paidFor(world)).toEqual(expected);
    expect(resumed.report.arms.map((arm) => [arm.arm, arm.status])).toEqual(
      uninterrupted.report.arms.map((arm) => [arm.arm, arm.status]),
    );
    expect(resumed.report.backends[0]?.rows.map((row) => [row.arm, row.scenarios.pass])).toEqual(
      uninterrupted.report.backends[0]?.rows.map((row) => [row.arm, row.scenarios.pass]),
    );
  }, 300_000);

  it('stops for confirmation, spending only on calibration, when the caps cut the plan', async () => {
    const { world, request } = setUp();
    const asked = await runComparison(
      {
        ...request,
        config: { ...CONFIG, caps: { ...CONFIG.caps, studentUsd: 4 } },
        confirm: false,
      },
      world.env,
    );
    expect(asked.outcome).toBe('needs_confirmation');
    const paid = paidFor(world);
    expect(paid).toMatchObject({ calibration: 15, attempts: 15, sparkCalls: 0, runs: [] });
    const projected = Object.fromEntries(
      (asked.report.projection?.arms ?? []).map((arm) => [arm.arm, arm.funded]),
    );
    // $3.06 of the $4 goes to bare and draft; Spark's reference draws on Spark's budget alone.
    expect(projected).toEqual({
      bare: true,
      draft: true,
      targeted: false,
      reference: true,
      repeat: false,
    });
    expect(asked.report.arms.find((arm) => arm.arm === 'targeted')).toMatchObject({
      status: 'not_run',
    });
  }, 300_000);
});
