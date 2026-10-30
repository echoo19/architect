import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TaskSchema } from '@architect/shared';
import type { Job, Organization, Task } from '@architect/shared';
import { buildAcademy as buildRecords } from './academy/build';
import type { Academy } from './academy/build';
import { academyFiles } from './academy/files';
import { buildJob } from './job-file';
import { formatJson } from './lib/json-format';
import { Random } from './lib/random';
import { JobFiles } from './reference/tools';
import { buildTasks } from './tasks/build';

/** The academies of the committed job: three to train on and one kept for transfer. */
export const ACADEMY_SEEDS: readonly { seed: number; role: Organization['role'] }[] = [
  { seed: 2088, role: 'train' },
  { seed: 2083, role: 'train' },
  { seed: 2187, role: 'train' },
  { seed: 2031, role: 'transfer' },
];

const CHECKER_SOURCE = new URL('./checker.js', import.meta.url);

export interface GeneratedAcademy {
  organization: Organization;
  /** The academy's files by name: policy.md and the CSV tables. */
  files: Map<string, string>;
  tasks: Task[];
  /** The records as built, with every question's construction. */
  academy: Academy;
}

export interface BuildOptions {
  role?: Organization['role'];
  /** Prefer a first tutoring turn that calls for a staff note. */
  demoEscalates?: boolean;
}

/** One academy from its seed: its files and its tasks. The same seed always gives the same bytes. */
export function buildAcademy(seed: number, options: BuildOptions = {}): GeneratedAcademy {
  const random = new Random(seed);
  const academy = buildRecords(seed, random.fork('records'));
  const files = academyFiles(academy, random.fork('export'));
  const tasks = buildTasks(random.fork('tasks'), academy, new JobFiles(files), {
    demoEscalates: options.demoEscalates ?? false,
  }).map((task) => TaskSchema.parse(task));
  return {
    organization: {
      id: academy.style.id,
      name: academy.style.name,
      synthetic: true,
      role: options.role ?? 'train',
    },
    files,
    tasks,
    academy,
  };
}

export interface GeneratedJob {
  job: Job;
  academies: GeneratedAcademy[];
  tasks: Task[];
  /** File contents by path inside the job folder, with `/` separators. */
  files: Map<string, string>;
}

/** The whole job folder in memory: job.json, the checker, every academy's files and the tasks. */
export function buildJobFiles(): GeneratedJob {
  // Academies alternate which kind of first turn they prefer, so the demo pair differs.
  const academies = ACADEMY_SEEDS.map(({ seed, role }, i) =>
    buildAcademy(seed, { role, demoEscalates: i % 2 === 0 }),
  );
  const job = buildJob(academies.map((a) => a.organization));
  const tasks = academies.flatMap((a) => a.tasks);
  const files = new Map<string, string>();
  files.set('job.json', formatJson(job));
  files.set('checker.js', readFileSync(CHECKER_SOURCE, 'utf8'));
  files.set('tasks.jsonl', tasks.map((task) => `${JSON.stringify(task)}\n`).join(''));
  for (const { organization, files: data } of academies) {
    for (const [name, text] of data) files.set(`orgs/${organization.id}/data/${name}`, text);
  }
  return { job, academies, tasks, files };
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
