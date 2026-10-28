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
import { execFileSync } from 'node:child_process';
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
import { seededRandom } from '../src/loop/seeds';

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
  /** CPU threads a local student may use, to keep the computer quieter; its default otherwise. */
  threads?: number;
  /** How long a local student rests after each reply, as a share of the reply's time. */
  cooldown?: number;
}

interface RunResult {
  method: Method;
  seed: number;
  detail: RunDetail;
  report: ReportCard | null;
  /** What the run spent, from its own cost records: the hosted student and the mentor. */
  spend: { studentUsd: number; mentorUsd: number };
  /** The commit the script ran from, so a result can be traced to its code. */
  commit: string;
}

const COMMIT = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

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
  // Each seed's one-shot draft is where the refining methods start, so they go second.
  await runLimited(
    pending.filter(({ method }) => !REFINERS.includes(method)),
    options.parallel,
    ({ method, seed }) => runOne(staging, options, method, seed),
  );
  await runLimited(
    pending.filter(({ method }) => REFINERS.includes(method)),
    options.parallel,
    async ({ method, seed }) => {
      const name = `${method}-s${seed}`;
      const oneShot = await oneShotOf(options, seed);
      if (oneShot === null) {
        log(`${name}: seed ${seed} has no finished one-shot run yet, skipped`);
        return;
      }
      // A draft refused even after its fix leaves nothing to share: the method drafts for itself.
      if (!keptDraft(oneShot)) {
        log(`${name}: the seed's one-shot draft was refused, so it starts from blank`);
        await runOne(staging, options, method, seed);
        return;
      }
      const forked = await stageFork(options, prepare(source, options), seed, oneShot);
      if (forked === null) {
        log(`${name}: the seed's one-shot draft folder is missing, skipped`);
        return;
      }
      await runOne(forked, options, method, seed);
    },
  );
  await writeSummary(options);
}

/**
 * Methods that refine each seed's shared draft (decision 026): they start from the harness the
 * seed's one-shot run wrote, with that round and its mentor spend taken off their budget.
 */
const REFINERS: readonly Method[] = ['architect', 'self_reflection'];

/** The seed's one-shot result, when that run finished. */
async function oneShotOf(options: Options, seed: number): Promise<RunResult | null> {
  const file = resultFile(options, 'one_shot', seed);
  if (!existsSync(file)) return null;
  const result = JSON.parse(await readFile(file, 'utf8')) as RunResult;
  return result.detail.run.status === 'finished' ? result : null;
}

/** Whether a one-shot run kept its draft; one refused even after its fix tested the blank start. */
function keptDraft(oneShot: RunResult): boolean {
  return oneShot.detail.rounds.some((round) => round.index === 1 && round.decision === 'kept');
}

/** The seed's one-shot result when its draft was kept and so is shared with the refiners. */
async function sharedDraftOf(options: Options, seed: number): Promise<RunResult | null> {
  const oneShot = await oneShotOf(options, seed);
  return oneShot !== null && keptDraft(oneShot) ? oneShot : null;
}

/** A job file whose starting harness is the seed's one-shot draft, with the draft's round spent. */
async function stageFork(
  options: Options,
  job: Job,
  seed: number,
  draft: RunResult,
): Promise<string | null> {
  const { run } = draft.detail;
  const dataDir = join(options.out, 'runs', `one_shot-s${seed}`);
  const version = `v${String(run.currentVersion).padStart(4, '0')}`;
  const folder = join(new DataPaths(dataDir).harnessDir(run.jobId, run.id), version);
  if (!existsSync(folder)) return null;
  const staging = await mkdtemp(join(tmpdir(), `architect-experiment-s${seed}-`));
  await cp(options.jobDir, staging, { recursive: true });
  await cp(folder, join(staging, 'draft'), { recursive: true });
  const forked = JobSchema.parse({
    ...job,
    startingHarness: { kind: 'import', path: 'draft' },
    budget: {
      ...job.budget,
      maxRounds: job.budget.maxRounds - 1,
      maxMentorUsd: Math.max(0, job.budget.maxMentorUsd - draft.spend.mentorUsd),
    },
  });
  await writeFile(join(staging, 'job.json'), `${JSON.stringify(forked, null, 2)}\n`);
  return join(staging, 'job.json');
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
  const deps = engineDeps(options, dataDir);
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
    deps: engineDeps(options, dataDir),
    concurrency: options.concurrency,
  });
  try {
    // Pauses in a row with no attempt finished between them; any progress starts the count over.
    let resumes = 0;
    let settle: (runId: string) => void = () => {};
    const finished = new Promise<string>((done) => {
      settle = done;
    });
    host.api.runs.onEvent((event) => {
      if (event.type === 'attempt.finished') resumes = 0;
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
      if (isTerminal(run.status)) settle(run.id);
      if (run.status !== 'paused') return;
      if (resumes >= MAX_RESUMES) {
        log(`${name}: paused ${resumes + 1} times in a row, leaving it paused: ${run.error ?? ''}`);
        settle(run.id);
        return;
      }
      resumes += 1;
      log(`${name}: paused (${run.error ?? 'no reason'}); resuming in a minute`);
      setTimeout(() => {
        host.api.runs.resume(run.id).catch((error: unknown) => {
          log(`${name}: resume failed: ${String(error)}`);
          settle(run.id);
        });
      }, RESUME_AFTER_MS);
    });

    // A folder from an interrupted start already holds its run: the host has recovered it if it
    // was running, and a paused one is resumed here. Starting another would pay twice.
    const earlier = (await host.api.runs.list()).find(
      (run) => run.method === method && run.seed === seed,
    );
    let runId: string;
    if (earlier === undefined) {
      const job = await host.api.jobs.importFile(jobFile);
      log(`${name}: started`);
      await host.api.runs.start(job.id, { method, seed, lockedTestOn: 'hosted' });
      runId = await finished;
    } else {
      log(`${name}: continuing the run this folder holds (${earlier.status})`);
      if (earlier.status === 'paused') await host.api.runs.resume(earlier.id);
      // It may have ended before the listener was attached.
      const now = (await host.api.runs.get(earlier.id)).run.status;
      runId = isTerminal(now) ? earlier.id : await finished;
    }
    const detail = await host.api.runs.get(runId);
    if (detail.run.status === 'paused') {
      log(`${name}: left paused with no result file, so running the script again continues it`);
      return;
    }
    const report = detail.run.status === 'finished' ? await host.api.reports.get(runId) : null;
    const result: RunResult = {
      method,
      seed,
      detail,
      report,
      spend: spendOf(dataDir, runId),
      commit: COMMIT,
    };
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
        deps: engineDeps(options, dataDir),
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
      // A refining method's draft round and its mentor spend happened in the seed's one-shot run.
      const draft = REFINERS.includes(method) ? await sharedDraftOf(options, seed) : null;
      const shared = draft === null ? 0 : 1;
      const kept = detail.rounds.filter((round) => round.decision === 'kept').length + shared;
      const mentorUsd = spend.mentorUsd + (draft?.spend.mentorUsd ?? 0);
      const tail =
        `${kept} / ${run.totals.rounds + shared} | ${run.stopReason ?? '-'} | ${Math.round(run.totals.wallMs / 60_000)} | ` +
        `${spend.studentUsd.toFixed(2)} | ${mentorUsd.toFixed(3)} |`;
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
  const paired = await pairedComparison(options);
  const note =
    'Architect and self-reflection start from the one-shot draft of the same seed (decision 026); their kept changes, rounds and mentor dollars include that draft.';
  await writeFile(
    join(options.out, 'summary.md'),
    `${[rows.join('\n'), note, ...paired].join('\n\n')}\n`,
  );
  log(`Summary written to ${join(options.out, 'summary.md')}`);
}

/** A finished run's locked test, task by task, read from its data folder. */
async function testOutcomes(options: Options, method: Method, seed: number) {
  const file = resultFile(options, method, seed);
  if (!existsSync(file)) return null;
  const { detail } = JSON.parse(await readFile(file, 'utf8')) as RunResult;
  if (detail.run.status !== 'finished') return null;
  const store = openEngineStore(
    new DataPaths(join(options.out, 'runs', `${method}-s${seed}`)).database,
  );
  try {
    const attempts = store.attempts.list({ runId: detail.run.id, split: 'test', target: 'hosted' });
    return new Map(attempts.map((attempt) => [attempt.taskId, attempt.check.pass]));
  } finally {
    store.close();
  }
}

const BOOTSTRAP_DRAWS = 10_000;

/**
 * Architect against each other method on the same locked test tasks, seed by seed: tasks only
 * Architect passed, tasks only the other passed, and the difference in pass rate with a 95%
 * interval from resampling tasks (each draw keeps a task's results across seeds together).
 */
async function pairedComparison(options: Options): Promise<string[]> {
  if (!options.methods.includes('architect')) return [];
  const outcomes = new Map<string, Map<string, boolean>>();
  for (const method of options.methods) {
    for (const seed of options.seeds) {
      const result = await testOutcomes(options, method, seed);
      if (result) outcomes.set(`${method}-s${seed}`, result);
    }
  }
  const rows: string[] = [
    '| Architect vs | Seeds | Only Architect passed | Only the other passed | Difference | 95% interval |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const random = seededRandom(20261104);
  for (const other of options.methods.filter((method) => method !== 'architect')) {
    const seeds = options.seeds.filter(
      (seed) => outcomes.has(`architect-s${seed}`) && outcomes.has(`${other}-s${seed}`),
    );
    if (seeds.length === 0) continue;
    // Per task, Architect's passes minus the other's, summed over the seeds both finished.
    const differences = new Map<string, number>();
    let onlyArchitect = 0;
    let onlyOther = 0;
    for (const seed of seeds) {
      const mine = outcomes.get(`architect-s${seed}`) ?? new Map<string, boolean>();
      const theirs = outcomes.get(`${other}-s${seed}`) ?? new Map<string, boolean>();
      for (const [task, pass] of mine) {
        const otherPass = theirs.get(task) ?? false;
        if (pass && !otherPass) onlyArchitect += 1;
        if (!pass && otherPass) onlyOther += 1;
        differences.set(task, (differences.get(task) ?? 0) + Number(pass) - Number(otherPass));
      }
    }
    const values = [...differences.values()];
    const attempts = values.length * seeds.length;
    const mean = (sample: readonly number[]) =>
      sample.reduce((sum, value) => sum + value, 0) / (sample.length * seeds.length);
    const draws = Array.from({ length: BOOTSTRAP_DRAWS }, () =>
      mean(values.map(() => values[Math.floor(random() * values.length)] ?? 0)),
    ).sort((a, b) => a - b);
    const points = (fraction: number) => `${(100 * fraction).toFixed(1)}`;
    const low = draws[Math.floor(0.025 * BOOTSTRAP_DRAWS)] ?? 0;
    const high = draws[Math.floor(0.975 * BOOTSTRAP_DRAWS)] ?? 0;
    rows.push(
      `| ${METHOD_LABELS[other]} | ${seeds.join(', ')} | ${onlyArchitect} | ${onlyOther} | ` +
        `${points((onlyArchitect - onlyOther) / attempts)} points | ${points(low)} to ${points(high)} |`,
    );
  }
  return ['## Paired on the locked test', rows.join('\n')];
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
  'Usage: tsx scripts/experiment.ts <jobDir> --out <dir> [--seeds 1,2,3] [--methods ...] [--student <preset>] [--mentor <preset>] [--parallel N] [--concurrency N] [--threads N] [--cooldown <share>] [--pilot] [--pilot-only] [--retest-local <seeds>]';

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
  const threads = flags.has('--threads') ? Number(flags.get('--threads')) : undefined;
  if (threads !== undefined && (!Number.isInteger(threads) || threads < 1)) throw new Error(USAGE);
  const cooldown = flags.has('--cooldown') ? Number(flags.get('--cooldown')) : undefined;
  if (cooldown !== undefined && (!Number.isFinite(cooldown) || cooldown <= 0))
    throw new Error(USAGE);
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
    ...(threads === undefined ? {} : { threads }),
    ...(cooldown === undefined ? {} : { cooldown }),
  };
}

/** The engine's real dependencies for a data folder, with the student thread cap if one was set. */
function engineDeps(options: Options, dataDir: string) {
  return createEngineDeps({
    dataDir,
    getSecret,
    ...(options.threads === undefined ? {} : { localThreads: () => options.threads }),
    ...(options.cooldown === undefined ? {} : { localCooldown: () => options.cooldown }),
  });
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
