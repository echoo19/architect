import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JobSchema, TaskSchema, type Task } from '@architect/shared';
import { RETURNS_DESK, type ComparisonWorld } from './comparison-world';

/*
 * The returns desk as a field: four desks, two of them sealed, one of those real (decisions
 * 068-070), and the brief Spark writes when it studies the desks it trains on.
 */

export const ORGANIZATIONS = [
  { id: 'north', name: 'North Desk', synthetic: true, role: 'train' as const },
  { id: 'south', name: 'South Desk', synthetic: true, role: 'train' as const },
  { id: 'quayside', name: 'Quayside Gear', synthetic: true, role: 'transfer' as const },
  { id: 'hillcrest', name: 'Hillcrest Outlet', synthetic: false, role: 'transfer' as const },
];

/** Which organization a family belongs to, by its place among the families. */
function orgOfFamily(index: number): string {
  if (index % 10 === 3) return 'quayside';
  if (index % 10 === 7) return 'hillcrest';
  return index % 2 === 0 ? 'north' : 'south';
}

/** The returns desk as four desks of one field: each family at one desk, two of them sealed. */
export function fieldJob(world: ComparisonWorld): { dir: string; sealedTasks: number } {
  const dir = join(world.root, 'field-job');
  cpSync(RETURNS_DESK, dir, { recursive: true });
  for (const org of ORGANIZATIONS) {
    cpSync(join(RETURNS_DESK, 'data'), join(dir, 'orgs', org.id, 'data'), { recursive: true });
  }
  const tasks: Task[] = readFileSync(join(dir, 'tasks.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => TaskSchema.parse(JSON.parse(line)));
  const families = [...new Set(tasks.map((task) => task.family))];
  const placed = tasks.map((task) => ({
    ...task,
    org: orgOfFamily(families.indexOf(task.family)),
  }));
  writeFileSync(
    join(dir, 'tasks.jsonl'),
    `${placed.map((task) => JSON.stringify(task)).join('\n')}\n`,
  );
  const job = JobSchema.parse(JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')));
  writeFileSync(
    join(dir, 'job.json'),
    JSON.stringify(
      {
        ...job,
        organizations: ORGANIZATIONS,
        splits: { ...job.splits, calibration: 12, train: 36, dev: 36, test: 36 },
      },
      null,
      2,
    ),
  );
  const sealed = placed.filter((task) => task.org === 'quayside' || task.org === 'hillcrest');
  return { dir, sealedTasks: sealed.length };
}

/** Spark's brief of the desks: a skill per task type, steps with no desk's facts in them. */
export const BRIEF = {
  skills: ['refund', 'order', 'pickup'].map((taskType) => ({
    taskType,
    text: `Work a ${taskType} request from the desk's own records.`,
    needs: ['policy.md', 'orders.csv'],
    steps: ['Read the policy for the rule.', 'Find the order in orders.csv.'],
    quotes: [],
  })),
  connections: [],
  rules: [],
  differences: [],
  questions: [],
  outOfScope: [],
};
