import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job, Organization, Task } from '@architect/shared';
import { defaultJob, TYPES } from '../fakes/job';

/**
 * A job of three organizations of one field: two it trains on and one it never sees, which is
 * real rather than generated. Each has its own records and policy under the same file names.
 */
export const ORGS: Organization[] = [
  { id: 'north', name: 'North Branch', synthetic: true, role: 'train' },
  { id: 'south', name: 'South Branch', synthetic: true, role: 'train' },
  { id: 'hillcrest', name: 'Hillcrest Prep', synthetic: false, role: 'transfer' },
];

/** Each organization's files: its own job ids, technicians and billing rule. */
export const ORG_FILES: Record<string, Record<string, string>> = {
  north: {
    'jobs.csv': 'id,tech,minutes\nNJ-1001,NT-301,90\nNJ-1002,NT-302,45\nNJ-1003,NT-303,120\n',
    'policy.md': '# North policy\nLabor is billed per started 15 minutes.\n',
  },
  south: {
    'jobs.csv': 'id,tech,minutes\nSJ-2001,ST-401,60\nSJ-2002,ST-402,30\nSJ-2003,ST-403,75\n',
    'policy.md': '# South policy\nLabor is billed per started 30 minutes.\n',
  },
  hillcrest: {
    'jobs.csv': 'id,tech,minutes\nHJ-9001,HT-901,50\nHJ-9002,HT-902,20\n',
    'policy.md': '# Hillcrest policy\nLabor is billed per started 10 minutes.\n',
  },
};

/** A task for one organization, its id saying its split as the fake splitter reads it. */
export function orgTask(split: string, org: string, type: string, n: number): Task {
  const id = `${split}-${org}-${type}-${n}`;
  return {
    id,
    type,
    family: id,
    org,
    prompt: `[${id}] ${type} request number ${n} for ${org}: work it out from the records.`,
    expected: { kind: 'answer', value: { ok: true }, compare: { mode: 'exact' } },
  };
}

/** Per trained organization one train, one dev and one test task of each type; two sealed each. */
export function orgTasks(): Task[] {
  const tasks: Task[] = [];
  for (const type of TYPES) {
    for (const org of ['north', 'south']) {
      tasks.push(orgTask('train', org, type, 1), orgTask('dev', org, type, 1));
      tasks.push(orgTask('test', org, type, 1));
    }
    tasks.push(orgTask('xfer', 'hillcrest', type, 1), orgTask('xfer', 'hillcrest', type, 2));
  }
  return tasks;
}

export function orgJob(overrides: Partial<Job> = {}): Job {
  return defaultJob({
    id: 'branches',
    organizations: ORGS,
    splits: { seed: 7, calibration: 0, train: 6, dev: 6, test: 6 },
    evaluation: { trainBatch: 6, minDevGain: 2, maxTypeRegression: 1, devRepeats: 1, patience: 3 },
    ...overrides,
  });
}

/** A job folder with `orgs/<id>/data/` for each organization, as a multi-organization job ships. */
export async function writeOrgJobFolder(
  dir: string,
  job: Job = orgJob(),
  tasks: Task[] = orgTasks(),
): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'job.json'), JSON.stringify(job, null, 2));
  await writeFile(join(dir, 'tasks.jsonl'), tasks.map((task) => JSON.stringify(task)).join('\n'));
  for (const [org, files] of Object.entries(ORG_FILES)) {
    await mkdir(join(dir, 'orgs', org, 'data'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, 'orgs', org, 'data', name), content);
    }
  }
  return join(dir, 'job.json');
}

/** Every file under a folder whose text holds `needle`, any case, by path. */
export async function filesHolding(dir: string, needle: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, 'utf8');
    if (text.toLowerCase().includes(needle.toLowerCase())) found.push(path);
  }
  return found;
}
