import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARM_LABELS,
  JobSchema,
  type ArmId,
  type BackendId,
  type ComparisonReport,
  type Harness,
  type Job,
  type RuntimeIdentity,
  type StudentAdapter,
} from '@architect/shared';
import type { Clock, LoopDeps, MeterReading, RuntimeMeter } from '../loop/deps';
import { errorMessage } from '../loop/errors';
import { isTerminal } from '../loop/plan';
import { isHeld } from '../loop/protocol';
import { deriveSeed, sampleTrainBatch } from '../loop/seeds';
import type { StoredRun } from '../store/records';
import { armStart, comparisonJob, stageFolder, type ComparisonModels } from './arms';
import { openComparisonEngine, type ComparisonEngine } from './engine';
import { renderMarkdown } from './markdown';
import {
  ARM_ORDER,
  modelInputs,
  needsConfirmation,
  project,
  studentCapOf,
  type ComparisonConfig,
} from './projection';
import { ComparisonFiles, type ArmDecision, type PlanRecord } from './records';
import { armRun, buildReport } from './report';
import { sweep } from './sweep';

/** What the runner runs on: the engine's dependencies, real or fakes, and a few of its own. */
export interface ComparisonEnvironment {
  deps: LoopDeps;
  clock: Clock;
  /** Writes a harness as a folder the harness package's `importHarness` reads. */
  writeHarness(dir: string, harness: Harness): Promise<void>;
  /** What a backend is, read without loading a model or calling one; null when it can't be. */
  identify(backend: BackendId, job: Job): Promise<RuntimeIdentity | null>;
  log(line: string): void;
  commit: string | null;
  dryRun: boolean;
  /** Runs, re-tests, repeats and references at once. */
  parallel: number;
  /** How long a run an error paused rests before it is resumed. Default a minute. */
  resumeAfterMs?: number;
}

export interface ComparisonRequest {
  /** The job folder: job.json, tasks.jsonl, data/ and its checker. */
  jobDir: string;
  /** Another job, for the regression check on 30 of its dev tasks; none when absent. */
  regressionJobDir?: string;
  out: string;
  config: ComparisonConfig;
  models: ComparisonModels;
  /** Go ahead with a plan the caps cut down. */
  confirm: boolean;
  /** Stop once calibration has priced an attempt and the plan is projected. */
  planOnly: boolean;
}

export type ComparisonOutcome = 'planned' | 'needs_confirmation' | 'finished' | 'incomplete';

/** Times in a row a run an error paused is resumed before it is left paused. */
const MAX_RESUMES = 5;
/** Dev tasks of each type the regression check takes from the other job. */
const REGRESSION_PER_TYPE = 10;

const DEVELOPMENT_WAVES: readonly (readonly ArmId[])[] = [
  ['bare', 'draft'],
  ['targeted', 'fixed'],
  ['weights-one-shot', 'weights-targeted'],
];

function waitOn(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.timeout(ms).addEventListener('abort', () => resolve(), { once: true });
  });
}

/** Imports a job copy once: found again by its id after a restart, never imported twice. */
async function ensureJob(engine: ComparisonEngine, file: string, id: string): Promise<Job> {
  if (engine.store.jobs.get(id) !== null) return engine.jobs.get(id);
  const job = await engine.jobs.importFile(file);
  if (job.id !== id) {
    throw new Error(
      `The job copy was imported as ${job.id}, not ${id}; its data folder holds another.`,
    );
  }
  return job;
}

/** Writes a job copy that starts from its job's own harness to its own staging folder. */
function stageCopy(files: ComparisonFiles, name: string, sourceDir: string, job: Job) {
  return stageFolder(sourceDir, files.staging(name), job, async () => undefined);
}

/**
 * Runs decision 037's comparison: prices an attempt on the calibration tasks before any arm
 * spends, projects every arm and funds them in 037's order, and stops for the owner when the caps
 * cut the plan down. Then it develops the funded arms in waves (bare and draft; the arms that
 * start from the draft; the weights arms, which adopt the targeted arm's harness), each held to
 * its caps and frozen with its locked test held; releases every locked test only once every arm
 * is frozen; then Spark as a reference, local re-tests and the repeats; and writes the report.
 * Everything paid is stored as it happens, so running it again after a crash picks up where it
 * stopped and pays for nothing twice.
 */
export async function runComparison(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
): Promise<{ outcome: ComparisonOutcome; report: ComparisonReport }> {
  const { config } = request;
  const files = new ComparisonFiles(request.out);
  const engine = openComparisonEngine(files.dataDir, env.deps, env.clock, {
    parallel: env.parallel,
    concurrency: config.concurrency,
    onError: (error) => env.log(`engine: ${errorMessage(error)}`),
  });
  const now = () => new Date(env.clock.now()).toISOString();
  try {
    const source = JobSchema.parse(
      JSON.parse(await readFile(join(request.jobDir, 'job.json'), 'utf8')),
    );
    const baseJob = comparisonJob(source, config, request.models);
    const base = await ensureJob(
      engine,
      await stageCopy(files, 'base', request.jobDir, baseJob),
      baseJob.id,
    );

    // Cost first: the calibration tasks price an attempt before any arm spends.
    env.log('Calibration: the bare student on the calibration tasks, on the hosted copy.');
    const calibration = (
      await sweep({
        name: 'calibration',
        job: base,
        jobDir: engine.paths.jobDir(base.id),
        tasks: await engine.jobs.tasks(base.id, 'calibration'),
        target: 'hosted',
        seed: deriveSeed(config.mentoringSeed, 'calibration'),
        concurrency: config.concurrency,
        deps: env.deps,
        clock: env.clock,
        files,
        log: env.log,
      })
    ).attempts;

    let plan = files.readPlan();
    if (plan === null || plan.confirmedAt === null) {
      const projection = project(
        base,
        config,
        modelInputs(base, config, calibration, {
          attempts: files.readSweep('probe'),
          reading: files.readProbe(),
        }),
      );
      const fits = !needsConfirmation(projection);
      const identities: PlanRecord['identities'] = {};
      for (const backend of ['hosted', 'reference', 'local-ollama', 'local-llama.cpp'] as const) {
        const found = await env.identify(backend, base);
        if (found !== null) identities[backend] = found;
      }
      plan = {
        format: 1,
        confirmedAt: !request.planOnly && (fits || request.confirm) ? now() : null,
        arms: [...config.arms],
        funded: projection.arms.filter((arm) => arm.funded).map((arm) => arm.arm),
        caps: config.caps,
        projection,
        studentCaps: Object.fromEntries(
          projection.arms
            .filter((arm) => arm.funded && arm.studentUsd > 0)
            .map((arm) => [arm.arm, studentCapOf(arm.arm, arm.studentUsd, config)]),
        ),
        jobs: plan?.jobs ?? {},
        decisions: projection.arms
          .filter((arm) => !arm.funded)
          .map((arm) => ({
            arm: arm.arm,
            kind: 'dropped' as const,
            reason: arm.reason ?? 'Not funded.',
            at: now(),
          })),
        identities,
      };
      files.writePlan(plan);
      if (plan.confirmedAt === null) {
        const outcome: ComparisonOutcome = request.planOnly ? 'planned' : 'needs_confirmation';
        return { outcome, report: await report(request, env, engine, files, base, plan) };
      }
    }
    const confirmed = plan;
    const decide = (decision: Omit<ArmDecision, 'at'>) => {
      const current = files.readPlan() ?? confirmed;
      if (
        current.decisions.some((item) => item.arm === decision.arm && item.kind === decision.kind)
      ) {
        return;
      }
      current.decisions.push({ ...decision, at: now() });
      files.writePlan(current);
      env.log(`${ARM_LABELS[decision.arm]}: ${decision.reason}`);
    };

    if (request.regressionJobDir !== undefined && confirmed.funded.includes('bare')) {
      await regressionCheck(request, env, engine, files, request.regressionJobDir);
    }

    const studentPerAttempt =
      confirmed.projection.inputs.find((input) => input.name === 'Hosted attempt')?.value ?? 0;
    // A hosted locked test is paid for; one on this computer costs nothing to reserve.
    const testReserve = (record: StoredRun) =>
      record.lockedTestOn === 'hosted' ? base.splits.test * studentPerAttempt * config.headroom : 0;
    // The attempts in flight when a stop comes still finish, so the stop comes that much early.
    const inFlight = config.concurrency * studentPerAttempt * config.headroom;
    const stopOverCap = watchStudentCaps(engine, confirmed, testReserve, inFlight, decide);
    try {
      const development: readonly ArmId[] = confirmed.funded.filter(
        (arm) => arm !== 'reference' && arm !== 'repeat',
      );
      for (const wave of DEVELOPMENT_WAVES) {
        const arms = wave.filter((arm) => development.includes(arm));
        for (const arm of arms) {
          await startArm(arm, request, env, engine, files, base, decide);
        }
        await settle(engine, env, arms);
      }

      // Every arm is frozen, or ended without a graduate, before any locked result exists.
      const waiting = development.filter((arm) => {
        const run = armRun(engine.store, arm);
        return run !== null && run.freeze === null && !isTerminal(run.run.status);
      });
      if (waiting.length > 0) {
        env.log(
          `Not every arm froze (${waiting.map((arm) => ARM_LABELS[arm]).join(', ')}), so every locked test stays held. Run again once they finish.`,
        );
        return {
          outcome: 'incomplete',
          report: await report(request, env, engine, files, base, confirmed),
        };
      }
      const frozen = ARM_ORDER.filter((arm) => {
        const run = armRun(engine.store, arm);
        return run !== null && run.freeze !== null;
      });
      env.log(`Every arm is frozen; releasing ${frozen.length} locked tests.`);
      for (const arm of frozen) {
        const run = armRun(engine.store, arm);
        if (run !== null) engine.controller.release(run.run.id);
      }
      await settle(engine, env, frozen);

      await measureAfterRelease(request, env, engine, confirmed, decide);
    } finally {
      stopOverCap();
    }
    const done = await report(request, env, engine, files, base, confirmed);
    const finished = done.arms.every(
      (arm) => arm.status === 'complete' || arm.status === 'stopped' || arm.status === 'not_run',
    );
    return { outcome: finished ? 'finished' : 'incomplete', report: done };
  } finally {
    await engine.close();
  }
}

/** Student dollars a run spent outside its locked test. */
function developmentSpend(engine: ComparisonEngine, runId: string): number {
  const attempts = new Map(
    engine.store.attempts.list({ runId }).map((attempt) => [attempt.id, attempt]),
  );
  return engine.store.costs
    .list(runId)
    .filter((cost) => cost.role === 'student')
    .filter((cost) => {
      const attempt = cost.attemptId === null ? undefined : attempts.get(cost.attemptId);
      return attempt !== undefined && attempt.split !== 'test';
    })
    .reduce((sum, cost) => sum + (cost.usd ?? 0), 0);
}

/**
 * Holds each arm to its student cap: once its development has spent all but its locked test's
 * share and what the attempts in flight may still cost, the run is stopped, which ends training
 * at the step in flight and still freezes what it kept. Returns the way to stop watching.
 */
function watchStudentCaps(
  engine: ComparisonEngine,
  plan: PlanRecord,
  testReserve: (record: StoredRun) => number,
  inFlight: number,
  decide: (decision: Omit<ArmDecision, 'at'>) => void,
): () => void {
  const stopped = new Set<string>();
  return engine.controller.onEvent((event) => {
    if (event.type !== 'attempt.finished') return;
    const record = engine.store.runs.get(event.runId);
    const arm = record?.protocol?.arm as ArmId | undefined;
    if (record === null || record === undefined || arm === undefined) return;
    const cap = plan.studentCaps[arm];
    if (cap === undefined || stopped.has(record.run.id)) return;
    if (record.run.phase === 'testing' || record.stopRequested || isTerminal(record.run.status)) {
      return;
    }
    const reserve = testReserve(record);
    const allowed = Math.max(0, cap - reserve);
    const spent = developmentSpend(engine, record.run.id);
    if (spent + inFlight + 1e-9 < allowed) return;
    stopped.add(record.run.id);
    decide({
      arm,
      kind: 'stopped',
      reason: `Stopped when its development had spent $${spent.toFixed(2)} of the $${allowed.toFixed(2)} its student cap allowed${reserve > 0 ? `; $${reserve.toFixed(2)} stayed reserved for its locked test` : ''}.`,
    });
    void engine.controller.stop(record.run.id);
  });
}

/** Starts an arm's run once, when what it starts from is there; records why when it isn't. */
async function startArm(
  arm: ArmId,
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  files: ComparisonFiles,
  base: Job,
  decide: (decision: Omit<ArmDecision, 'at'>) => void,
): Promise<void> {
  if (armRun(engine.store, arm) !== null) return;
  const needs: ArmId | null =
    arm === 'targeted' || arm === 'fixed'
      ? 'draft'
      : arm === 'weights-one-shot' || arm === 'weights-targeted'
        ? 'targeted'
        : null;
  if (needs !== null) {
    const source = armRun(engine.store, needs);
    const settled = source !== null && (source.freeze !== null || isTerminal(source.run.status));
    const usable = needs === 'targeted' ? source?.freeze != null : settled;
    if (!usable) {
      decide({
        arm,
        kind: 'dropped',
        reason: `It starts from the ${ARM_LABELS[needs].toLowerCase()} arm, which didn't freeze.`,
      });
      return;
    }
  }
  const start = await armStart(arm, {
    base,
    config: request.config,
    engine,
    deps: env.deps,
    files,
    runOf: (other) => armRun(engine.store, other),
    sparkSpent: (runId) =>
      engine.store.costs
        .list(runId)
        .filter((cost) => cost.role === 'mentor')
        .reduce((sum, cost) => sum + (cost.usd ?? 0), 0),
    writeHarness: env.writeHarness,
  });
  const file = await stageFolder(
    request.jobDir,
    files.staging(arm),
    start.job,
    env.writeHarness,
    start.startingHarness,
  );
  const job = await ensureJob(engine, file, start.job.id);
  const run = await engine.controller.start(job.id, start.method, request.config.mentoringSeed, {
    lockedTestOn: start.lockedTestOn,
    protocol: start.protocol,
  });
  env.log(`${ARM_LABELS[arm]}: started run ${run.id}.`);
}

/**
 * Waits until nothing runs, resuming a run an error paused after a rest, at most five times in a
 * row; a run frozen and held is settled. Arms still paused after that stay paused, reported so.
 */
async function settle(
  engine: ComparisonEngine,
  env: ComparisonEnvironment,
  arms: readonly ArmId[],
): Promise<void> {
  const resumes = new Map<string, number>();
  for (;;) {
    await engine.controller.idle();
    const paused = arms
      .map((arm) => armRun(engine.store, arm))
      .filter(
        (run): run is StoredRun =>
          run !== null &&
          run.run.status === 'paused' &&
          !isHeld(run) &&
          (resumes.get(run.run.id) ?? 0) < MAX_RESUMES,
      );
    if (paused.length === 0) return;
    for (const run of paused) {
      env.log(`Run ${run.run.id} paused (${run.run.error ?? 'no reason'}); resuming after a rest.`);
    }
    await waitOn(env.clock, env.resumeAfterMs ?? 60_000);
    for (const run of paused) {
      resumes.set(run.run.id, (resumes.get(run.run.id) ?? 0) + 1);
      await engine.controller.resume(run.run.id);
    }
  }
}

/** Asks for a side measurement, resuming one an error paused; one already finished is left. */
async function askFor(env: ComparisonEnvironment, what: string, ask: () => Promise<void>) {
  try {
    await ask();
  } catch (error) {
    const message = errorMessage(error);
    if (!/already/.test(message)) env.log(`${what}: ${message}`);
  }
}

/** After the release: Spark as a reference, the local re-tests, and the repeats, in 037's order. */
async function measureAfterRelease(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  plan: PlanRecord,
  decide: (decision: Omit<ArmDecision, 'at'>) => void,
): Promise<void> {
  const { controller } = engine;
  const finished = (arm: ArmId) => {
    const run = armRun(engine.store, arm);
    return run !== null && run.run.status === 'finished' ? run : null;
  };
  for (let attempt = 0; attempt <= MAX_RESUMES; attempt += 1) {
    const bare = finished('bare');
    if (plan.funded.includes('reference')) {
      if (bare === null) {
        decide({
          arm: 'reference',
          kind: 'dropped',
          reason: "The bare arm has no frozen graduate's test to share.",
        });
      } else if (engine.store.references.get(bare.run.id, 'test')?.status !== 'finished') {
        await askFor(env, 'Spark as a reference', () =>
          controller.reference(bare.run.id, 'test', request.config.sparkCaps.reference),
        );
      }
    }
    if (request.config.localOllama) {
      for (const arm of ['bare', 'targeted'] as const) {
        const run = finished(arm);
        if (run === null || run.lockedTestOn === 'local') continue;
        if (engine.store.retests.get(run.run.id, 'local')?.status === 'finished') continue;
        await askFor(env, `${ARM_LABELS[arm]} on this computer`, () =>
          controller.retest(run.run.id, 'local'),
        );
      }
    }
    if (plan.funded.includes('repeat')) {
      for (const arm of ['bare', 'draft', 'targeted'] as const) {
        const run = finished(arm);
        if (run === null) continue;
        if (engine.store.repeats.get(run.run.id, run.lockedTestOn)?.status === 'finished') continue;
        await askFor(env, `${ARM_LABELS[arm]}'s repeat`, () =>
          controller.repeat(run.run.id, run.lockedTestOn),
        );
      }
    }
    await controller.idle();
    const pausedSide =
      engine.store.references.withStatus('paused').length +
      engine.store.retests.withStatus('paused').length +
      engine.store.repeats.withStatus('paused').length;
    if (pausedSide === 0) return;
    env.log(`${pausedSide} measurement(s) paused after an error; asking again after a rest.`);
    await waitOn(env.clock, env.resumeAfterMs ?? 60_000);
  }
}

/** The bare student on 30 dev tasks of another job, hosted: the regression check. */
async function regressionCheck(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  files: ComparisonFiles,
  dir: string,
): Promise<void> {
  const source = JobSchema.parse(JSON.parse(await readFile(join(dir, 'job.json'), 'utf8')));
  const copy = comparisonJob(source, request.config, request.models);
  const job = await ensureJob(engine, await stageCopy(files, 'regression', dir, copy), copy.id);
  const dev = await engine.jobs.tasks(job.id, 'dev');
  const tasks = sampleTrainBatch(
    dev,
    REGRESSION_PER_TYPE * job.taskTypes.length,
    deriveSeed(request.config.mentoringSeed, 'regression'),
  );
  env.log(`Regression check: the bare student on ${tasks.length} dev tasks of ${job.name}.`);
  await sweep({
    name: 'regression',
    job,
    jobDir: engine.paths.jobDir(job.id),
    tasks,
    target: 'hosted',
    seed: deriveSeed(request.config.mentoringSeed, 'regression'),
    concurrency: request.config.concurrency,
    deps: env.deps,
    clock: env.clock,
    files,
    log: env.log,
  });
}

/** Writes the report, JSON for the app and Markdown for the README, and returns it. */
async function report(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  files: ComparisonFiles,
  base: Job,
  plan: PlanRecord | null,
): Promise<ComparisonReport> {
  let regression: { job: Job; attempts: ReturnType<ComparisonFiles['readSweep']> } | null = null;
  if (request.regressionJobDir !== undefined) {
    const attempts = files.readSweep('regression');
    const source = JobSchema.parse(
      JSON.parse(await readFile(join(request.regressionJobDir, 'job.json'), 'utf8')),
    );
    if (attempts.length > 0) regression = { job: source, attempts };
  }
  const built = await buildReport({
    engine,
    deps: env.deps,
    config: request.config,
    // The plan as stored: decisions made since it was confirmed are in the file.
    plan: files.readPlan() ?? plan,
    base,
    calibration: files.readSweep('calibration'),
    regression,
    dryRun: env.dryRun,
    commit: env.commit,
    now: new Date(env.clock.now()).toISOString(),
  });
  await writeFile(files.reportJson, `${JSON.stringify(built, null, 2)}\n`);
  await writeFile(files.reportMarkdown, renderMarkdown(built));
  return built;
}

/**
 * The local throughput probe: the bare student on a few calibration tasks on this computer, with
 * the meter on, so the GPU time a local evaluation takes is measured, not guessed. It loads the
 * model on the GPU, so it runs only when the owner grants the time.
 */
export async function probeLocal(
  request: Pick<ComparisonRequest, 'jobDir' | 'out' | 'config' | 'models'>,
  env: ComparisonEnvironment,
  options: { tasks: number; meter: RuntimeMeter | null },
): Promise<{ attempts: number; reading: MeterReading | null }> {
  const files = new ComparisonFiles(request.out);
  const engine = openComparisonEngine(files.dataDir, env.deps, env.clock, {
    parallel: 1,
    concurrency: 1,
    onError: (error) => env.log(`engine: ${errorMessage(error)}`),
  });
  try {
    const source = JobSchema.parse(
      JSON.parse(await readFile(join(request.jobDir, 'job.json'), 'utf8')),
    );
    const baseJob = comparisonJob(source, request.config, request.models);
    const base = await ensureJob(
      engine,
      await stageCopy(files, 'base', request.jobDir, baseJob),
      baseJob.id,
    );
    const tasks = (await engine.jobs.tasks(base.id, 'calibration')).slice(0, options.tasks);
    const meter = options.meter;
    const onStudent =
      meter === null
        ? undefined
        : async (student: StudentAdapter) => {
            const session = await meter.start({
              backend: base.student.local.runtime,
              target: 'local',
              student,
              signal: new AbortController().signal,
            });
            return session === null ? null : () => session.stop();
          };
    const { attempts, reading } = await sweep({
      name: 'probe',
      job: base,
      jobDir: engine.paths.jobDir(base.id),
      tasks,
      target: 'local',
      seed: deriveSeed(request.config.mentoringSeed, 'probe'),
      concurrency: 1,
      deps: env.deps,
      clock: env.clock,
      files,
      ...(onStudent === undefined ? {} : { onStudent }),
      log: env.log,
    });
    if (reading !== null) {
      files.writeProbe({
        backend: base.student.local.runtime,
        coldStartMs: reading.coldStartMs,
        peakProcessBytes: reading.peakProcessBytes,
        peakGpuBytes: reading.peakGpuBytes,
        sampler: reading.sampler,
        at: new Date(env.clock.now()).toISOString(),
      });
    }
    return { attempts: attempts.length, reading };
  } finally {
    await engine.close();
  }
}

/** Rebuilds the report from what the output folder holds, without running anything. */
export async function reportOnly(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
): Promise<ComparisonReport> {
  const files = new ComparisonFiles(request.out);
  // Nothing resumes: the report reads the records as they stand.
  const engine = openComparisonEngine(files.dataDir, env.deps, env.clock, {
    parallel: 1,
    concurrency: 1,
    onError: (error) => env.log(`engine: ${errorMessage(error)}`),
    resume: false,
  });
  try {
    const source = JobSchema.parse(
      JSON.parse(await readFile(join(request.jobDir, 'job.json'), 'utf8')),
    );
    const base = await engine.jobs.get(comparisonJob(source, request.config, request.models).id);
    return await report(request, env, engine, files, base, files.readPlan());
  } finally {
    await engine.close();
  }
}
