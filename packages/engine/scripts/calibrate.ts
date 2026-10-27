/**
 * Calibration: how well a student does on a job before any mentoring. A developer tool; it is not
 * part of the app and never runs in CI.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/calibrate.ts <jobDir> [split] [--limit N]
 *     [--seed N] [--concurrency N]
 *
 * <jobDir> holds job.json, tasks.jsonl, data/ and the checker module. [split] is calibration
 * (the default), train or dev; the test split stays locked in the vault. The student is the job's
 * local endpoint, normally Ollama, so the model loads on this machine for the duration of the run.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createStudent } from '@architect/adapters';
import { blankHarness } from '@architect/harness';
import {
  JobSchema,
  TaskSchema,
  type Job,
  type StudentAdapter,
  type Task,
  type TypeScore,
} from '@architect/shared';
import {
  createChecker,
  createSandbox,
  evaluateTasks,
  splitTasks,
  type EvaluationItem,
} from '../src/runtime';

/** The student being calibrated: the job's local endpoint, as the graduate would run it. */
function createCalibrationStudent(job: Job): StudentAdapter {
  return createStudent(job.student.local, { label: job.student.label });
}

const SPLITS = ['calibration', 'train', 'dev'] as const;
type CalibrationSplit = (typeof SPLITS)[number];

interface Options {
  jobDir: string;
  split: CalibrationSplit;
  limit?: number;
  seed: number;
  concurrency: number;
}

const USAGE =
  'Usage: tsx scripts/calibrate.ts <jobDir> [calibration|train|dev] [--limit N] [--seed N] [--concurrency N]';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const job = JobSchema.parse(JSON.parse(await readFile(join(options.jobDir, 'job.json'), 'utf8')));
  const tasks = parseTasks(await readFile(join(options.jobDir, 'tasks.jsonl'), 'utf8'));
  const selected = splitTasks(tasks, job.splits)[options.split].slice(0, options.limit);

  const student = createCalibrationStudent(job);
  const sandbox = createSandbox();
  const checker = createChecker({ job, jobDir: options.jobDir, sandbox });
  write(
    `${job.name}: ${selected.length} ${options.split} tasks on ${student.label} (${student.model})\n`,
  );
  try {
    const result = await evaluateTasks(
      selected,
      {
        job,
        jobDir: options.jobDir,
        harness: blankHarness(job.name, job.description),
        student,
        sandbox,
        checker,
      },
      {
        seed: options.seed,
        concurrency: options.concurrency,
        onAttempt: ({ task, result: attempt }) => {
          const mark = attempt.check.pass ? 'pass' : 'FAIL';
          write(
            `${mark}  ${task.id}  ${seconds(attempt.trace.latencyMs)}  ${attempt.check.reason}\n`,
          );
        },
      },
    );
    write(`\n${summary(result.items, result.perType)}`);
  } finally {
    await sandbox.dispose();
    await student.release();
  }
}

function summary(items: readonly EvaluationItem[], perType: readonly TypeScore[]): string {
  const passed = items.filter((item) => item.result.check.pass).length;
  const lines = [`Pass rate: ${passed}/${items.length} (${percent(passed, items.length)})`];
  for (const type of perType) {
    lines.push(
      `  ${type.type.padEnd(14)} ${type.pass}/${type.total}  ${percent(type.pass, type.total)}`,
    );
  }
  const latencies = items.map((item) => item.result.trace.latencyMs).sort((a, b) => a - b);
  lines.push(
    `Latency: p50 ${seconds(percentile(latencies, 0.5))}, p95 ${seconds(percentile(latencies, 0.95))}`,
  );
  const failures = commonFailures(items);
  if (failures.length > 0) {
    lines.push('Most common failure reasons:');
    for (const failure of failures) {
      lines.push(
        `  ${String(failure.count).padStart(3)}x  ${failure.reason}  (for example ${failure.example})`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Failure reasons grouped with their numbers and quoted values blanked out, most common first. */
function commonFailures(items: readonly EvaluationItem[]) {
  const groups = new Map<string, { reason: string; count: number; example: string }>();
  for (const { task, result } of items) {
    if (result.check.pass) continue;
    const reason = result.check.reason.replace(/"[^"]*"/g, '"..."').replace(/-?\d+(\.\d+)?/g, '#');
    const group = groups.get(reason) ?? { reason, count: 0, example: task.id };
    group.count += 1;
    groups.set(reason, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}

/** Nearest-rank percentile of sorted values. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

function parseArguments(args: readonly string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, number>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const value = Number(args[index + 1]);
    if (!['--limit', '--seed', '--concurrency'].includes(arg) || !Number.isInteger(value)) {
      throw new Error(USAGE);
    }
    flags.set(arg, value);
    index += 1;
  }
  const [jobDir, split = 'calibration'] = positional;
  if (!jobDir || positional.length > 2) throw new Error(USAGE);
  if (split === 'test') {
    throw new Error('The test split stays locked; calibrate on calibration, train or dev.');
  }
  if (!isCalibrationSplit(split)) throw new Error(USAGE);
  const limit = flags.get('--limit');
  return {
    jobDir: resolve(jobDir),
    split,
    ...(limit === undefined ? {} : { limit }),
    seed: flags.get('--seed') ?? 1,
    concurrency: flags.get('--concurrency') ?? 1,
  };
}

function isCalibrationSplit(value: string): value is CalibrationSplit {
  return (SPLITS as readonly string[]).includes(value);
}

function parseTasks(content: string): Task[] {
  return content
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line !== '')
    .map(({ line, number }) => {
      const parsed = TaskSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`tasks.jsonl line ${number}: ${parsed.error.message}`);
      return parsed.data;
    });
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '-' : `${Math.round((100 * part) / whole)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function write(text: string): void {
  process.stdout.write(text);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
