import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  probeLocal,
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

  it('keeps a confirmed plan: no arm joins it later, and planning again runs nothing', async () => {
    const { world, request } = setUp();
    const small = { ...request, config: { ...CONFIG, arms: ['bare' as const] } };
    expect((await runComparison(small, world.env)).outcome).toBe('finished');
    const before = paidFor(world);
    expect((await runComparison({ ...small, planOnly: true }, world.env)).outcome).toBe('planned');
    expect(paidFor(world)).toEqual(before);
    await expect(
      runComparison({ ...small, config: { ...CONFIG, arms: ['bare', 'draft'] } }, world.env),
    ).rejects.toThrow("This folder's plan was confirmed for bare;");
    await expect(
      runComparison({ ...small, config: { ...small.config, headroom: 1.5 } }, world.env),
    ).rejects.toThrow("This folder's plan was confirmed with other settings (headroom)");
  }, 300_000);

  it("keeps a fixed-size arm whole when prices drift, and drops later arms in 037's order", async () => {
    const { world, request } = setUp();
    // Every attempt after calibration reads and writes half as much again.
    world.runtime.beforeAttempt = () => {
      if (new ComparisonFiles(world.out).readSweep('calibration').length === 15) {
        world.runtime.costScale = 1.5;
      }
    };
    const cap = 11.5;
    const { outcome, report } = await runComparison(
      { ...request, config: { ...CONFIG, caps: { ...CONFIG.caps, studentUsd: cap } } },
      world.env,
    );
    expect(outcome).toBe('finished');
    const arm = (id: string) => report.arms.find((item) => item.arm === id);
    // Bare and draft cost more than their caps foresaw, and still took their locked tests whole.
    expect(arm('bare')).toMatchObject({ status: 'complete' });
    expect(arm('bare')?.spent.studentUsd ?? 0).toBeGreaterThan(arm('bare')?.caps.studentUsd ?? 0);
    expect(arm('draft')).toMatchObject({ status: 'complete' });
    const hosted = report.backends.find((table) => table.backend === 'hosted');
    expect(hosted?.rows.map((row) => [row.arm, row.scenarios.total, row.complete])).toEqual([
      ['bare', 60, true],
      ['draft', 60, true],
    ]);
    // At what attempts cost by then, the credit held for arms 1 and 2 left too little for arm 3.
    expect(arm('targeted')?.status).toBe('not_run');
    expect(arm('targeted')?.reason).toMatch(
      /^It needs \$\d+\.\d\d of student credit at what an attempt has cost so far \(\$0\.0149\)/,
    );
    expect(arm('repeat')?.status).toBe('complete');
    const spent = report.arms.reduce((sum, item) => sum + (item.spent.studentUsd ?? 0), 0);
    const sweeps = new ComparisonFiles(world.out)
      .readSweep('calibration')
      .reduce((sum, attempt) => sum + (attempt.usd ?? 0), 0);
    expect(spent + sweeps).toBeLessThanOrEqual(cap);
  }, 300_000);

  it("pays for repeats only while the credit lasts, priced at what each arm's test cost", async () => {
    const { world, request } = setUp();
    // Locked tests and repeats read and write three times what calibration did.
    world.runtime.lockedTestCostScale = 3;
    const cap = 8;
    const { report } = await runComparison(
      {
        ...request,
        config: {
          ...CONFIG,
          arms: ['bare', 'draft', 'targeted', 'repeat'],
          caps: { ...CONFIG.caps, studentUsd: cap },
        },
      },
      world.env,
    );
    const arm = (id: string) => report.arms.find((item) => item.arm === id);
    expect(arm('targeted')?.status).toBe('not_run');
    expect(arm('repeat')).toMatchObject({
      status: 'stopped',
      reason: "The student credit left didn't pay for the repeat of the one-shot draft arm.",
    });
    const hosted = report.backends.find((table) => table.backend === 'hosted');
    expect(hosted?.repeats.map((row) => row.arm)).toEqual(['bare']);
    const spent = report.arms.reduce((sum, item) => sum + (item.spent.studentUsd ?? 0), 0);
    const sweeps = new ComparisonFiles(world.out)
      .readSweep('calibration')
      .reduce((sum, attempt) => sum + (attempt.usd ?? 0), 0);
    expect(spent + sweeps).toBeLessThanOrEqual(cap);
  }, 300_000);

  it('refuses a second process on the same folder, and takes over a lock its holder left', async () => {
    const { world, request } = setUp();
    mkdirSync(world.out, { recursive: true });
    const lock = join(world.out, '.comparison.lock');
    // A live process holds it: the one that started this test.
    writeFileSync(lock, String(process.ppid));
    await expect(runComparison(request, world.env)).rejects.toThrow(
      `Another comparison process (${process.ppid}) is using`,
    );
    expect(world.runtime.attempts).toHaveLength(0);
    // A process that is gone left it.
    writeFileSync(lock, '99999999');
    const small = { ...request, config: { ...CONFIG, arms: ['bare' as const] } };
    expect((await runComparison(small, world.env)).outcome).toBe('finished');
    expect(existsSync(lock)).toBe(false);
  }, 300_000);

  it('spends nothing when the local build that freezing pins is out of reach', async () => {
    const { world, request } = setUp();
    const { createStudent } = world.env.deps.adapters;
    world.env.deps.adapters.createStudent = (endpoint, options) => {
      const student = createStudent(endpoint, options);
      if (endpoint.runtime !== 'ollama') return student;
      return { ...student, describe: () => Promise.reject(new Error('connect ECONNREFUSED')) };
    };
    await expect(runComparison(request, world.env)).rejects.toThrow(
      /pins this computer's muse-glimmer:30b-iq2 when it freezes, so ollama must be running with it installed; nothing is loaded\. connect ECONNREFUSED/,
    );
    expect(world.runtime.attempts).toHaveLength(0);
    expect(new ComparisonFiles(world.out).readSweep('calibration')).toHaveLength(0);
  }, 300_000);

  it('resumes no arm while it probes this computer', async () => {
    const { world, request } = setUp();
    world.env.log = (line) => {
      if (line.startsWith('Targeted mentoring: started run')) throw new Error('Closed mid-run.');
    };
    await expect(runComparison(request, world.env)).rejects.toThrow('Closed mid-run.');
    world.env.log = () => undefined;
    const before = world.runtime.attempts.length;
    const probed = await probeLocal(request, world.env, { tasks: 3, meter: null });
    expect(probed.attempts).toBe(3);
    // Only the probe's three attempts: the targeted arm's run stayed where it stopped.
    expect(world.runtime.attempts.length).toBe(before + 3);
  }, 300_000);
});
