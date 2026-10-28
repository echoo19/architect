import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARM_LABELS,
  ARM_PRIORITY,
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
import { connectStudent } from '../loop/setup';
import type { StoredRun } from '../store/records';
import { armStart, comparisonJob, stageFolder, type ComparisonModels } from './arms';
import { Credit } from './credit';
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
import {
  ComparisonFiles,
  type ArmDecision,
  type PlanRecord,
  type PlanSettings,
  type SweepAttempt,
} from './records';
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

/**
 * Arms whose spending their rounds decide: these are held to their student cap at each round's
 * start. The others have a size fixed in advance, so stopping one could only lose it.
 */
const VARIABLE_ARMS: ReadonlySet<ArmId> = new Set(['targeted', 'fixed', 'weights-targeted']);

/** The arms the repeat takes again under the deferred seed. */
const REPEATED: readonly ArmId[] = ['bare', 'draft', 'targeted'];

type Decide = (decision: Omit<ArmDecision, 'at'>) => void;

function waitOn(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.timeout(ms).addEventListener('abort', () => resolve(), { once: true });
  });
}

/** Whether a process with this id is running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Holds an output folder for one process at a time: two runners driving the same runs would pay
 * for every attempt twice. A lock left by a process that is gone is taken over.
 */
function lockFolder(out: string): () => void {
  mkdirSync(out, { recursive: true });
  const file = join(out, '.comparison.lock');
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(readFileSync(file, 'utf8'));
      if (Number.isInteger(holder) && holder !== process.pid && alive(holder)) {
        throw new Error(
          `Another comparison process (${holder}) is using ${out}; two would pay for the same work twice.`,
          { cause: error },
        );
      }
      rmSync(file, { force: true });
    }
  }
  throw new Error(`The lock on ${out} couldn't be taken.`);
}

/** A job copy's ids in the order they are tried: a crash after sealing one strands that id. */
const idsOf = (id: string) => [id, ...[2, 3, 4, 5].map((n) => `${id}-${n}`)];

/** A job copy imported earlier, found by the first of its ids the store holds. */
async function findJob(engine: ComparisonEngine, id: string): Promise<Job | null> {
  for (const candidate of idsOf(id)) {
    if (engine.store.jobs.get(candidate) !== null) return engine.jobs.get(candidate);
  }
  return null;
}

/**
 * Imports a job copy once: found again by its id after a restart, never imported twice. The
 * staging folder, which holds the job's tasks, the locked test's included, goes as soon as the
 * vault has them; an id a crash left sealed without its job is passed over for the next.
 */
async function ensureJob(
  engine: ComparisonEngine,
  deps: LoopDeps,
  dir: string,
  sourceDir: string,
  job: Job,
  writeHarness: ComparisonEnvironment['writeHarness'],
  startingHarness?: Harness,
): Promise<Job> {
  const found = await findJob(engine, job.id);
  if (found !== null) return found;
  for (const id of idsOf(job.id)) {
    if (await deps.vault.isSealed(id)) continue;
    try {
      const file = await stageFolder(sourceDir, dir, { ...job, id }, writeHarness, startingHarness);
      const imported = await engine.jobs.importFile(file);
      if (imported.id !== id) {
        throw new Error(`The job copy was imported as ${imported.id}, not ${id}.`);
      }
      return imported;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  throw new Error(`Every id for ${job.id} is taken in this data folder.`);
}

const noHarness = async () => undefined;

/** The settings a plan is confirmed with: what a resume may not change. */
function settingsOf(config: ComparisonConfig, models: ComparisonModels): PlanSettings {
  return {
    mentoringSeed: config.mentoringSeed,
    testSeeds: [...config.testSeeds],
    rounds: config.rounds,
    weightsRounds: config.weightsRounds,
    oneShotPerType: config.oneShotPerType,
    jobMinutes: config.jobMinutes,
    fixedIntervention: config.fixedIntervention,
    headroom: config.headroom,
    concurrency: config.concurrency,
    localOllama: config.localOllama,
    realCompute: config.realCompute,
    llamaServer: config.llamaServer,
    sparkCaps: { ...config.sparkCaps },
    studentCaps: { ...(config.studentCaps ?? {}) },
    mentor: models.mentor,
    student: models.student,
    providers: models.providers === undefined ? null : [...models.providers],
    localModel: models.localModel,
  };
}

/**
 * Why a resume can't go on with this request, or null: arms and every setting are the plan's,
 * except that the local re-tests may be added later, when granted GPU minutes cover them, since
 * they test graduates already frozen.
 */
function resumeProblem(plan: PlanRecord, request: ComparisonRequest, localMinutes: number) {
  const { config } = request;
  if ([...config.arms].sort().join() !== [...plan.arms].sort().join()) {
    return `This folder's plan was confirmed for ${plan.arms.join(', ')}; arms can't join or leave it once confirmed, or some would learn after others' results were read. Use a new output folder for other arms.`;
  }
  const asked = settingsOf(config, request.models);
  const changed = (Object.keys(asked) as (keyof PlanSettings)[]).filter(
    (key) =>
      JSON.stringify(asked[key]) !== JSON.stringify(plan.settings[key]) &&
      !(key === 'localOllama' && asked.localOllama && !plan.settings.localOllama),
  );
  const caps = (['studentUsd', 'sparkUsd', 'computeUsd'] as const).filter(
    (key) => config.caps[key] !== plan.caps[key],
  );
  if (changed.length > 0 || caps.length > 0) {
    return `This folder's plan was confirmed with other settings (${[...changed, ...caps].join(', ')}); run it with the ones it was confirmed with, or use a new output folder.`;
  }
  if (asked.localOllama && !plan.settings.localOllama && config.caps.localMinutes < localMinutes) {
    return `The local re-tests need about ${Math.ceil(localMinutes)} minutes of GPU time, and ${config.caps.localMinutes} are granted.`;
  }
  return null;
}

/**
 * Checks before anything spends that freezing will work: it pins this computer's build by asking
 * the local runtime to describe it, which loads nothing but needs Ollama running and the build
 * there. A run that couldn't freeze would have paid for its development and taken no test.
 */
async function preflight(deps: LoopDeps, job: Job): Promise<void> {
  try {
    const local = await connectStudent(deps, job, 'local');
    await local.describe();
  } catch (error) {
    throw new Error(
      `Every arm pins this computer's ${job.student.local.model} when it freezes, so ${job.student.local.runtime} must be running with it installed; nothing is loaded. ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/**
 * Runs decision 037's comparison: prices an attempt on the calibration tasks before any arm
 * spends, projects every arm and funds them in 037's order, and stops for the owner when the caps
 * cut the plan down. Then it develops the funded arms in waves (bare and draft; the arms that
 * start from the draft; the weights arms, which adopt the targeted arm's harness), checking the
 * student's credit before each, holding each variable arm to its cap between rounds, and holding
 * every locked test; releases them only once every arm is frozen, in 037's order while the credit
 * lasts; then Spark as a reference, local re-tests and the repeats; and writes the report.
 * Everything paid is stored as it happens, so running it again after a crash picks up where it
 * stopped and pays for nothing twice.
 */
export async function runComparison(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
): Promise<{ outcome: ComparisonOutcome; report: ComparisonReport }> {
  const { config } = request;
  const unlock = lockFolder(request.out);
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
    const base = await ensureJob(
      engine,
      env.deps,
      files.staging('base'),
      request.jobDir,
      comparisonJob(source, config, request.models),
      noHarness,
    );
    await preflight(env.deps, base);

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
    const inputs = modelInputs(base, config, calibration, {
      attempts: files.readSweep('probe'),
      reading: files.readProbe(),
    });

    let plan = files.readPlan();
    if (plan === null || plan.confirmedAt === null) {
      // Calibration is paid, and the regression check will be: both come off the credit first.
      const committed =
        sum(calibration.map((attempt) => attempt.usd ?? 0)) +
        (request.regressionJobDir === undefined ? 0 : 30 * inputs.studentUsd.value);
      const projection = project(base, config, inputs, committed);
      const fits = !needsConfirmation(projection);
      plan = {
        format: 1,
        confirmedAt: !request.planOnly && (fits || request.confirm) ? now() : null,
        arms: [...config.arms],
        funded: projection.arms.filter((arm) => arm.funded).map((arm) => arm.arm),
        caps: config.caps,
        settings: settingsOf(config, request.models),
        projection,
        studentCaps: Object.fromEntries(
          projection.arms
            .filter((arm) => arm.funded && arm.studentUsd > 0)
            .map((arm) => [arm.arm, studentCapOf(arm.arm, arm.studentUsd, config)]),
        ),
        decisions: projection.arms
          .filter((arm) => !arm.funded)
          .map((arm) => ({
            arm: arm.arm,
            kind: 'dropped' as const,
            reason: arm.reason ?? 'Not funded.',
            at: now(),
          })),
        identities: await identities(env, base, projection, config),
      };
      files.writePlan(plan);
      if (plan.confirmedAt === null) {
        const outcome: ComparisonOutcome = request.planOnly ? 'planned' : 'needs_confirmation';
        return { outcome, report: await report(request, env, engine, files, base, plan) };
      }
    }
    if (request.planOnly) {
      return { outcome: 'planned', report: await report(request, env, engine, files, base, plan) };
    }
    const localMinutes = (2 * base.splits.test * inputs.localSeconds.value) / 60;
    const problem = resumeProblem(plan, request, localMinutes);
    if (problem !== null) throw new Error(problem);
    if (config.localOllama && !plan.settings.localOllama) {
      // Local re-tests of frozen graduates, granted after the plan: recorded in it.
      plan = {
        ...plan,
        settings: { ...plan.settings, localOllama: true },
        caps: { ...plan.caps, localMinutes: config.caps.localMinutes },
        identities: {
          ...plan.identities,
          ...(await identities(env, base, plan.projection, config)),
        },
      };
      files.writePlan(plan);
    }
    const confirmed = plan;
    const decide: Decide = (decision) => {
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

    const credit = new Credit(engine, files, inputs.studentUsd.value);
    const stopWatching = watchRounds(engine, confirmed, credit, base, env, decide);
    try {
      const development: readonly ArmId[] = confirmed.funded.filter(
        (arm) => arm !== 'reference' && arm !== 'repeat',
      );
      for (const wave of DEVELOPMENT_WAVES) {
        const arms = wave.filter((arm) => development.includes(arm));
        for (const arm of arms) {
          if (armRun(engine.store, arm) !== null) continue;
          const short = fundingProblem(arm, confirmed, credit, engine, base, config);
          if (short !== null) {
            decide({ arm, kind: 'dropped', reason: short });
            continue;
          }
          await startArm(arm, request, env, engine, files, base, confirmed, decide);
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
      const released = release(engine, credit, base, config, decide);
      env.log(`Every arm is frozen; released ${released.length} locked tests.`);
      await settle(engine, env, released);

      await measureAfterRelease(request, env, engine, confirmed, credit, base, decide);
    } finally {
      stopWatching();
    }
    const done = await report(request, env, engine, files, base, confirmed);
    const finished = done.arms.every(
      (arm) => arm.status === 'complete' || arm.status === 'stopped' || arm.status === 'not_run',
    );
    return { outcome: finished ? 'finished' : 'incomplete', report: done };
  } finally {
    await engine.close();
    unlock();
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** What each backend the plan uses is, read without loading a model. */
async function identities(
  env: ComparisonEnvironment,
  base: Job,
  projection: PlanRecord['projection'],
  config: ComparisonConfig,
): Promise<PlanRecord['identities']> {
  const funded = (arm: ArmId) => projection.arms.some((item) => item.funded && item.arm === arm);
  const weights = funded('weights-one-shot') || funded('weights-targeted');
  const backends: BackendId[] = [
    'hosted',
    ...(funded('reference') ? (['reference'] as const) : []),
    ...(config.localOllama || weights ? (['local-ollama'] as const) : []),
    ...(weights ? (['local-llama.cpp'] as const) : []),
  ];
  const found: PlanRecord['identities'] = {};
  for (const backend of backends) {
    const identity = await env.identify(backend, base);
    if (identity !== null) found[backend] = identity;
  }
  return found;
}

/** The hosted attempts an arm's projection counts. */
function projectedHosted(plan: PlanRecord, arm: ArmId): number {
  return plan.projection.arms.find((item) => item.arm === arm)?.hostedAttempts ?? 0;
}

/**
 * Why the student's credit can't start an arm now, or null: what it may spend at the price an
 * attempt has actually cost so far, with its headroom, must fit what is left after everything
 * paid, what the arms already started may still spend (their locked tests among it), and the
 * repeat when it comes before the arm in 037's order. The fixed arm needs $5 of it, as 037 says.
 */
function fundingProblem(
  arm: ArmId,
  plan: PlanRecord,
  credit: Credit,
  engine: ComparisonEngine,
  base: Job,
  config: ComparisonConfig,
): string | null {
  const price = credit.price();
  const need = projectedHosted(plan, arm) * price * config.headroom;
  const floor = arm === 'fixed' ? Math.max(5, need) : need;
  let held = 0;
  for (const other of ARM_ORDER) {
    const run = armRun(engine.store, other);
    if (run === null || run.run.status === 'finished') continue;
    const spent = credit.development(run.run.id);
    held += Math.max(0, projectedHosted(plan, other) * price * config.headroom - spent);
  }
  if (plan.funded.includes('repeat') && ARM_PRIORITY[arm] > ARM_PRIORITY.repeat) {
    const repeated = REPEATED.filter((other) => plan.funded.includes(other)).length;
    held += repeated * base.splits.test * price * config.headroom;
  }
  const left = plan.caps.studentUsd - credit.paid() - held;
  if (floor <= left + 1e-9) return null;
  return `At what an attempt has cost so far ($${price.toFixed(4)}), it needs $${floor.toFixed(2)} of the hosted student's budget, and $${Math.max(0, left).toFixed(2)} is left after what was paid and what the comparisons before it still hold.`;
}

/**
 * Holds each variable arm to its student cap at the start of each round, when stopping it loses
 * nothing in flight: once the arm has kept a change, a round at its most and its locked test,
 * priced at what this arm's attempts have cost, must still fit its cap, or the arm stops there
 * and freezes what it kept. An arm that has kept nothing yet goes on, since stopping it would
 * lose the arm; the credit checks drop later arms instead. Returns the way to stop watching.
 */
function watchRounds(
  engine: ComparisonEngine,
  plan: PlanRecord,
  credit: Credit,
  base: Job,
  env: ComparisonEnvironment,
  decide: Decide,
): () => void {
  const stopped = new Set<string>();
  const dev = base.splits.dev * base.evaluation.devRepeats;
  return engine.controller.onEvent((event) => {
    if (event.type !== 'round.updated') return;
    const { round } = event;
    if (round.status !== 'attempting' || round.train.total !== 0) return;
    const record = engine.store.runs.get(event.runId);
    const arm = record?.protocol?.arm as ArmId | undefined;
    if (record === null || record === undefined || arm === undefined) return;
    const cap = plan.studentCaps[arm];
    if (!VARIABLE_ARMS.has(arm) || cap === undefined || stopped.has(record.run.id)) return;
    const kept = engine.store.rounds
      .list(record.run.id)
      .some((stored) => stored.round.decision === 'kept');
    if (!kept) return;
    const price = credit.priceOf(record.run.id);
    // A weights round measures on this computer; only its train attempts may be hosted.
    const hostedRound =
      arm === 'weights-targeted'
        ? record.run.currentAdapter === undefined
          ? base.evaluation.trainBatch
          : 0
        : base.evaluation.trainBatch + 4 * dev;
    const test = record.lockedTestOn === 'hosted' ? base.splits.test : 0;
    const spent = credit.development(record.run.id);
    const ahead = (hostedRound + test) * price;
    if (spent + ahead <= cap + 1e-9) return;
    stopped.add(record.run.id);
    decide({
      arm,
      kind: 'stopped',
      reason: `Before round ${round.index} it had spent $${spent.toFixed(2)}, and one more round with its final test could cost $${ahead.toFixed(2)} more (at $${price.toFixed(4)} an attempt), past its $${cap.toFixed(2)} cap, so it stopped there with what it had kept.`,
    });
    engine.controller.stop(record.run.id).catch((error: unknown) => {
      env.log(`${ARM_LABELS[arm]}: the stop failed: ${errorMessage(error)}`);
    });
  });
}

/**
 * Releases the frozen arms' locked tests in 037's order while the student's credit pays for the
 * hosted ones, each priced at what its own attempts cost; a test on this computer costs nothing.
 * Returns the arms released. One the credit can't pay for stays held, said so.
 */
function release(
  engine: ComparisonEngine,
  credit: Credit,
  base: Job,
  config: ComparisonConfig,
  decide: Decide,
): ArmId[] {
  const released: ArmId[] = [];
  let left = config.caps.studentUsd - credit.paid();
  for (const arm of ARM_ORDER) {
    const run = armRun(engine.store, arm);
    if (run === null || run.freeze === null || isTerminal(run.run.status)) continue;
    const cost =
      run.lockedTestOn === 'hosted'
        ? base.splits.test * credit.priceOf(run.run.id) * config.headroom
        : 0;
    if (cost > left + 1e-9) {
      decide({
        arm,
        kind: 'stopped',
        reason: `Its final test didn't run: at $${cost.toFixed(2)} it doesn't fit the $${Math.max(0, left).toFixed(2)} of the hosted student's budget left after the comparisons before it.`,
      });
      continue;
    }
    left -= cost;
    engine.controller.release(run.run.id);
    released.push(arm);
  }
  return released;
}

/** Starts an arm's run once, when what it starts from is there; records why when it isn't. */
async function startArm(
  arm: ArmId,
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  files: ComparisonFiles,
  base: Job,
  plan: PlanRecord,
  decide: Decide,
): Promise<void> {
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
        .reduce((total, cost) => total + (cost.usd ?? 0), 0),
    wallMinutes: plan.projection.arms.find((item) => item.arm === arm)?.wallMinutes ?? 0,
    writeHarness: env.writeHarness,
  });
  const job = await ensureJob(
    engine,
    env.deps,
    files.staging(arm),
    request.jobDir,
    start.job,
    env.writeHarness,
    start.startingHarness,
  );
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

/**
 * After the release: Spark as a reference (its own cap), the local re-tests (free), and the
 * repeats in 037's order while the student's credit pays for each, priced at what that arm's
 * attempts cost.
 */
async function measureAfterRelease(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  plan: PlanRecord,
  credit: Credit,
  base: Job,
  decide: Decide,
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
      let left = request.config.caps.studentUsd - credit.paid();
      const skipped: string[] = [];
      for (const arm of REPEATED) {
        const run = finished(arm);
        if (run === null) continue;
        const repeat = engine.store.repeats.get(run.run.id, run.lockedTestOn);
        if (repeat?.status === 'finished') continue;
        if (repeat === null) {
          const cost =
            run.lockedTestOn === 'hosted'
              ? base.splits.test * credit.testPriceOf(run.run.id) * request.config.headroom
              : 0;
          if (cost > left + 1e-9) {
            skipped.push(ARM_LABELS[arm].toLowerCase());
            continue;
          }
          left -= cost;
        }
        await askFor(env, `${ARM_LABELS[arm]}'s repeat`, () =>
          controller.repeat(run.run.id, run.lockedTestOn),
        );
      }
      if (skipped.length > 0) {
        decide({
          arm: 'repeat',
          kind: 'stopped',
          reason: `The hosted student's budget left didn't pay to run the ${skipped.join(' and the ')} again.`,
        });
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
  const job = await ensureJob(
    engine,
    env.deps,
    files.staging('regression'),
    dir,
    comparisonJob(source, request.config, request.models),
    noHarness,
  );
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
  let regression: { job: Job; attempts: SweepAttempt[] } | null = null;
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
 * model on the GPU, so it runs only when the owner grants the time. It resumes no run.
 */
export async function probeLocal(
  request: Pick<ComparisonRequest, 'jobDir' | 'out' | 'config' | 'models'>,
  env: ComparisonEnvironment,
  options: { tasks: number; meter: RuntimeMeter | null },
): Promise<{ attempts: number; reading: MeterReading | null }> {
  const unlock = lockFolder(request.out);
  const files = new ComparisonFiles(request.out);
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
    const base = await ensureJob(
      engine,
      env.deps,
      files.staging('base'),
      request.jobDir,
      comparisonJob(source, request.config, request.models),
      noHarness,
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
    unlock();
  }
}

/** Rebuilds the report from what the output folder holds, without running anything. */
export async function reportOnly(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
): Promise<ComparisonReport> {
  const unlock = lockFolder(request.out);
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
    const id = comparisonJob(source, request.config, request.models).id;
    const base = await findJob(engine, id);
    if (base === null) throw new Error(`${request.out} holds no comparison of ${id} yet.`);
    return await report(request, env, engine, files, base, files.readPlan());
  } finally {
    await engine.close();
    unlock();
  }
}
