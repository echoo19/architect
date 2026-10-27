import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TaskSchema } from '@architect/shared';
import type { Job, Task } from '@architect/shared';
import { buildCompany } from './company/build';
import { renderTables } from './company/tables';
import { buildJob } from './job-file';
import { formatJson } from './lib/json-format';
import { Random } from './lib/random';
import { policyDocument } from './policy/document';
import { buildInvoiceTasks } from './tasks/invoice';
import { buildOverdueTasks } from './tasks/overdue';
import { buildScheduleTasks } from './tasks/schedule';
import type { JobVersion } from './versions';

/** The seed of the job folders committed with the app. */
export const DEFAULT_SEED = 20261105;

/** Version 1 ships the checker exactly as it was first published. */
const CHECKER_SOURCES: Readonly<Record<JobVersion, URL>> = {
  1: new URL('./checker-v1.js', import.meta.url),
  2: new URL('./checker.js', import.meta.url),
};

export interface GeneratedJob {
  job: Job;
  tasks: Task[];
  /** File contents by path inside the job folder, with `/` separators. */
  files: Map<string, string>;
}

/** A whole job folder in memory. The same seed and version always give the same bytes. */
export function buildJobFiles(seed: number, version: JobVersion): GeneratedJob {
  const random = new Random(seed);
  const records = buildCompany(random.fork('company'));
  const scheduling = buildScheduleTasks(random.fork('schedule tasks'), records, version);
  const company = { ...records, requests: scheduling.requests };
  const tasks = [
    ...buildInvoiceTasks(random.fork('invoice tasks'), records),
    ...buildOverdueTasks(random.fork('overdue tasks'), records),
    ...scheduling.tasks,
  ].map((task) => TaskSchema.parse(task));
  const job = buildJob(version);

  const files = new Map<string, string>();
  files.set('job.json', formatJson(job));
  files.set('data/policy.md', policyDocument(version));
  for (const [name, text] of Object.entries(renderTables(company, version))) {
    files.set(`data/${name}`, text);
  }
  files.set('tasks.jsonl', tasks.map((task) => `${JSON.stringify(task)}\n`).join(''));
  files.set('checker.js', readFileSync(CHECKER_SOURCES[version], 'utf8'));
  return { job, tasks, files };
}

/** Writes a job folder to `outDir`, creating it if needed, and returns what it wrote. */
export async function generateJob(
  outDir: string,
  version: JobVersion,
  seed = DEFAULT_SEED,
): Promise<GeneratedJob> {
  const generated = buildJobFiles(seed, version);
  for (const [path, text] of generated.files) {
    const target = join(outDir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
  return generated;
}
