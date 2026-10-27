/**
 * The comparison runs behind the README's results: an optional noise pilot, then every method on
 * every seed, each in its own data folder, with training and the locked test on a hosted copy of
 * the student. A developer tool; it is not part of the app and never runs in CI.
 *
 *   pnpm --filter @architect/engine exec tsx scripts/experiment.ts <jobDir> --out <dir>
 *     [--seeds 1,2,3] [--methods bare,one_shot,self_reflection,architect]
 *     [--student openrouter-glimmer] [--mentor meta-spark] [--parallel 2] [--concurrency 6]
 *     [--pilot] [--pilot-only] [--retest-local 1]
 *
 * --retest-local takes seeds whose finished runs get their frozen graduate tested again on the
 * local student, one at a time (it loads the model on this machine), into
 * <out>/results/<method>-s<seed>-local.json.
 * Results land in <out>/results/<method>-s<seed>.json, the pilot in <out>/pilot.json, and a table
 * of everything in <out>/summary.md. A run whose result file exists is skipped, so the script can
 * simply be started again after an interruption. Keys come from the environment, as in run.ts.
 */
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  type ReportCard,
  type RunDetail,
} from '@architect/shared';
import {
  createEngineDeps,
  createEngineHost,
  DataPaths,
  devNoisePilot,
  JobLibrary,
  openEngineStore,
  systemClock,
} from '../src';

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
  out: string;
  seeds: number[];
  methods: Method[];
  student: string;
  mentor: string;
  parallel: number;
  concurrency: number;
  pilot: boolean;
  pilotOnly: boolean;
  retestLocal: number[];
}

interface RunResult {
  method: Method;
  seed: number;
  detail: RunDetail;
  report: ReportCard | null;
  /** What the run spent, from its own cost records: the hosted student and the mentor. */
  spend: { studentUsd: number; mentorUsd: number };
}

/** A run paused by an error (a hosted endpoint down, say) is resumed this many times at most. */
const MAX_RESUMES = 5;
const RESUME_AFTER_MS = 60_000;

const getSecret = async (ref: string) => {
  const name = SECRET_ENV[ref];
  return name === undefined ? undefined : process.env[name] || undefined;
};

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  await mkdir(join(options.out, 'results'), { recursive: true });
  const source = JobSchema.parse(
    JSON.parse(await readFile(join(options.jobDir, 'job.json'), 'utf8')),
  );
  const staging = await stageJob(options.jobDir, prepare(source, options));
  log(`Job ${source.name}: ${options.methods.length} methods x ${options.seeds.length} seeds`);

  if (options.pilot || options.pilotOnly) await runPilot(staging, options);
  if (options.pilotOnly) return;
  if (options.retestLocal.length > 0) {
    await retestLocally(options);
    await writeSummary(options);
    return;
  }

  const queue = options.methods.flatMap((method) =>
    options.seeds.map((seed) => ({ method, seed })),
  );
  const pending = queue.filter(
    ({ method, seed }) => !existsSync(resultFile(options, method, seed)),
  );
  log(`${queue.length - pending.length} runs already done, ${pending.length} to go`);
  await runLimited(pending, options.parallel, ({ method, seed }) =>
    runOne(staging, options, method, seed),
  );
  await writeSummary(options);
}

/** Training and the locked test on the hosted student preset, with the chosen mentor preset. */
function prepare(job: Job, options: Options): Job {
  const mentor = MENTOR_PRESETS.find((preset) => preset.key === options.mentor);
  if (!mentor) throw new Error(`Unknown mentor preset "${options.mentor}".`);
  const student = STUDENT_PRESETS.find((preset) => preset.key === options.student);
  if (!student || student.runtime !== 'openai_compatible' || student.secretRef === undefined) {
    throw new Error(`"${options.student}" is not a hosted student preset.`);
  }
  return JobSchema.parse({
    ...job,
    mentor: {
      kind: 'model',
      provider: mentor.provider,
      label: 'Spark',
      baseUrl: mentor.baseUrl,
      model: mentor.model,
      reasoningEffort: 'medium',
      secretRef: mentor.secretRef,
    },
    student: {
      ...job.student,
      trainOn: 'hosted',
      hosted: {
        runtime: student.runtime,
        baseUrl: student.baseUrl,
        model: student.model,
        secretRef: student.secretRef,
        contextLength: job.student.local.contextLength,
      },
    },
  });
}

async function stageJob(jobDir: string, job: Job): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'architect-experiment-'));
  await cp(jobDir, staging, { recursive: true });
  await writeFile(join(staging, 'job.json'), `${JSON.stringify(job, null, 2)}\n`);
  return join(staging, 'job.json');
}

/** How far dev moves on its own under three student seeds, before any comparison is trusted. */
async function runPilot(jobFile: string, options: Options): Promise<void> {
  const pilotFile = join(options.out, 'pilot.json');
  if (existsSync(pilotFile)) {
    log('Noise pilot already done');
    return;
  }
  const dataDir = join(options.out, 'pilot');
  await mkdir(dataDir, { recursive: true });
  const deps = createEngineDeps({ dataDir, getSecret });
  const paths = new DataPaths(dataDir);
  const store = openEngineStore(paths.database);
  try {
    const jobs = new JobLibrary(store, paths, deps, systemClock);
    const job = await jobs.importFile(jobFile);
    log('Noise pilot: dev under three student seeds, starting harness');
    const report = await devNoisePilot(
      { jobs, paths, deps },
      { jobId: job.id, target: 'hosted', concurrency: options.concurrency, seed: 0 },
    );
    await writeFile(pilotFile, `${JSON.stringify(report, null, 2)}\n`);
    log(
      `Noise pilot: ${report.runs.map((run) => `${run.score.pass}/${run.score.total}`).join(', ')}; ` +
        `spread ${report.spread}, ${report.flips} tasks flipped, margin ${report.margin} ${report.marginHolds ? 'holds' : 'does NOT hold'}`,
    );
  } finally {
    store.close();
  }
}

async function runOne(jobFile: string, options: Options, method: Method, seed: number) {
  const name = `${method}-s${seed}`;
  const dataDir = join(options.out, 'runs', name);
  await mkdir(dataDir, { recursive: true });
  const host = await createEngineHost({
    dataDir,
    deps: createEngineDeps({ dataDir, getSecret }),
    concurrency: options.concurrency,
  });
  try {
    const job = await host.api.jobs.importFile(jobFile);
    let resumes = 0;
    const finished = new Promise<string>((done) => {
      host.api.runs.onEvent((event) => {
        if (event.type === 'round.updated' && event.round.decision) {
          const { round } = event;
          log(
            `${name} round ${round.index} ${round.decision}: ${round.title ?? ''}. ${round.decisionReason ?? ''}`,
          );
        }
        if (event.type === 'log' && event.level !== 'info')
          log(`${name} ${event.level}: ${event.message}`);
        if (event.type !== 'run.updated') return;
        const { run } = event;
        if (isTerminal(run.status)) done(run.id);
        if (run.status !== 'paused') return;
        if (resumes >= MAX_RESUMES) {
          log(`${name}: paused ${resumes + 1} times, leaving it paused: ${run.error ?? ''}`);
          done(run.id);
          return;
        }
        resumes += 1;
        log(`${name}: paused (${run.error ?? 'no reason'}); resuming in a minute`);
        setTimeout(() => {
          host.api.runs.resume(run.id).catch((error: unknown) => {
            log(`${name}: resume failed: ${String(error)}`);
            done(run.id);
          });
        }, RESUME_AFTER_MS);
      });
    });
    log(`${name}: started`);
    await host.api.runs.start(job.id, { method, seed, lockedTestOn: 'hosted' });
    const runId = await finished;
    const detail = await host.api.runs.get(runId);
    const report = detail.run.status === 'finished' ? await host.api.reports.get(runId) : null;
    const result: RunResult = { method, seed, detail, report, spend: spendOf(dataDir, runId) };
    await writeFile(resultFile(options, method, seed), `${JSON.stringify(result, null, 2)}\n`);
    log(
      `${name}: ${detail.run.status}` +
        (report ? `, test ${report.test.score.pass}/${report.test.score.total}` : '') +
        `, student $${result.spend.studentUsd.toFixed(2)}, mentor $${result.spend.mentorUsd.toFixed(3)}`,
    );
  } finally {
    await host.close();
  }
}

/** A run's recorded spend by role, read from its data folder's database. */
function spendOf(dataDir: string, runId: string): RunResult['spend'] {
  const store = openEngineStore(new DataPaths(dataDir).database);
  try {
    const costs = store.costs.list(runId);
    const total = (role: string) =>
      costs.filter((cost) => cost.role === role).reduce((sum, cost) => sum + (cost.usd ?? 0), 0);
    return { studentUsd: total('student'), mentorUsd: total('mentor') };
  } finally {
    store.close();
  }
}

/** Tests the frozen graduates of finished runs again on the local student, one run at a time. */
async function retestLocally(options: Options): Promise<void> {
  for (const method of options.methods) {
    for (const seed of options.retestLocal) {
      const name = `${method}-s${seed}`;
      const hostedFile = resultFile(options, method, seed);
      const localFile = join(options.out, 'results', `${name}-local.json`);
      if (existsSync(localFile)) continue;
      if (!existsSync(hostedFile)) {
        log(`${name}: no finished run to test locally`);
        continue;
      }
      const { detail } = JSON.parse(await readFile(hostedFile, 'utf8')) as RunResult;
      if (detail.run.status !== 'finished') continue;
      const dataDir = join(options.out, 'runs', name);
      const host = await createEngineHost({
        dataDir,
        deps: createEngineDeps({ dataDir, getSecret }),
        concurrency: 1,
      });
      try {
        const runId = detail.run.id;
        const outcome = new Promise<'finished' | string>((done) => {
          host.api.runs.onEvent((event) => {
            if (event.runId !== runId) return;
            if (event.type === 'eval.progress' && event.split === 'test') {
              log(`${name} local test ${event.done}/${event.total}, ${event.pass} passed`);
            }
            if (event.type === 'eval.finished' && event.split === 'test') done('finished');
            if (event.type === 'log' && event.level === 'error') done(event.message);
          });
        });
        log(`${name}: locked test again on the local student`);
        await host.api.runs.retest(runId, 'local');
        const result = await outcome;
        if (result !== 'finished') {
          log(`${name}: local test paused: ${result}`);
          continue;
        }
        const report = await host.api.reports.get(runId, 'local');
        await writeFile(localFile, `${JSON.stringify({ method, seed, report }, null, 2)}\n`);
        log(`${name}: local test ${report.test.score.pass}/${report.test.score.total}`);
      } finally {
        await host.close();
      }
    }
  }
}

async function writeSummary(options: Options): Promise<void> {
  const rows: string[] = [
    '| Method | Seed | Locked test | Invoices | Overdue | Scheduling | Dev start to end | Kept / rounds | Stop | Minutes | Student $ | Mentor $ |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  // Dev totals differ when a round measured twice, so dev shows as a pass rate.
  const rate = (score: { pass: number; total: number } | null) =>
    score && score.total > 0 ? `${Math.round((100 * score.pass) / score.total)}%` : '-';
  for (const method of options.methods) {
    for (const seed of options.seeds) {
      const file = resultFile(options, method, seed);
      if (!existsSync(file)) continue;
      const { detail, report, spend } = JSON.parse(await readFile(file, 'utf8')) as RunResult;
      const { run } = detail;
      const kept = detail.rounds.filter((round) => round.decision === 'kept').length;
      const tail =
        `${kept} / ${run.totals.rounds} | ${run.stopReason ?? '-'} | ${Math.round(run.totals.wallMs / 60_000)} | ` +
        `${spend.studentUsd.toFixed(2)} | ${spend.mentorUsd.toFixed(3)} |`;
      if (!report) {
        rows.push(`| ${METHOD_LABELS[method]} | ${seed} | ${run.status} | | | | | ${tail}`);
        continue;
      }
      const type = (id: string) => {
        const result = report.test.perType.find((entry) => entry.type === id);
        return result ? `${result.pass}/${result.total}` : '-';
      };
      rows.push(
        `| ${METHOD_LABELS[method]} | ${seed} | ${report.test.score.pass}/${report.test.score.total} | ` +
          `${type('invoice')} | ${type('overdue')} | ${type('schedule')} | ` +
          `${rate(report.dev.baseline)} to ${rate(report.dev.final)} | ${tail}`,
      );
    }
  }
  await writeFile(join(options.out, 'summary.md'), `${rows.join('\n')}\n`);
  log(`Summary written to ${join(options.out, 'summary.md')}`);
}

/** Runs the tasks with at most `limit` in flight. */
async function runLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await run(item);
    }
  });
  await Promise.all(workers);
}

function resultFile(options: Options, method: Method, seed: number): string {
  return join(options.out, 'results', `${method}-s${seed}.json`);
}

function isTerminal(status: string): boolean {
  return status === 'finished' || status === 'failed' || status === 'stopped';
}

const USAGE =
  'Usage: tsx scripts/experiment.ts <jobDir> --out <dir> [--seeds 1,2,3] [--methods ...] [--student <preset>] [--mentor <preset>] [--parallel N] [--concurrency N] [--pilot] [--pilot-only] [--retest-local <seeds>]';

function parseArguments(args: readonly string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let pilot = false;
  let pilotOnly = false;
  let retestLocal: number[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--pilot') {
      pilot = true;
      continue;
    }
    if (arg === '--pilot-only') {
      pilotOnly = true;
      continue;
    }
    if (arg === '--retest-local') {
      retestLocal = (args[index + 1] ?? '').split(',').map((part) => Number(part));
      if (retestLocal.some((seed) => !Number.isInteger(seed))) throw new Error(USAGE);
      index += 1;
      continue;
    }
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
  const out = flags.get('--out');
  if (!jobDir || !out || positional.length > 1) throw new Error(USAGE);
  const numbers = (text: string) => text.split(',').map((part) => Number(part));
  const seeds = numbers(flags.get('--seeds') ?? '1,2,3');
  if (seeds.some((seed) => !Number.isInteger(seed))) throw new Error(USAGE);
  return {
    jobDir: resolve(jobDir),
    out: resolve(out),
    seeds,
    methods: (flags.get('--methods') ?? 'bare,one_shot,self_reflection,architect')
      .split(',')
      .map((method) => MethodSchema.parse(method)),
    student: flags.get('--student') ?? 'openrouter-glimmer',
    mentor: flags.get('--mentor') ?? 'meta-spark',
    parallel: Number(flags.get('--parallel') ?? '2'),
    concurrency: Number(flags.get('--concurrency') ?? '6'),
    pilot,
    pilotOnly,
    retestLocal,
  };
}

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
