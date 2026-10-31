import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TaskSchema } from '@architect/shared';
import type { Job, Organization, Task } from '@architect/shared';
import { buildGroup as buildRecords } from './group/build';
import type { Group } from './group/build';
import { groupFiles } from './group/files';
import { GROUPS } from './group/style';
import type { GroupStyle } from './group/style';
import { buildJob } from './job-file';
import { formatJson } from './lib/json-format';
import { Random } from './lib/random';
import { buildTasks } from './tasks/build';

/** The groups of the committed job: three taught on and one never seen, each from its seed. */
export const GROUP_SEEDS: readonly { id: string; seed: number; role: Organization['role'] }[] = [
  { id: 'halden', seed: 3101, role: 'train' },
  { id: 'quill', seed: 3102, role: 'train' },
  { id: 'marlow', seed: 3103, role: 'train' },
  { id: 'fennick', seed: 3104, role: 'transfer' },
];

const CHECKER_SOURCE = new URL('./checker.js', import.meta.url);

export interface GeneratedGroup {
  organization: Organization;
  /** The group's files by name: policy.md, configs.json at some groups, and the CSV tables. */
  files: Map<string, string>;
  tasks: Task[];
  /** The true records, before any export wrote them. */
  group: Group;
}

/** One group from its style and seed: its files and its tasks. The same seed gives the same bytes. */
export function buildGroup(
  style: GroupStyle,
  seed: number,
  role: Organization['role'] = 'train',
): GeneratedGroup {
  const random = new Random(seed);
  const group = buildRecords(style, random.fork('records'));
  const files = groupFiles(group, random.fork('export'));
  const tasks = buildTasks(random.fork('tasks'), group).map((task) => TaskSchema.parse(task));
  return {
    organization: { id: style.id, name: style.name, synthetic: true, role },
    files,
    tasks,
    group,
  };
}

export interface GeneratedJob {
  job: Job;
  groups: GeneratedGroup[];
  tasks: Task[];
  /** File contents by path inside the job folder, with `/` separators. */
  files: Map<string, string>;
}

/** The whole job folder in memory: job.json, the checker, every group's files and the tasks. */
export function buildJobFiles(): GeneratedJob {
  const groups = GROUP_SEEDS.map(({ id, seed, role }) =>
    buildGroup(
      GROUPS.find((style) => style.id === id)!,
      seed,
      role,
    ),
  );
  const job = buildJob(groups.map((g) => g.organization));
  const tasks = groups.flatMap((g) => g.tasks);
  const files = new Map<string, string>();
  files.set('job.json', formatJson(job));
  files.set('checker.js', readFileSync(CHECKER_SOURCE, 'utf8'));
  files.set('tasks.jsonl', tasks.map((task) => `${JSON.stringify(task)}\n`).join(''));
  for (const { organization, files: data } of groups) {
    for (const [name, text] of data) files.set(`orgs/${organization.id}/data/${name}`, text);
  }
  return { job, groups, tasks, files };
}

/** Writes the job folder to `outDir`, creating it if needed, and returns what it wrote. */
export async function generateJob(outDir: string): Promise<GeneratedJob> {
  const generated = buildJobFiles();
  for (const [path, text] of generated.files) {
    const target = join(outDir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
  return generated;
}
