/**
 * Calibration: how well a student does on a job before any mentoring. A developer tool; it is not
 * part of the app and never runs in CI.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/calibrate.ts <jobDir> [split] [--limit N]
 *     [--seed N] [--concurrency N] [--traces <dir>] [--task <id,id,...>] [--student <preset>]
 *     [--graduate <dir>] [--model <name>] [--threads N]
 *
 * --traces writes each attempt's full trace as `<taskId>.json` into <dir>, to read why it failed.
 * --task keeps only the named tasks of the split.
 * --student runs a hosted student preset (e.g. openrouter-glimmer) instead of the job's local one;
 * its key comes from the environment (OPENROUTER_API_KEY, TOGETHER_API_KEY or DEEPINFRA_API_KEY).
 * --graduate runs the tasks inside a graduate folder's harness instead of a blank one, to see how
 * a trained harness does with another student; --model names another model on the job's local
 * runtime, such as a smaller build that fits the GPU; --threads caps its CPU threads.
 *
 * <jobDir> holds job.json, tasks.jsonl, data/ and the checker module. [split] is calibration
 * (the default), train or dev; the test split stays locked in the vault. The student is the job's
 * local endpoint, normally Ollama, so the model loads on this machine for the duration of the run.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createStudent } from '@architect/adapters';
import { blankHarness, readGraduate } from '@architect/harness';
import {
  JobSchema,
  STUDENT_PRESETS,
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

const KEY_ENV: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
};

/**
 * The student being calibrated: the job's local endpoint (with another model on it when one is
 * named), or a hosted preset.
 */
function createCalibrationStudent(job: Job, options: Options): StudentAdapter {
  const presetKey = options.student;
  if (presetKey === undefined) {
    return createStudent(
      { ...job.student.local, ...(options.model === undefined ? {} : { model: options.model }) },
      {
        label: job.student.label,
        ...(options.threads === undefined ? {} : { cpuThreads: options.threads }),
      },
    );
  }
  const preset = STUDENT_PRESETS.find((candidate) => candidate.key === presetKey);
  if (!preset || preset.runtime !== 'openai_compatible' || preset.secretRef === undefined) {
    throw new Error(`"${presetKey}" is not a hosted student preset.`);
  }
  const apiKey = process.env[KEY_ENV[preset.secretRef] ?? ''];
  if (!apiKey) throw new Error(`Set ${KEY_ENV[preset.secretRef]} to use ${preset.label}.`);
  return createStudent(
    {
      runtime: preset.runtime,
      baseUrl: preset.baseUrl,
      model: preset.model,
      secretRef: preset.secretRef,
      contextLength: job.student.local.contextLength,
    },
    { apiKey, label: preset.label },
  );
}

const SPLITS = ['calibration', 'train', 'dev'] as const;
type CalibrationSplit = (typeof SPLITS)[number];

interface Options {
  jobDir: string;
  split: CalibrationSplit;
  limit?: number;
  seed: number;
  concurrency: number;
  traces?: string;
  taskIds?: string[];
  student?: string;
  /** A graduate folder whose harness the tasks run in; a blank harness otherwise. */
  graduate?: string;
  /** Another model on the job's local runtime. */
  model?: string;
  /** CPU threads the local model may use. */
  threads?: number;
}

const USAGE =
  'Usage: tsx scripts/calibrate.ts <jobDir> [calibration|train|dev] [--limit N] [--seed N] [--concurrency N] [--traces <dir>] [--task <id,id,...>] [--student <preset>] [--graduate <dir>] [--model <name>] [--threads N]';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const job = JobSchema.parse(JSON.parse(await readFile(join(options.jobDir, 'job.json'), 'utf8')));
  const tasks = parseTasks(await readFile(join(options.jobDir, 'tasks.jsonl'), 'utf8'));
  const inSplit = splitTasks(tasks, job.splits)[options.split];
  const chosen = options.taskIds;
  const selected = (
    chosen === undefined ? inSplit : inSplit.filter((task) => chosen.includes(task.id))
  ).slice(0, options.limit);

  const student = createCalibrationStudent(job, options);
  const harness =
    options.graduate === undefined
      ? blankHarness(job.name, job.description)
      : (await readGraduate(options.graduate)).harness;
  if (options.traces !== undefined) await mkdir(options.traces, { recursive: true });
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
        harness,
        student,
        sandbox,
        checker,
      },
      {
        seed: options.seed,
        concurrency: options.concurrency,
        onAttempt: ({ task, result: attempt }) => {
          if (options.traces !== undefined) {
            const file = join(options.traces, `${task.id}.json`);
            void writeFile(
              file,
              `${JSON.stringify({ task, ...attempt }, null, 2)}
`,
            );
          }
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
  const named = new Map<string, string>();
  let traces: string | undefined;
  let taskIds: string[] | undefined;
  let studentPreset: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (arg === '--student') {
      studentPreset = args[index + 1];
      if (studentPreset === undefined) throw new Error(USAGE);
      index += 1;
      continue;
    }
    if (arg === '--graduate' || arg === '--model') {
      const value = args[index + 1];
      if (value === undefined) throw new Error(USAGE);
      named.set(arg, arg === '--graduate' ? resolve(value) : value);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      const list = args[index + 1];
      if (list === undefined) throw new Error(USAGE);
      taskIds = list.split(',').filter((id) => id !== '');
      index += 1;
      continue;
    }
    if (arg === '--traces') {
      const dir = args[index + 1];
      if (dir === undefined) throw new Error(USAGE);
      traces = resolve(dir);
      index += 1;
      continue;
    }
    const value = Number(args[index + 1]);
    if (
      !['--limit', '--seed', '--concurrency', '--threads'].includes(arg) ||
      !Number.isInteger(value)
    ) {
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
    ...(traces === undefined ? {} : { traces }),
    ...(taskIds === undefined ? {} : { taskIds }),
    ...(studentPreset === undefined ? {} : { student: studentPreset }),
    ...(named.has('--graduate') ? { graduate: named.get('--graduate') } : {}),
    ...(named.has('--model') ? { model: named.get('--model') } : {}),
    ...(flags.has('--threads') ? { threads: flags.get('--threads') } : {}),
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
