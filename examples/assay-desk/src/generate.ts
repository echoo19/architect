import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TaskSchema } from '@architect/shared';
import type { Job, Organization, Task } from '@architect/shared';
import { buildLab as buildRecords } from './lab/build';
import type { Lab } from './lab/build';
import { labFiles } from './lab/files';
import { LAB_STYLES, randomStyle } from './lab/style';
import type { LabStyle } from './lab/style';
import { buildJob } from './job-file';
import { formatJson } from './lib/json-format';
import { Random } from './lib/random';
import { buildTasks } from './tasks/build';

/** The labs of the committed job: three to teach on and Corvid Hill, kept for transfer. */
export const LAB_SEEDS: readonly { seed: number; style: LabStyle; role: Organization['role'] }[] = [
  { seed: 3101, style: LAB_STYLES[0]!, role: 'train' },
  { seed: 3127, style: LAB_STYLES[1]!, role: 'train' },
  { seed: 3163, style: LAB_STYLES[2]!, role: 'train' },
  { seed: 3191, style: LAB_STYLES[3]!, role: 'transfer' },
];

const CHECKER_SOURCE = new URL('./checker.js', import.meta.url);

export interface GeneratedLab {
  organization: Organization;
  /** The lab's files by name: policy.md and the CSV tables. */
  files: Map<string, string>;
  tasks: Task[];
  /** The true records, before any export wrote them. */
  lab: Lab;
}

/**
 * One lab from its seed: its files and its tasks. The same seed always gives the same bytes. A
 * seed without a style draws a lab of its own.
 */
export function buildLab(
  seed: number,
  style?: LabStyle,
  role: Organization['role'] = 'train',
): GeneratedLab {
  const random = new Random(seed);
  const lab = buildRecords(style ?? randomStyle(seed, random.fork('style')), random.fork('plates'));
  const files = labFiles(lab, random.fork('export'));
  const tasks = buildTasks(random.fork('tasks'), lab).map((task) => TaskSchema.parse(task));
  return {
    organization: { id: lab.style.id, name: lab.style.name, synthetic: true, role },
    files,
    tasks,
    lab,
  };
}

export interface GeneratedJob {
  job: Job;
  labs: GeneratedLab[];
  tasks: Task[];
  /** File contents by path inside the job folder, with `/` separators. */
  files: Map<string, string>;
}

/** The whole job folder in memory: job.json, the checker, every lab's files and the tasks. */
export function buildJobFiles(): GeneratedJob {
  const labs = LAB_SEEDS.map(({ seed, style, role }) => buildLab(seed, style, role));
  const job = buildJob(labs.map((l) => l.organization));
  const tasks = labs.flatMap((l) => l.tasks);
  const files = new Map<string, string>();
  files.set('job.json', formatJson(job));
  files.set('checker.js', readFileSync(CHECKER_SOURCE, 'utf8'));
  files.set('tasks.jsonl', tasks.map((task) => `${JSON.stringify(task)}\n`).join(''));
  for (const { organization, files: data } of labs) {
    for (const [name, text] of data) files.set(`orgs/${organization.id}/data/${name}`, text);
  }
  return { job, labs, tasks, files };
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
