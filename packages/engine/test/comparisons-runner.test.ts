import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { AdapterError } from '@architect/shared';
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
import { CREDIT_REFUSAL, StudentCredit } from '../src/comparisons/spend';
import { systemClock } from '../src/loop/deps';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import {
  comparisonWorld,
  HOME_SERVICES,
  RETURNS_DESK,
  type ComparisonWorld,
} from './support/comparison-world';

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

/** A request for other arms or caps, the rest as `setUp` makes it. */
function asking(request: ComparisonRequest, changes: Partial<ComparisonConfig>): ComparisonRequest {
  return { ...request, config: { ...CONFIG, ...changes } };
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

/** The hosted student's spending as the request journal holds it. */
function journalTotal(world: ComparisonWorld, cap = 1_000): number {
  return new StudentCredit(join(world.out, 'requests.jsonl'), cap, systemClock).total();
}

/** A copy of a job folder in the world's own folder, to change without touching the repo's. */
function copyJob(world: ComparisonWorld, from: string, name: string): string {
  const dir = join(world.root, name);
  cpSync(from, dir, { recursive: true });
  return dir;
}

describe('the comparisons runner', () => {
  it('picks up after a crash without repeating any recorded attempt or Spark call', async () => {
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
      { ...asking(request, { caps: { ...CONFIG.caps, studentUsd: 4 } }), confirm: false },
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
    const small = asking(request, { arms: ['bare'] });
    expect((await runComparison(small, world.env)).outcome).toBe('finished');
    const before = paidFor(world);
    expect((await runComparison({ ...small, planOnly: true }, world.env)).outcome).toBe('planned');
    expect(paidFor(world)).toEqual(before);
    await expect(
      runComparison(asking(request, { arms: ['bare', 'draft'] }), world.env),
    ).rejects.toThrow("This folder's plan was confirmed for bare;");
    await expect(
      runComparison(asking(request, { arms: ['bare'], headroom: 1.5 }), world.env),
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
      asking(request, { caps: { ...CONFIG.caps, studentUsd: cap } }),
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
      /^At what an attempt has cost so far \(\$0\.0149\), it needs \$\d+\.\d\d of the hosted student's budget/,
    );
    expect(arm('repeat')?.status).toBe('complete');
    expect(journalTotal(world)).toBeLessThanOrEqual(cap);
  }, 300_000);

  it("pays for repeats only while the credit lasts, priced at what each arm's test cost", async () => {
    const { world, request } = setUp();
    // Locked tests and repeats read and write three times what calibration did.
    world.runtime.lockedTestCostScale = 3;
    const cap = 8;
    const { report } = await runComparison(
      asking(request, {
        arms: ['bare', 'draft', 'targeted', 'repeat'],
        caps: { ...CONFIG.caps, studentUsd: cap },
      }),
      world.env,
    );
    const arm = (id: string) => report.arms.find((item) => item.arm === id);
    expect(arm('targeted')?.status).toBe('not_run');
    expect(arm('repeat')).toMatchObject({
      status: 'stopped',
      reason: "The hosted student's budget left didn't pay to run the one-shot draft again.",
    });
    const hosted = report.backends.find((table) => table.backend === 'hosted');
    expect(hosted?.repeats.map((row) => row.arm)).toEqual(['bare']);
    expect(journalTotal(world)).toBeLessThanOrEqual(cap);
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
    expect((await runComparison(asking(request, { arms: ['bare'] }), world.env)).outcome).toBe(
      'finished',
    );
    expect(existsSync(lock)).toBe(false);
  }, 300_000);

  it('spends nothing when the local build that freezing pins is out of reach', async () => {
    const { world, request } = setUp();
    const { createStudent } = world.env.deps.adapters;
    world.env.deps.adapters.createStudent = (endpoint, options) => {
      const student = createStudent(endpoint, options);
      if (endpoint.runtime !== 'ollama') return student;
      return {
        label: student.label,
        model: student.model,
        baseUrl: student.baseUrl,
        isLocal: student.isLocal,
        contextLength: student.contextLength,
        chat: (chat, signal) => student.chat(chat, signal),
        describe: () => Promise.reject(new Error('connect ECONNREFUSED')),
        testConnection: () => student.testConnection(),
        release: () => student.release(),
      };
    };
    await expect(runComparison(request, world.env)).rejects.toThrow(
      /pins this computer's muse-glimmer:30b-iq2 when it freezes, so ollama must be running with it installed; nothing is loaded\. connect ECONNREFUSED/,
    );
    expect(world.runtime.attempts).toHaveLength(0);
    expect(new ComparisonFiles(world.out).readSweep('calibration')).toHaveLength(0);
  }, 300_000);

  it('resumes no arm while it probes this computer, and probes nothing without a GPU window', async () => {
    const { world, request } = setUp();
    world.env.log = (line) => {
      if (line.startsWith('Targeted mentoring: started run')) throw new Error('Closed mid-run.');
    };
    await expect(runComparison(request, world.env)).rejects.toThrow('Closed mid-run.');
    world.env.log = () => undefined;
    const before = world.runtime.attempts.length;
    await expect(probeLocal(request, world.env, { tasks: 3, meter: null })).rejects.toThrow(
      /^The GPU window granted to this command is 0 minutes/,
    );
    expect(world.local.started).toHaveLength(0);
    const granted = asking(request, { caps: { ...CONFIG.caps, localMinutes: 10 } });
    const probed = await probeLocal(granted, world.env, { tasks: 3, meter: null });
    expect(probed.attempts).toBe(3);
    // Only the probe's three attempts: the targeted arm's run stayed where it stopped.
    expect(world.runtime.attempts.length).toBe(before + 3);
  }, 300_000);
});

describe('before anything resumes (decision 051)', () => {
  it('resumes nothing until the plan, its inputs and the request check out', async () => {
    const { world, request } = setUp();
    world.env.log = (line) => {
      if (line.startsWith('Targeted mentoring: started run')) throw new Error('Closed mid-run.');
    };
    await expect(runComparison(request, world.env)).rejects.toThrow('Closed mid-run.');
    world.env.log = () => undefined;
    const before = paidFor(world);
    // Planning again reads the plan and stops there: the targeted arm's run stays where it was.
    expect((await runComparison({ ...request, planOnly: true }, world.env)).outcome).toBe(
      'planned',
    );
    expect(paidFor(world)).toEqual(before);
    // A request the plan wasn't confirmed with is refused before anything resumes.
    await expect(runComparison(asking(request, { headroom: 1.5 }), world.env)).rejects.toThrow(
      "This folder's plan was confirmed with other settings (headroom)",
    );
    expect(paidFor(world)).toEqual(before);
    // The request it was confirmed with goes on from there.
    expect((await runComparison(request, world.env)).outcome).toBe('finished');
    expect(paidFor(world).attempts).toBeGreaterThan(before.attempts);
  }, 300_000);

  it('refuses a run whose tasks, data, checker or regression job changed, before spending', async () => {
    const { world, request } = setUp();
    const job = copyJob(world, RETURNS_DESK, 'job');
    const regression = copyJob(world, HOME_SERVICES, 'regression');
    const pinned = { ...request, jobDir: job, regressionJobDir: regression, planOnly: true };
    expect((await runComparison(pinned, world.env)).outcome).toBe('planned');
    const spent = world.runtime.attempts.length;
    const changes: [string, RegExp][] = [
      [join(job, 'tasks.jsonl'), /Returns desk as it was when it began, and its tasks changed/],
      [join(job, 'data', 'policy.md'), /and its data files changed/],
      [join(job, 'checker.js'), /and its checker changed/],
      [join(job, 'job.json'), /and its job\.json changed/],
      [join(regression, 'tasks.jsonl'), /regression check on Service desk as it was then/],
    ];
    for (const [file, message] of changes) {
      const original = readFileSync(file);
      appendFileSync(file, '\n');
      await expect(runComparison(pinned, world.env)).rejects.toThrow(message);
      writeFileSync(file, original);
    }
    await expect(
      runComparison({ ...pinned, regressionJobDir: undefined }, world.env),
    ).rejects.toThrow('pass the same --regression folder');
    expect(world.runtime.attempts.length).toBe(spent);
    // The same files again: the plan goes on.
    expect((await runComparison(pinned, world.env)).outcome).toBe('planned');
  }, 300_000);

  it('stops at once, before anything is paid, when the app has the GPU this run needs', async () => {
    const { world, request } = setUp();
    world.local.busy = 'the workspace is answering a chat with Returns desk';
    const local = asking(request, {
      arms: ['bare'],
      localOllama: true,
      caps: { ...CONFIG.caps, localMinutes: 1_500 },
    });
    await expect(runComparison(local, world.env)).rejects.toThrow(
      'The GPU is busy: the workspace is answering a chat with Returns desk.',
    );
    expect(world.runtime.attempts).toHaveLength(0);
    expect(existsSync(join(world.out, 'requests.jsonl'))).toBe(false);
    // Planning works on the hosted copy alone, and so does a run with no local work.
    expect((await runComparison({ ...local, planOnly: true }, world.env)).outcome).toBe('planned');
    const checks = world.local.checks;
    const hosted = setUp();
    hosted.world.local.busy = world.local.busy;
    const plain = asking(hosted.request, { arms: ['bare'] });
    expect((await runComparison(plain, hosted.world.env)).outcome).toBe('finished');
    expect(hosted.world.local.checks).toBe(0);
    expect(world.local.checks).toBe(checks);
  }, 300_000);

  it("pins the job's files at the folder's first command, before calibration is done", async () => {
    const { world, request } = setUp();
    const job = copyJob(world, RETURNS_DESK, 'job');
    const pinned = { ...request, jobDir: job, planOnly: true };
    // The first command stops partway through calibration, before any plan exists.
    world.runtime.beforeAttempt = () => {
      if (world.runtime.attempts.length === 4) throw new Error('The computer lost power.');
    };
    await expect(runComparison(pinned, world.env)).rejects.toThrow('The computer lost power.');
    world.runtime.beforeAttempt = undefined;
    expect(new ComparisonFiles(world.out).readPlan()).toBeNull();
    const spent = world.runtime.attempts.length;
    appendFileSync(join(job, 'data', 'orders.csv'), '\n');
    await expect(runComparison(pinned, world.env)).rejects.toThrow(
      /Returns desk as it was when it began, and its data files changed/,
    );
    expect(world.runtime.attempts.length).toBe(spent);
  }, 300_000);
});

describe('the test-release barrier (decision 051)', () => {
  it('never starts an arm it dropped, though the credit has room for it once others finish', async () => {
    const { world, request } = setUp();
    // Every attempt after calibration costs half as much again, so the fixed arm is dropped.
    world.runtime.beforeAttempt = () => {
      if (new ComparisonFiles(world.out).readSweep('calibration').length === 15) {
        world.runtime.costScale = 1.5;
      }
    };
    const dropping = asking(request, {
      arms: ['bare', 'draft', 'targeted', 'fixed'],
      caps: { ...CONFIG.caps, studentUsd: 20, sparkUsd: 16 },
    });
    const first = await runComparison(dropping, world.env);
    expect(first.outcome).toBe('finished');
    // Funded by the plan, then dropped while the targeted arm still held its share.
    expect(first.report.projection?.arms.find((arm) => arm.arm === 'fixed')?.funded).toBe(true);
    expect(first.report.arms.find((arm) => arm.arm === 'fixed')).toMatchObject({
      status: 'not_run',
    });
    expect(first.report.arms.find((arm) => arm.arm === 'fixed')?.reason).toMatch(
      /^At what an attempt has cost so far \(\$\d+\.\d+\), it needs \$\d+\.\d\d of the hosted student's budget/,
    );
    expect(first.report.plan.releasedAt).not.toBeNull();
    const before = paidFor(world);
    const again = await runComparison(dropping, world.env);
    expect(paidFor(world)).toEqual(before);
    expect(again.report.arms.find((arm) => arm.arm === 'fixed')?.runId).toBeNull();
  }, 300_000);

  it('pauses for good a run found still developing once a locked result exists', async () => {
    const { world, request } = setUp();
    const small = asking(request, { arms: ['bare', 'draft'] });
    expect((await runComparison(small, world.env)).outcome).toBe('finished');
    // Records changed by hand: a fresh run of the draft arm's job, waiting to develop.
    const paths = new DataPaths(join(world.out, 'data'));
    const store = openEngineStore(paths.database);
    const draft = store.runs.list().find((run) => run.protocol?.arm === 'draft');
    if (draft === undefined) throw new Error('The draft arm has no run.');
    const id = 'run_late';
    cpSync(paths.runJobFile(draft.run.jobId, draft.run.id), paths.runJobFile(draft.run.jobId, id));
    store.runs.insert({
      ...draft,
      run: {
        ...draft.run,
        id,
        status: 'queued',
        phase: 'preparing',
        devBaseline: null,
        devCurrent: null,
        totals: { ...draft.run.totals, attempts: 0, rounds: 0 },
      },
      freeze: null,
    });
    store.close();
    const before = world.runtime.attempts.length;
    const again = await runComparison(small, world.env);
    expect(world.runtime.attempts.length).toBe(before);
    const reopened = openEngineStore(paths.database);
    try {
      expect(reopened.runs.get(id)?.run.status).toBe('paused');
    } finally {
      reopened.close();
    }
    expect(again.report.arms.find((arm) => arm.arm === 'draft')?.reason).toMatch(
      /still developing when the first locked result was released/,
    );
  }, 300_000);
});

describe("the student's credit (decision 051)", () => {
  it('counts a request a crash cut off as spent at its worst, in the plan and the report', async () => {
    const { world, request } = setUp();
    mkdirSync(world.out, { recursive: true });
    appendFileSync(
      join(world.out, 'requests.jsonl'),
      `${JSON.stringify({ event: 'sent', id: 'req_cut', at: new Date().toISOString(), model: 'hosted-student', worstUsd: 0.75 })}\n`,
    );
    const { report } = await runComparison({ ...request, planOnly: true }, world.env);
    const calibration = new ComparisonFiles(world.out)
      .readSweep('calibration')
      .reduce((sum, attempt) => sum + (attempt.usd ?? 0), 0);
    expect(report.projection?.committedUsd).toBeCloseTo(calibration + 0.75, 9);
    expect(report.credit).toMatchObject({ uncertainRequests: 1, requests: 16 });
    expect(report.credit?.uncertainUsd).toBeCloseTo(0.75, 9);
    expect(readFileSync(join(world.out, 'report.md'), 'utf8')).toContain(
      'counted as spent at its worst for 1 requests a crash or a failure cut off',
    );
  }, 300_000);

  it('never lets the hosted spending pass its cap, even when a test costs far more than priced', async () => {
    const { world, request } = setUp();
    // Locked-test attempts read and write twenty times what calibration's did.
    world.runtime.lockedTestCostScale = 20;
    const cap = 3;
    const { outcome, report } = await runComparison(
      asking(request, { arms: ['bare'], caps: { ...CONFIG.caps, studentUsd: cap } }),
      world.env,
    );
    expect(outcome).toBe('incomplete');
    expect(journalTotal(world, cap)).toBeLessThanOrEqual(cap + 1e-9);
    const bare = report.arms.find((arm) => arm.arm === 'bare');
    expect(bare?.status).toBe('incomplete');
    expect(bare?.reason?.startsWith(CREDIT_REFUSAL)).toBe(true);
    const row = report.backends.find((table) => table.backend === 'hosted')?.rows[0];
    expect(row?.complete).toBe(false);
    expect(row?.passTarget.met).toBe(false);
  }, 300_000);

  it('never counts an unknown cost as zero: calls with no usage and no charge stop the plan', async () => {
    const { world, request } = setUp();
    world.runtime.unreported = true;
    await expect(runComparison({ ...request, planOnly: true }, world.env)).rejects.toThrow(
      '15 of 15 calibration attempts have no known cost',
    );
    const credit = new StudentCredit(join(world.out, 'requests.jsonl'), 15, systemClock);
    expect(credit.summary()).toMatchObject({ requests: 15, uncertainRequests: 15 });
    expect(credit.total()).toBeGreaterThan(0);
    expect(new ComparisonFiles(world.out).readPlan()).toBeNull();
  }, 300_000);

  it('prices an attempt at what the provider billed, and records the bill against the list', async () => {
    const { world, request } = setUp();
    // The provider bills three tenths more than the listed price of the same usage.
    world.runtime.billing = 1.3;
    const { report } = await runComparison(asking(request, { arms: ['bare'] }), world.env);
    expect(report.billing).toMatchObject({ calls: 30, billedCalls: 30 });
    expect(report.billing?.ratio).toBeCloseTo(1.3, 9);
    const listed = (30_000 * 0.3 + 800 * 1.2) / 1e6;
    const price = report.projection?.inputs.find((input) => input.name === 'Hosted attempt');
    expect(price?.value).toBeCloseTo(1.3 * listed, 9);
    expect(price?.note).toBe('mean of 15 calibration attempts as the provider billed them');
    // The arm's records hold what was billed, call by call.
    const bare = report.arms.find((arm) => arm.arm === 'bare');
    expect(bare?.spent.studentUsd).toBeCloseTo(
      1.3 * listed * (bare?.spent.studentAttempts ?? 0),
      9,
    );
    expect(report.disclosures.join('\n')).toContain('(1.300 times), for 30 of 30 calls');
  }, 300_000);
});

describe('the GPU window (decision 051)', () => {
  it('stops local work when the window ends, starts none without one, and frees the GPU', async () => {
    const { world, request } = setUp();
    const local = asking(request, {
      arms: ['bare'],
      localOllama: true,
      caps: { ...CONFIG.caps, localMinutes: 1_500 },
    });
    // The first run stops just after the release, before the local re-test.
    world.env.log = (line) => {
      if (/locked tests? (is|are) released/.test(line)) throw new Error('Closed after release.');
    };
    await expect(runComparison(local, world.env)).rejects.toThrow('Closed after release.');
    world.env.log = () => undefined;

    // Then a window of a fifth of a second, with each local request taking 40 ms.
    world.local.delayMs = 40;
    const short = {
      ...local,
      config: { ...local.config, caps: { ...local.config.caps, localMinutes: 0.2 / 60 } },
    };
    const cut = await runComparison(short, world.env);
    expect(cut.outcome).toBe('incomplete');
    const started = [...world.local.started];
    expect(started.length).toBeGreaterThan(0);
    expect(started.length).toBeLessThan(60);
    const first = started[0] ?? 0;
    // Nothing began after the window ended. The slack covers a busy computer's delay between the
    // runner letting a request in and the stand-in noting it; a runner that ignored the window
    // would go on starting requests for seconds.
    expect(started.every((at) => at - first <= 200 + 100)).toBe(true);
    expect(world.local.releases).toBeGreaterThan(0);
    const row = cut.report.backends.find((table) => table.backend === 'local-ollama')?.rows[0];
    expect(row?.complete).toBe(false);

    // No window: nothing runs here, and the re-test waits.
    const none = {
      ...local,
      config: { ...local.config, caps: { ...local.config.caps, localMinutes: 0 } },
    };
    expect((await runComparison(none, world.env)).outcome).toBe('incomplete');
    expect(world.local.started).toHaveLength(started.length);

    // A window long enough finishes it.
    world.local.delayMs = 0;
    expect((await runComparison(local, world.env)).outcome).toBe('finished');
  }, 300_000);
});

describe('what the report claims (decision 051)', () => {
  it('takes no weights arm that started for an adapter trained or tested', async () => {
    const { world, request } = setUp();
    world.trainer.failJobs = true;
    const { report } = await runComparison(
      asking(request, {
        arms: ['bare', 'draft', 'targeted', 'weights-one-shot'],
        caps: { studentUsd: 15, sparkUsd: 16, computeUsd: 8.1, localMinutes: 1_500 },
        realCompute: true,
        llamaServer: true,
      }),
      world.env,
    );
    const weights = report.arms.find((arm) => arm.arm === 'weights-one-shot');
    expect(weights?.runId).not.toBeNull();
    expect(weights?.frozen?.adapter).toBeNull();
    expect(weights?.notes.join(' ')).toMatch(/ended failed: The recipe stopped/);
    expect(weights?.notes.join(' ')).toMatch(/pilot recipe/);
    expect(report.disclosures).toContain(
      'Harness-only graduate. Remote QLoRA training and adapter loading are built; real end-to-end training is not validated. A01 is not met: no adapter a real training job made took the locked test.',
    );
    expect(report.disclosures.join(' ')).not.toContain('Adapters trained against NF4');
  }, 300_000);

  it('marks a repeat cut short as partial', async () => {
    const { world, request } = setUp();
    let repeated = 0;
    world.runtime.beforeAttempt = (_task, _ctx, options) => {
      if (options.seed !== 102) return;
      repeated += 1;
      if (repeated > 20) {
        throw new AdapterError('bad_request', 'The provider refused the request (dry run).');
      }
    };
    const { outcome, report } = await runComparison(
      asking(request, { arms: ['bare', 'repeat'] }),
      world.env,
    );
    expect(outcome).toBe('incomplete');
    const row = report.backends.find((table) => table.backend === 'hosted')?.repeats[0];
    expect(row).toMatchObject({ complete: false });
    expect(row?.seeds.map((seed) => seed.score.total)).toEqual([60, 20]);
    expect(report.arms.find((arm) => arm.arm === 'repeat')?.status).toBe('incomplete');
    expect(readFileSync(join(world.out, 'report.md'), 'utf8')).toContain('Bare student (partial)');
  }, 300_000);
});
