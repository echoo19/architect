import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { JobSchema, TaskSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, JOB_VERSIONS, buildJobFiles, generateJob, jobDir } from '../src';
import { BOTH_VERSIONS, BUSINESS_DATE, firstVersion } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

describe.each(JOB_VERSIONS)('generating version %i', (version) => {
  it('gives identical bytes for the same seed', () => {
    const first = buildJobFiles(DEFAULT_SEED, version);
    const second = buildJobFiles(DEFAULT_SEED, version);
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    for (const [path, text] of first.files) expect(second.files.get(path), path).toBe(text);
  });

  it('gives a different company for a different seed', () => {
    const other = buildJobFiles(DEFAULT_SEED + 1, version);
    expect(other.tasks).toHaveLength(180);
    expect(other.files.get('data/jobs.csv')).not.toBe(
      buildJobFiles(DEFAULT_SEED, version).files.get('data/jobs.csv'),
    );
  });

  it('matches the committed job folder byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'home-services-'));
    try {
      await generateJob(outDir, version, DEFAULT_SEED);
      const written = await filesUnder(outDir);
      expect(await filesUnder(jobDir(version))).toEqual(written);
      for (const path of written) {
        const fresh = await readFile(join(outDir, path));
        const committed = await readFile(join(jobDir(version), path));
        expect(committed.equals(fresh), `${path} is stale: run the generate script`).toBe(true);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe('the first version', () => {
  // SHA-256 of each file as first published. Only job.json changed since, to give the frozen
  // version its own id and name; every measurement on it depends on the rest staying identical.
  const PUBLISHED: Record<string, string> = {
    'checker.js': 'dd65cc7f353fb55d8e4d199f2086e77a0a4ffb61d79a6fe412897c164a858193',
    'data/bookings.csv': 'd5318adf3cc26defb53caf7ac446b75703dc4be88378978709ed7821a7a84ad5',
    'data/customers.csv': '6120fb0dca28dc3b7cbae242594b959e6b51012c766ef7ad8f71dfae0f0deff7',
    'data/invoices.csv': '0ad935a8ed204c3097ba3bd207e915c961fc2fa5a24c17d978943f9f94ce827d',
    'data/job_parts.csv': 'c438701c32c77162a25aafb4b18ba7b0bc145a4cb35c44af9d6998ff95cf2b52',
    'data/jobs.csv': 'dba2e5ed26f00465bec57ab954629dd37a148ecd63600e2145c3c6a610e87886',
    'data/parts.csv': 'f1c1150d3cb366dd721836ce67a14c83438284db34d0f5043e67659da57b5b8d',
    'data/payments.csv': '9ee4066c1a8e00eb121d0351e7f976018cbd3955a6de79b1e1e849a80355f7ca',
    'data/policy.md': '2bb72f3e839cc8b77ef13c2f22258d777cb3038a7e55a78009df845d03c146ec',
    'data/rates.csv': '79276c1213ca3fc705a6e7cf6376c0c30a200409e7b8d47b660f0118adbe5af0',
    'data/requests.csv': '56ed99e4cc59160159e633174bdf4da510827a8d7d2cec1b2bc8160b6e94893e',
    'data/tax.csv': '7c6f5840eaf08291552881a39ee68ddb6d82fb930578151566624a1175a81a49',
    'data/technicians.csv': '0ada784a34683d6699e1312680e95edd31b04af753a941df79409818711f6ad3',
    'data/travel.csv': '2f428f3adbe418a35381c1d3efe57e575d16ecd8efd1331c2ba2c493be79fabc',
    'tasks.jsonl': '480f544d16fc301963d60176b4cf93f47c0a3410fd5e6ecdfecb071993348f80',
  };

  it('keeps every file but job.json exactly as first published', async () => {
    const files = (await filesUnder(firstVersion.dir)).filter((path) => path !== 'job.json');
    expect(files).toEqual(Object.keys(PUBLISHED).sort());
    for (const path of files) {
      const digest = createHash('sha256')
        .update(await readFile(join(firstVersion.dir, path)))
        .digest('hex');
      expect(digest, path).toBe(PUBLISHED[path]);
    }
  });

  it('is its own job next to the sample, under the name it was measured as', () => {
    const job = JobSchema.parse(JSON.parse(firstVersion.file('job.json')));
    expect([job.id, job.name]).toEqual(['sample-home-services-v1', 'Service desk (first version)']);
  });
});

describe.each(BOTH_VERSIONS)('job.json of version $version', (folder) => {
  const job = JobSchema.parse(JSON.parse(folder.file('job.json')));

  it('declares exactly the files in data/', async () => {
    const present = (await filesUnder(join(folder.dir, 'data'))).sort();
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
    expect(calibration + train + dev + test).toBe(folder.allTasks().length);
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

describe.each(BOTH_VERSIONS)('tasks.jsonl of version $version', (folder) => {
  const tasks = folder.allTasks();

  it('parses every line as a task with a unique id', () => {
    for (const line of folder.file('tasks.jsonl').trimEnd().split('\n')) {
      expect(TaskSchema.safeParse(JSON.parse(line)).success).toBe(true);
    }
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
  });

  it('has 60 tasks of each type, each in its own family', () => {
    for (const type of ['invoice', 'overdue', 'schedule']) {
      const ofType = folder.tasksOfType(type);
      expect(ofType, type).toHaveLength(60);
      expect(new Set(ofType.map((task) => task.family)).size, type).toBe(60);
    }
  });

  it('states the business date and ends with the answer line', () => {
    for (const task of tasks) {
      expect(task.prompt, task.id).toContain('Thursday, November 5, 2026');
      expect(task.prompt.split('\n').at(-1), task.id).toMatch(/^End with: ANSWER: \{.*\}$/);
    }
    expect(folder.file('data/policy.md')).toContain(BUSINESS_DATE);
  });
});

describe('the difficulty mix of the first version', () => {
  it('mixes easy, medium and hard tasks within every type', () => {
    for (const type of ['invoice', 'overdue', 'schedule']) {
      const mix = { easy: 0, medium: 0, hard: 0 };
      for (const task of firstVersion.tasksOfType(type)) {
        mix[task.meta?.difficulty as keyof typeof mix] += 1;
      }
      expect(mix.easy, type).toBeGreaterThanOrEqual(19);
      expect(mix.hard, type).toBeGreaterThanOrEqual(13);
    }
  });
});
