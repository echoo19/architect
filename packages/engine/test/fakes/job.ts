import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JobSchema, type Job, type Task } from '@architect/shared';

export const TYPES = ['invoice', 'overdue', 'scheduling'] as const;

/** A task whose id says its split (`train-invoice-1`), which the fake splitter relies on. */
export function task(split: string, type: string, n: number): Task {
  return {
    id: `${split}-${type}-${n}`,
    type,
    family: `${split}-${type}-${n}`,
    prompt: `[${split}] ${type} request number ${n}: work it out from the records.`,
    expected: { kind: 'answer', value: { ok: true }, compare: { mode: 'exact' } },
  };
}

/** Six train, nine dev and six test tasks, evenly over three types. */
export function defaultTasks(): Task[] {
  const tasks: Task[] = [];
  for (const type of TYPES) {
    for (let n = 1; n <= 2; n++) tasks.push(task('train', type, n));
    for (let n = 1; n <= 3; n++) tasks.push(task('dev', type, n));
    for (let n = 1; n <= 2; n++) tasks.push(task('test', type, n));
  }
  return tasks;
}

export function defaultJob(overrides: Partial<Job> = {}): Job {
  return JobSchema.parse({
    format: 1,
    id: 'service-desk',
    name: 'Service desk',
    description: 'Close out the day for a home-services office.',
    createdAt: '2026-10-27T09:00:00.000Z',
    taskTypes: [
      { id: 'invoice', label: 'Invoices' },
      { id: 'overdue', label: 'Overdue balances' },
      { id: 'scheduling', label: 'Scheduling' },
    ],
    data: {
      files: [
        { name: 'jobs.csv', kind: 'table', access: 'read' },
        { name: 'policy.md', kind: 'text', access: 'read' },
      ],
    },
    permissions: { writes: 'ask', unseenFiles: 'never' },
    checker: { kind: 'builtin' },
    requirements: { passRate: 0.9 },
    budget: { maxRounds: 2, maxMentorUsd: 5, maxWallMinutes: 60 },
    mentor: {
      kind: 'model',
      provider: 'meta',
      label: 'Spark',
      baseUrl: 'https://api.meta.ai/v1',
      model: 'fake-mentor-1',
      reasoningEffort: 'medium',
      secretRef: 'meta',
    },
    student: {
      label: 'Glimmer',
      local: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'glimmer:test' },
      hosted: {
        runtime: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'glimmer-hosted',
        secretRef: 'openrouter',
      },
      trainOn: 'local',
    },
    // Rounds refine an existing harness here; a blank start drafts first (decision 026).
    startingHarness: { kind: 'template', template: 'service desk' },
    splits: { seed: 7, calibration: 0, train: 6, dev: 9, test: 6 },
    evaluation: { trainBatch: 6, minDevGain: 2, maxTypeRegression: 1, patience: 3 },
    ...overrides,
  });
}

/** A job folder as the sample job ships: `job.json`, `tasks.jsonl` and `data/`. */
export async function writeJobFolder(dir: string, job: Job, tasks: Task[]): Promise<string> {
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'job.json'), JSON.stringify(job, null, 2));
  await writeFile(join(dir, 'tasks.jsonl'), tasks.map((t) => JSON.stringify(t)).join('\n'));
  await writeFile(
    join(dir, 'data', 'jobs.csv'),
    'id,tech,minutes\nJ-1,T-3,90\nJ-2,T-1,45\nJ-3,T-2,120\nJ-4,T-1,30\n',
  );
  await writeFile(
    join(dir, 'data', 'policy.md'),
    '# Policy\nLabor is billed per started 15 minutes.\n',
  );
  return join(dir, 'job.json');
}
