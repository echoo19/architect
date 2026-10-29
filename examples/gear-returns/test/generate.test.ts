import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { TaskSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, buildJobFiles, generateJob, jobDir } from '../src';
import { BUSINESS_DATE, job } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

describe('generating the job', () => {
  it('gives identical bytes for the same seed', () => {
    const first = buildJobFiles(DEFAULT_SEED);
    const second = buildJobFiles(DEFAULT_SEED);
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    for (const [path, text] of first.files) expect(second.files.get(path), path).toBe(text);
  });

  it('gives a different shop and the same number of tasks for other seeds', () => {
    for (const seed of [DEFAULT_SEED + 1, 7]) {
      const other = buildJobFiles(seed);
      expect(other.tasks, String(seed)).toHaveLength(180);
      expect(other.files.get('data/orders.csv')).not.toBe(
        buildJobFiles(DEFAULT_SEED).files.get('data/orders.csv'),
      );
    }
  });

  it("splits another seed's tasks by that seed, and the committed job by its own", () => {
    expect(buildJobFiles(DEFAULT_SEED).job.splits.seed).toBe(DEFAULT_SEED);
    for (const seed of [DEFAULT_SEED + 1, 7]) {
      expect(buildJobFiles(seed).job.splits.seed, String(seed)).toBe(seed);
    }
  });

  it("matches the ready-made agent's records, the shop of seed 20261029, byte for byte", async () => {
    const shipped = join(jobDir, '..', 'graduate', 'data');
    const fresh = buildJobFiles(20261029).files;
    const names = (await filesUnder(shipped)).map((name) => `data/${name}`);
    expect(names).toEqual([...fresh.keys()].filter((path) => path.startsWith('data/')).sort());
    for (const path of names) {
      const committed = await readFile(join(shipped, path.slice('data/'.length)), 'utf8');
      expect(committed, path).toBe(fresh.get(path));
    }
  });

  it('matches the committed job folder byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'gear-returns-'));
    try {
      await generateJob(outDir, DEFAULT_SEED);
      const written = await filesUnder(outDir);
      expect(await filesUnder(jobDir)).toEqual(written);
      for (const path of written) {
        const fresh = await readFile(join(outDir, path));
        const committed = await readFile(join(jobDir, path));
        expect(committed.equals(fresh), `${path} is stale: run the generate script`).toBe(true);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('job.json', () => {
  const settings = job.job();

  it('declares exactly the files in data/', async () => {
    const present = (await filesUnder(join(job.dir, 'data'))).sort();
    expect(settings.data.files.map((file) => file.name).sort()).toEqual(present);
  });

  it("makes the policy's business date the agent's today", () => {
    expect(settings.businessDate).toBe(BUSINESS_DATE);
    expect(job.file('data/policy.md')).toContain(BUSINESS_DATE);
  });

  it('lets the agent write only returns and pickups', () => {
    const writable = settings.data.files.filter((file) => file.access === 'write');
    expect(writable.map((file) => file.name).sort()).toEqual(['pickups.csv', 'returns.csv']);
  });

  it("keeps the first job's bar, budget, evaluation and starting point", () => {
    expect(settings.requirements).toEqual({ passRate: 0.95 });
    expect(settings.budget).toEqual({ maxRounds: 8, maxMentorUsd: 5, maxWallMinutes: 240 });
    expect(settings.evaluation).toEqual({
      trainBatch: 12,
      minDevGain: 2,
      maxTypeRegression: 1,
      devRepeats: 1,
      patience: 4,
    });
    expect(settings.startingHarness).toEqual({ kind: 'blank' });
    expect(settings.permissions).toEqual({ writes: 'ask', unseenFiles: 'never' });
  });

  it('splits exactly the generated tasks, the way the first job does', () => {
    const { calibration, train, dev, test } = settings.splits;
    expect(calibration + train + dev + test).toBe(job.allTasks().length);
    expect(settings.splits).toEqual({
      seed: 20261124,
      calibration: 15,
      train: 60,
      dev: 45,
      test: 60,
    });
  });

  it('names the three task types and the checker module', () => {
    expect(settings.taskTypes.map((type) => [type.id, type.label])).toEqual([
      ['refund', 'Refunds'],
      ['order', 'Order questions'],
      ['pickup', 'Pickups'],
    ]);
    expect(settings.checker).toEqual({ kind: 'module', path: 'checker.js' });
  });
});

describe('tasks.jsonl', () => {
  const tasks = job.allTasks();

  it('parses every line as a task with a unique id', () => {
    for (const line of job.file('tasks.jsonl').trimEnd().split('\n')) {
      expect(TaskSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
  });

  it('has 60 tasks of each type', () => {
    for (const type of ['refund', 'order', 'pickup']) {
      expect(job.tasksOfType(type), type).toHaveLength(60);
    }
  });

  it('puts each refund and pickup in the family of its order, refunds one per order', () => {
    const refunds = job.tasksOfType('refund').map((task) => task.family);
    const pickups = job.tasksOfType('pickup').map((task) => task.family);
    for (const family of [...refunds, ...pickups]) expect(family).toMatch(/^order:ORD-\d+$/);
    expect(new Set(refunds).size).toBe(refunds.length);
    expect(refunds.filter((family) => pickups.includes(family))).toEqual([]);
    for (const task of job.tasksOfType('pickup')) {
      const id = (task.meta?.request as { return_id: string }).return_id;
      const record = job.table('returns.csv').find((row) => row.return_id === id);
      expect(task.family, task.id).toBe(`order:${record?.order_id}`);
    }
  });

  it('keeps questions about one customer, product or region in one family', () => {
    for (const task of job.tasksOfType('order')) {
      const question = task.meta?.question as Record<string, string>;
      const family =
        question.kind === 'sku_sales'
          ? `sku:${question.sku}`
          : question.kind === 'unshipped'
            ? `unshipped:${question.region}`
            : `customer:${job.table('customers.csv').find((row) => row.email?.trim().toLowerCase() === question.email)?.customer_id}`;
      expect(task.family, task.id).toBe(family);
    }
  });

  it('states the business date and ends with the answer line', () => {
    for (const task of tasks) {
      expect(task.prompt, task.id).toContain('Tuesday, November 24, 2026');
      expect(task.prompt.split('\n').at(-1), task.id).toMatch(/^End with: ANSWER: \{.*\}$/);
    }
  });
});
