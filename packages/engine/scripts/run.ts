/**
 * One training run, headless: imports a job, runs one method end to end with real models, prints
 * every event and the report card. A developer tool; it is not part of the app and never runs in CI.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/run.ts <jobDir> [--method architect]
 *     [--seed 1] [--profile smoke|full] [--mentor <preset>] [--student local|<preset>]
 *     [--data <dir>]
 *
 * The smoke profile keeps the job's data and task pool but asks for small splits and one round, so
 * a run finishes in under an hour on a local student. `--mentor` takes a mentor preset key (for
 * example meta-spark-contributor) and `--student` a hosted student preset key (for example
 * openrouter-glimmer) to train on a hosted copy. Keys come from the environment: META_API_TOKEN,
 * OPENROUTER_API_KEY, TOGETHER_API_KEY, DEEPINFRA_API_KEY, BASETEN_API_KEY, MODAL_PROXY_TOKEN.
 */
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  JobSchema,
  MENTOR_PRESETS,
  METHOD_LABELS,
  MethodSchema,
  STUDENT_PRESETS,
  type Job,
  type Method,
  type RunEvent,
} from '@architect/shared';
import { createEngineDeps, createEngineHost } from '../src';

const SECRET_ENV: Record<string, string> = {
  meta: 'META_API_TOKEN',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  baseten: 'BASETEN_API_KEY',
  modal: 'MODAL_PROXY_TOKEN',
};

interface Options {
  jobDir: string;
  method: Method;
  seed: number;
  profile: 'smoke' | 'full';
  mentor?: string;
  student: string;
  dataDir?: string;
}

const USAGE =
  'Usage: tsx scripts/run.ts <jobDir> [--method architect|bare|one_shot|self_reflection] [--seed N] [--profile smoke|full] [--mentor <preset>] [--student local|<preset>] [--data <dir>]';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const source = JobSchema.parse(
    JSON.parse(await readFile(join(options.jobDir, 'job.json'), 'utf8')),
  );
  const job = adjust(source, options);

  const staging = await mkdtemp(join(tmpdir(), 'architect-run-'));
  await cp(options.jobDir, staging, { recursive: true });
  await writeFile(join(staging, 'job.json'), `${JSON.stringify(job, null, 2)}\n`);

  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'architect-data-')));
  const host = await createEngineHost({
    dataDir,
    deps: createEngineDeps({
      dataDir,
      getSecret: async (ref) => {
        const name = SECRET_ENV[ref];
        return name === undefined ? undefined : process.env[name] || undefined;
      },
    }),
  });

  try {
    const imported = await host.api.jobs.importFile(join(staging, 'job.json'));
    write(
      `${imported.name}: ${METHOD_LABELS[options.method]}, seed ${options.seed}, ${options.profile} profile\n` +
        `mentor ${imported.mentor.kind === 'model' ? imported.mentor.model : imported.mentor.agent}, ` +
        `student ${imported.student.local.model} (train on ${imported.student.trainOn}), data in ${dataDir}\n\n`,
    );
    const finished = new Promise<string>((done) => {
      host.api.runs.onEvent((event) => {
        const line = describe(event);
        if (line) write(`${clock()}  ${line}\n`);
        if (event.type === 'run.updated' && isTerminal(event.run.status)) done(event.run.id);
      });
    });
    const run = await host.api.runs.start(imported.id, {
      method: options.method,
      seed: options.seed,
    });
    const runId = await finished;
    const detail = await host.api.runs.get(runId);
    write(
      `\nRun ${run.id} ended: ${detail.run.status}${detail.run.error ? ` (${detail.run.error})` : ''}\n`,
    );
    if (detail.run.status === 'finished') {
      const report = await host.api.reports.get(runId);
      write(
        `Locked test: ${report.test.score.pass}/${report.test.score.total}; ` +
          report.test.perType.map((type) => `${type.type} ${type.pass}/${type.total}`).join(', ') +
          `\nLatency p50 ${seconds(report.test.latencyMs.p50)}, p95 ${seconds(report.test.latencyMs.p95)}; ` +
          `mentor $${report.cost.mentorUsd.toFixed(4)} over ${report.cost.rounds} rounds\n`,
      );
    }
  } finally {
    await host.close();
  }
}

/** Applies the profile and model choices to a copy of the job. */
function adjust(job: Job, options: Options): Job {
  let next: Job = { ...job };
  if (options.profile === 'smoke') {
    next = {
      ...next,
      splits: { ...next.splits, calibration: 0, train: 9, dev: 6, test: 6 },
      evaluation: { ...next.evaluation, trainBatch: 3, minDevGain: 1, patience: 1 },
      budget: { maxRounds: 1, maxMentorUsd: 1, maxWallMinutes: 120 },
    };
  }
  if (options.mentor !== undefined) {
    const preset = MENTOR_PRESETS.find((candidate) => candidate.key === options.mentor);
    if (!preset) throw new Error(`Unknown mentor preset "${options.mentor}".`);
    next = {
      ...next,
      mentor: {
        kind: 'model',
        provider: preset.provider,
        label: 'Spark',
        baseUrl: preset.baseUrl,
        model: preset.model,
        reasoningEffort: 'medium',
        secretRef: preset.provider,
      },
    };
  }
  if (options.student !== 'local') {
    const preset = STUDENT_PRESETS.find((candidate) => candidate.key === options.student);
    if (!preset || preset.runtime !== 'openai_compatible') {
      throw new Error(`"${options.student}" is not a hosted student preset.`);
    }
    next = {
      ...next,
      student: {
        ...next.student,
        trainOn: 'hosted',
        hosted: {
          runtime: preset.runtime,
          baseUrl: preset.baseUrl,
          model: preset.model,
          secretRef: preset.key.replace(/-glimmer$/, ''),
          contextLength: next.student.local.contextLength,
        },
      },
    };
  }
  return JobSchema.parse(next);
}

function describe(event: RunEvent): string | null {
  switch (event.type) {
    case 'run.updated':
      return `run ${event.run.status} (${event.run.phase})${event.run.error ? `: ${event.run.error}` : ''}`;
    case 'round.updated': {
      const round = event.round;
      const dev =
        round.devBefore && round.devAfter
          ? ` dev ${round.devBefore.pass} -> ${round.devAfter.pass}/${round.devAfter.total}`
          : '';
      return `round ${round.index} ${round.status}${round.title ? `: ${round.title}` : ''}${dev}${round.decision ? `, ${round.decision}` : ''}`;
    }
    case 'attempt.finished': {
      const attempt = event.attempt;
      return `${attempt.split.padEnd(5)} ${attempt.check.pass ? 'pass' : 'FAIL'}  ${attempt.taskId}  ${seconds(attempt.latencyMs)}  ${attempt.check.reason}`;
    }
    case 'mentor.finished':
      return `mentor answered round ${event.round}: ${event.usage.inputTokens} in, ${event.usage.outputTokens} out, ${event.costUsd === null ? 'cost unknown' : `$${event.costUsd.toFixed(4)}`}`;
    case 'eval.finished':
      return `${event.split} v${event.harnessVersion}: ${event.score.pass}/${event.score.total}`;
    case 'log':
      return `${event.level}: ${event.message}`;
    case 'graduate.ready':
      return `graduate ready: ${event.graduateId}`;
    default:
      return null;
  }
}

function isTerminal(status: string): boolean {
  return status === 'finished' || status === 'failed' || status === 'stopped';
}

function parseArguments(args: readonly string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) throw new Error(USAGE);
    flags.set(arg, value);
    index += 1;
  }
  const [jobDir] = positional;
  if (!jobDir || positional.length > 1) throw new Error(USAGE);
  const profile = flags.get('--profile') ?? 'smoke';
  if (profile !== 'smoke' && profile !== 'full') throw new Error(USAGE);
  const seed = Number(flags.get('--seed') ?? '1');
  if (!Number.isInteger(seed)) throw new Error(USAGE);
  const mentor = flags.get('--mentor');
  const dataDir = flags.get('--data');
  return {
    jobDir: resolve(jobDir),
    method: MethodSchema.parse(flags.get('--method') ?? 'architect'),
    seed,
    profile,
    student: flags.get('--student') ?? 'local',
    ...(mentor === undefined ? {} : { mentor }),
    ...(dataDir === undefined ? {} : { dataDir: resolve(dataDir) }),
  };
}

function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function write(text: string): void {
  process.stdout.write(text);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
