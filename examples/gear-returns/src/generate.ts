import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TaskSchema } from '@architect/shared';
import type { Job, Task } from '@architect/shared';
import { buildJob } from './job-file';
import { formatJson } from './lib/json-format';
import { Random } from './lib/random';
import { policyDocument } from './policy/document';
import { JobFiles } from './reference/tools';
import { buildShop } from './shop/build';
import { exportTables } from './shop/exports';
import { ShopIndex } from './shop/records';
import type { Shop } from './shop/types';
import { buildOrderTasks } from './tasks/order';
import { buildPickupTasks } from './tasks/pickup';
import { buildRefundTasks } from './tasks/refund';

/** The seed of the job folder committed with the repo. */
export const DEFAULT_SEED = 20261124;

const CHECKER_SOURCE = new URL('./checker.js', import.meta.url);

export interface GeneratedJob {
  job: Job;
  tasks: Task[];
  /** File contents by path inside the job folder, with `/` separators. */
  files: Map<string, string>;
  /** The records as they really are, before the exports wrote some values another way. */
  shop: Shop;
}

/** A whole job folder in memory. The same seed always gives the same bytes. */
export function buildJobFiles(seed: number): GeneratedJob {
  const random = new Random(seed);
  const { shop, awaitingPickup } = buildShop(random.fork('shop'));
  const tables = exportTables(shop, random.fork('exports'));
  const policy = policyDocument();
  const data = new JobFiles(new Map([['policy.md', policy], ...Object.entries(tables)]));
  const index = new ShopIndex(shop);
  // Returns waiting for a pickup belong to the pickup tasks, so refund requests stay off their orders.
  const pickupOrders = new Set(
    shop.returns
      .filter((record) => awaitingPickup.includes(record.return_id))
      .map((record) => record.order_id),
  );
  const tasks = [
    ...buildRefundTasks(random.fork('refund tasks'), index, data, pickupOrders),
    ...buildOrderTasks(random.fork('order tasks'), index, data),
    ...buildPickupTasks(random.fork('pickup tasks'), index, data, awaitingPickup),
  ].map((task) => TaskSchema.parse(task));
  const job = buildJob(seed);

  const files = new Map<string, string>();
  files.set('job.json', formatJson(job));
  files.set('data/policy.md', policy);
  for (const [name, text] of Object.entries(tables)) files.set(`data/${name}`, text);
  files.set('tasks.jsonl', tasks.map((task) => `${JSON.stringify(task)}\n`).join(''));
  files.set('checker.js', readFileSync(CHECKER_SOURCE, 'utf8'));
  return { job, tasks, files, shop };
}

/** Writes a job folder to `outDir`, creating it if needed, and returns what it wrote. */
export async function generateJob(outDir: string, seed = DEFAULT_SEED): Promise<GeneratedJob> {
  const generated = buildJobFiles(seed);
  for (const [path, text] of generated.files) {
    const target = join(outDir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
  return generated;
}
