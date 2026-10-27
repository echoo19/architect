import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { JobSchema, TaskSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, buildJobFiles, generateJob, sampleJobDir } from '../src';
import { BUSINESS_DATE, jobFile, loadTasks } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

describe('generation', () => {
  it('gives identical bytes for the same seed', () => {
    const first = buildJobFiles(DEFAULT_SEED);
    const second = buildJobFiles(DEFAULT_SEED);
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    for (const [path, text] of first.files) expect(second.files.get(path), path).toBe(text);
  });

  it('gives a different company for a different seed', () => {
    const other = buildJobFiles(DEFAULT_SEED + 1);
    expect(other.tasks).toHaveLength(180);
    expect(other.files.get('data/jobs.csv')).not.toBe(
      buildJobFiles(DEFAULT_SEED).files.get('data/jobs.csv'),
    );
  });

  it('matches the committed job folder byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'home-services-'));
    try {
      await generateJob(outDir, DEFAULT_SEED);
      const written = await filesUnder(outDir);
      expect(await filesUnder(sampleJobDir)).toEqual(written);
      for (const path of written) {
        const fresh = await readFile(join(outDir, path));
        const committed = await readFile(join(sampleJobDir, path));
        expect(committed.equals(fresh), `${path} is stale: run the generate script`).toBe(true);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('job.json', () => {
  const job = JobSchema.parse(JSON.parse(jobFile('job.json')));

  it('declares exactly the files in data/', async () => {
    const present = (await filesUnder(join(sampleJobDir, 'data'))).sort();
    expect(job.data.files.map((file) => file.name).sort()).toEqual(present);
  });

  it('makes the policy business date the agent today', () => {
    expect(job.businessDate).toBe(BUSINESS_DATE);
  });

  it('lets the agent write only invoices and bookings', () => {
    const writable = job.data.files.filter((file) => file.access === 'write').map((f) => f.name);
    expect(writable.sort()).toEqual(['bookings.csv', 'invoices.csv']);
  });

  it('splits exactly the generated tasks', () => {
    const { calibration, train, dev, test } = job.splits;
    expect(calibration + train + dev + test).toBe(loadTasks().length);
    expect(job.splits).toEqual({ seed: 20261027, calibration: 15, train: 60, dev: 45, test: 60 });
  });

  it('names the three task types and the checker module', () => {
    expect(job.taskTypes.map((type) => [type.id, type.label])).toEqual([
      ['invoice', 'Invoices'],
      ['overdue', 'Overdue balances'],
      ['schedule', 'Scheduling'],
    ]);
    expect(job.checker).toEqual({ kind: 'module', path: 'checker.js' });
  });
});

describe('tasks.jsonl', () => {
  const tasks = loadTasks();

  it('parses every line as a task with a unique id', () => {
    for (const line of jobFile('tasks.jsonl').trimEnd().split('\n')) {
      expect(TaskSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
  });

  it('has 60 tasks of each type, each in its own family', () => {
    for (const type of ['invoice', 'overdue', 'schedule']) {
      const ofType = tasks.filter((task) => task.type === type);
      expect(ofType, type).toHaveLength(60);
      expect(new Set(ofType.map((task) => task.family)).size, type).toBe(60);
    }
  });

  it('states the business date and ends with the answer line', () => {
    for (const task of tasks) {
      expect(task.prompt, task.id).toContain('Thursday, November 5, 2026');
      expect(task.prompt.split('\n').at(-1), task.id).toMatch(/^End with: ANSWER: \{.*\}$/);
    }
    expect(jobFile('data/policy.md')).toContain(BUSINESS_DATE);
  });

  it('mixes easy, medium and hard tasks within every type', () => {
    for (const type of ['invoice', 'overdue', 'schedule']) {
      const mix = { easy: 0, medium: 0, hard: 0 };
      for (const task of tasks.filter((t) => t.type === type)) {
        mix[task.meta?.difficulty as keyof typeof mix] += 1;
      }
      expect(mix.easy, type).toBeGreaterThanOrEqual(19);
      expect(mix.hard, type).toBeGreaterThanOrEqual(13);
    }
  });
});
