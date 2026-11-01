import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  LAB_SEEDS as ASSAY_SEEDS,
  Random,
  buildLab as buildAssayLab,
  formatJson,
} from '@architect/example-assay-desk';
import { TaskSchema } from '@architect/shared';
import type { Job, Organization, Task } from '@architect/shared';
import { assayLab } from './lab/assay';
import { buildDesk } from './lab/build';
import type { Desk } from './lab/build';
import { deskFiles } from './lab/files';
import { DESK_STYLES, randomStyle } from './lab/style';
import type { DeskStyle } from './lab/style';
import { buildJob } from './job-file';
import { buildTasks } from './tasks/build';

/**
 * The labs of the committed job: the Assay desk's four, the same labs with the same roles, each
 * with a store of its own. Fenwick, Alder Row and Saltmarsh are taught on; Corvid Hill is kept for
 * transfer.
 */
export const LAB_SEEDS: readonly { seed: number; style: DeskStyle }[] = DESK_STYLES.map(
  (style, i) => ({ seed: 4101 + i * 37, style }),
);

const CHECKER_SOURCE = new URL('./checker.js', import.meta.url);

export interface GeneratedLab {
  organization: Organization;
  /** The lab's files by name: policy.md and the CSV tables. */
  files: Map<string, string>;
  tasks: Task[];
  /** The true store, before any file wrote it. */
  desk: Desk;
}

/**
 * One lab's store from its seed: its files and its tasks. A style serves the Assay desk's lab of
 * the same id, built from the Assay desk's own seed for it; a seed without a style draws an Assay
 * desk lab and a store of its own. The same seed always gives the same bytes.
 */
export function buildLab(seed: number, style?: DeskStyle): GeneratedLab {
  const assaySeed = ASSAY_SEEDS.find((s) => s.style.id === style?.id);
  const generated = assaySeed
    ? buildAssayLab(assaySeed.seed, assaySeed.style, assaySeed.role)
    : buildAssayLab(seed);
  const assay = assayLab(generated);
  const random = new Random(seed);
  const desk = buildDesk(
    assay,
    style ?? randomStyle(assay.id, random.fork('style')),
    random.fork('store'),
  );
  const files = deskFiles(desk, random.fork('files'));
  const tasks = buildTasks(random.fork('tasks'), desk).map((task) => TaskSchema.parse(task));
  return { organization: generated.organization, files, tasks, desk };
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
  const labs = LAB_SEEDS.map(({ seed, style }) => buildLab(seed, style));
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
