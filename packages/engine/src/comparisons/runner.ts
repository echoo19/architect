import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARM_LABELS,
  ARM_PRIORITY,
  fundingMessage,
  JobSchema,
  studentPricing,
  type ArmId,
  type StudyRecord,
  type BackendId,
  type ComparisonReport,
  type FundingPause,
  type Harness,
  type Job,
  type PinnedInputs,
  type RunEvent,
  type RuntimeIdentity,
  type StudentAdapter,
} from '@architect/shared';
import { isStudied } from '../drafting/study';
import { JobStudy, STUDY_CAP_USD } from '../drafting/studying';
import type { Clock, LoopDeps, MeterReading, RuntimeMeter } from '../loop/deps';
import { errorMessage } from '../loop/errors';
import { isTerminal } from '../loop/plan';
import { isHeld } from '../loop/protocol';
import { deriveSeed, sampleTrainBatch } from '../loop/seeds';
import { connectStudent } from '../loop/setup';
import { waitOnClock } from '../loop/time';
import type { StoredRun } from '../store/records';
import { armStart, comparisonJob, stageFolder, type ComparisonModels } from './arms';
import { Credit } from './credit';
import { openComparisonEngine, type ComparisonEngine } from './engine';
import {
  fieldOf,
  finalTestAttemptsLeft,
  finalTestAttemptsOf,
  lockedTestsOf,
  type Field,
} from './field';
import { GpuWindow } from './gpu';
import { guardAllows, guardedDeps, isGuardRefusal, type Guards } from './guards';
import { inputsChanged, pinInputs } from './inputs';
import { renderMarkdown } from './markdown';
import {
  ARM_ORDER,
  billingOf,
  modelInputs,
  needsConfirmation,
  project,
  studentCapOf,
  type ComparisonConfig,
} from './projection';
import {
  ComparisonFiles,
  PLAN_FORMAT,
  type ArmDecision,
  type PlanRecord,
  type PlanSettings,
  type SweepAttempt,
} from './records';
import { armRun, buildReport } from './report';
import { StudentCredit } from './spend';
import { sweep } from './sweep';

/** What the runner runs on: the engine's dependencies, real or fakes, and a few of its own. */
export interface ComparisonEnvironment {
  deps: LoopDeps;
  clock: Clock;
  /** Writes a harness as a folder the harness package's `importHarness` reads. */
  writeHarness(dir: string, harness: Harness): Promise<void>;
  /** What a backend is, read without loading a model or calling one; null when it can't be. */
  identify(backend: BackendId, job: Job): Promise<RuntimeIdentity | null>;
  /**
   * Checks through the app's GPU lease that no process of the app has any of the GPU, and fails
   * at once with the busy error, which says who has it and what to do, when one has (decision 046).
   */
  checkGpu(): Promise<void>;
  /** Frees this computer's GPU: stops llama-server and unloads Ollama's models. */
  releaseGpu(): Promise<void>;
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
  /**
   * For a job with organizations: the token of Spark's brief the person read in the output
   * folder's `study.json`, which confirms that brief for every arm (decision 069).
   */
  studyToken?: string;
  /**
   * Raises the confirmed plan's student cap to this, before any locked test is released: the
   * person's answer to a comparison paused for money, recorded as an amendment (decision 081).
   */
  studentCapUsd?: number;
  /** Arms the person drops before the release, recorded as their decision (decision 081). */
  dropArms?: readonly ArmId[];
}

/**
 * `needs_funding`: an arm can't be paid for at what an attempt has really cost, so the comparison
 * waits for the person before any locked test is released (decision 081).
 */
export type ComparisonOutcome =
  'planned' | 'needs_confirmation' | 'needs_funding' | 'finished' | 'incomplete';

/** A comparison as a caller sees it while it runs: its report from the records, its runs' events. */
export interface ComparisonView {
  report(): Promise<ComparisonReport>;
  onEvent(listener: (event: RunEvent) => void): () => void;
}

/**
 * How a caller in the same process holds a command (decision 074). Aborting `signal` ends it the
 * way a closed process would: active runs stop where they are and resume when the comparison runs
 * again, no arm starts, no locked test is released, and the outcome is `incomplete`.
 */
export interface ComparisonControl {
  signal?: AbortSignal;
  /** Called once the comparison's engine is open and its job imported. */
  onOpen?(view: ComparisonView): void;
}

/** Times in a row a run an error paused is resumed before it is left paused. */
const MAX_RESUMES = 5;
/** Dev tasks of each type the regression check takes from the other job. */
const REGRESSION_PER_TYPE = 10;

const DEVELOPMENT_WAVES: readonly (readonly ArmId[])[] = [
  ['bare', 'draft'],
  ['targeted', 'fixed'],
  ['weights-one-shot', 'weights-targeted'],
];

/** The arms that measure other arms' graduates and have no run of their own. */
const MEASURING: ReadonlySet<ArmId> = new Set(['reference', 'reference-targeted', 'repeat']);

/**
 * Arms whose spending their rounds decide: these are held to their student cap at each round's
 * start. The others have a size fixed in advance, so stopping one could only lose it.
 */
const VARIABLE_ARMS: ReadonlySet<ArmId> = new Set(['targeted', 'fixed', 'weights-targeted']);

/** The arms the repeat takes again under the deferred seed. */
const REPEATED: readonly ArmId[] = ['bare', 'draft', 'targeted'];

/** Each Spark reference, with the arm whose frozen graduate it acts with (decision 051). */
const REFERENCES: readonly { arm: ArmId; on: ArmId }[] = [
  { arm: 'reference', on: 'bare' },
  { arm: 'reference-targeted', on: 'targeted' },
];

type Decide = (decision: Omit<ArmDecision, 'at'>) => void;

function waitOn(clock: Clock, ms: number): Promise<void> {
  return waitOnClock(clock, ms);
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
 * staged copy must hold the tasks, data and checker the plan pinned, or nothing is imported. The
 * staging folder, which holds the job's tasks, the locked test's included, goes as soon as the
 * vault has them; an id a crash left sealed without its job is passed over for the next.
 */
async function ensureJob(
  engine: ComparisonEngine,
  deps: LoopDeps,
  dir: string,
  sourceDir: string,
  job: Job,
  pinned: PinnedInputs,
  writeHarness: ComparisonEnvironment['writeHarness'],
  startingHarness?: Harness,
): Promise<Job> {
  const found = await findJob(engine, job.id);
  if (found !== null) return found;
  for (const id of idsOf(job.id)) {
    if (await deps.vault.isSealed(id)) continue;
    try {
      const file = await stageFolder(sourceDir, dir, { ...job, id }, writeHarness, startingHarness);
      const changed = inputsChanged(pinned, pinInputs(dir, { ...job, id: pinned.jobId }), false);
      if (changed !== null) {
        throw new Error(
          `The copy of ${pinned.name} for ${job.id} doesn't match the plan: ${changed}. Nothing was imported.`,
        );
      }
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

function readJob(dir: string): Job {
  return JobSchema.parse(JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')));
}

/**
 * The job's files, held to the pin the folder's first command took before importing anything:
 * the same tasks, data, checker and job file, byte for byte, or nothing goes on. The first
 * command takes the pin. Returns it.
 */
function pinJob(files: ComparisonFiles, dir: string, job: Job): PinnedInputs {
  const now = pinInputs(dir, job);
  const pinned = files.readPinnedJob();
  if (pinned === null) {
    files.writePinnedJob(now);
    return now;
  }
  const changed = inputsChanged(pinned, now, true);
  if (changed !== null) {
    throw new Error(
      `This folder's comparison runs on ${pinned.name} as it was when it began, and ${changed}. Every arm is measured on the same tasks, data and checker; use a new output folder for the job as it is now.`,
    );
  }
  return pinned;
}

/** Why this request's regression job isn't the one the plan pinned, or null. */
function regressionProblem(plan: PlanRecord, now: PinnedInputs | null): string | null {
  const pinned = plan.inputs.regression;
  if (pinned === null && now !== null) {
    return "This folder's plan has no regression check; leave --regression out, or use a new output folder.";
  }
  if (pinned !== null && now === null) {
    return `This folder's plan runs the regression check on ${pinned.name}; pass the same --regression folder.`;
  }
  if (pinned !== null && now !== null) {
    const changed = inputsChanged(pinned, now, true);
    if (changed !== null) {
      return `This folder's plan runs the regression check on ${pinned.name} as it was then, and ${changed}. Pass the same job, unchanged, or use a new output folder.`;
    }
  }
  return null;
}

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
    adapterProtocol: config.adapterProtocol,
    smokeTasks: config.smokeTasks,
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
  // The student cap may be the one confirmed or the one the person raised it to since.
  const confirmedStudentUsd = plan.amendments[0]?.fromUsd ?? plan.caps.studentUsd;
  const caps = (['studentUsd', 'sparkUsd', 'computeUsd'] as const).filter(
    (key) =>
      config.caps[key] !== plan.caps[key] &&
      !(key === 'studentUsd' && config.caps.studentUsd === confirmedStudentUsd),
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

/** Refuses a hosted student whose price isn't known: its spending couldn't be held to the cap. */
function requirePrice(job: Job): void {
  const hosted = job.student.hosted;
  if (hosted === undefined || studentPricing(hosted) !== undefined) return;
  throw new Error(
    `The hosted student ${hosted.model} has no known price, so the comparison can't hold it to the student's credit. Nothing was sent.`,
  );
}

/** The guards every request goes through: the student's credit and the GPU window. */
function openGuards(
  files: ComparisonFiles,
  env: ComparisonEnvironment,
  cap: number,
  gpuMinutes: number,
): Guards {
  return {
    credit: new StudentCredit(files.journal, cap, env.clock),
    gpu: new GpuWindow({
      minutes: gpuMinutes,
      clock: env.clock,
      release: () => env.releaseGpu(),
      log: env.log,
    }),
  };
}

/** Whether a plan does anything on this computer's GPU. */
function usesGpu(plan: PlanRecord): boolean {
  return (
    plan.settings.localOllama ||
    plan.funded.includes('weights-one-shot') ||
    plan.funded.includes('weights-targeted')
  );
}

/** Whether a request asks for work on this computer's GPU, before its plan exists. */
function asksForGpu(config: ComparisonConfig): boolean {
  return (
    config.localOllama ||
    (config.llamaServer && config.arms.some((arm) => arm.startsWith('weights-')))
  );
}

/**
 * Runs decision 037's comparison: prices an attempt on the calibration tasks before any arm
 * spends, projects every arm and funds them in 037's order, and stops for the owner when the caps
 * cut the plan down. A plan once made pins the job's files; once confirmed, its arms and settings.
 * Nothing left active by an earlier process resumes until the plan, the inputs and the request
 * have been checked and the guards are in place: every hosted request reserved against the
 * student's credit and written to the journal before it is sent, every local request held to the
 * GPU window (decision 051). Then it develops the funded arms in waves (bare and draft; the arms
 * that start from the draft; the weights arms, which adopt the targeted arm's harness), checking
 * the credit before each and holding each variable arm to its cap between rounds, with every
 * locked test held. Once every arm is frozen it records the test-release barrier, after which no
 * arm starts or develops, and releases the tests in 037's order while the credit lasts; then
 * Spark as a reference, local re-tests and the repeats; and writes the report. Run again after a
 * crash, it repeats no recorded attempt, Spark reply or training job; attempts in flight are
 * made again, and their requests count as spent at their worst.
 */
export async function runComparison(
  asked: ComparisonRequest,
  env: ComparisonEnvironment,
  control: ComparisonControl = {},
): Promise<{ outcome: ComparisonOutcome; report: ComparisonReport }> {
  const aborted = () => control.signal?.aborted === true;
  const unlock = lockFolder(asked.out);
  const files = new ComparisonFiles(asked.out);
  const now = () => new Date(env.clock.now()).toISOString();
  let opened: ComparisonEngine | null = null;
  try {
    const source = readJob(asked.jobDir);
    const field = fieldOf(asked.jobDir, source);
    // The locked test holds the organizations the job never trains on as well as its test split.
    const request = withLockedTests(asked, field);
    const { config } = request;
    const regressionDir = request.regressionJobDir;
    const inputs: PlanRecord['inputs'] = {
      job: pinJob(files, request.jobDir, source),
      regression:
        regressionDir === undefined ? null : pinInputs(regressionDir, readJob(regressionDir)),
    };
    let plan = files.readPlan();
    if (plan !== null) {
      const problem = regressionProblem(plan, inputs.regression);
      if (problem !== null) throw new Error(problem);
    }
    // Work on this computer's GPU runs only when the app has none of it (decision 046): when this
    // command may do some, it checks before anything is paid, and stops at once if not.
    const local = asksForGpu(config) || (plan !== null && usesGpu(plan));
    if (!request.planOnly && local && config.caps.localMinutes > 0) await env.checkGpu();
    // Until a plan is confirmed the request's cap holds calibration; then the plan's.
    const cap =
      plan !== null && plan.confirmedAt !== null ? plan.caps.studentUsd : config.caps.studentUsd;
    const guards = openGuards(files, env, cap, config.caps.localMinutes);
    const deps = guardedDeps(env.deps, guards);
    // Nothing resumes yet: what an earlier process left active waits for the checks below.
    const engine = openComparisonEngine(files.dataDir, deps, env.clock, {
      parallel: env.parallel,
      concurrency: config.concurrency,
      onError: (error) => env.log(`engine: ${errorMessage(error)}`),
    });
    opened = engine;
    const base = await ensureJob(
      engine,
      deps,
      files.staging('base'),
      request.jobDir,
      comparisonJob(source, config, request.models),
      inputs.job,
      noHarness,
    );
    requirePrice(base);
    await preflight(deps, base);
    // Stopping closes the controller, as a closed process would: its runs resume next time.
    const closeOnAbort = () => void engine.controller.close();
    if (aborted()) closeOnAbort();
    else control.signal?.addEventListener('abort', closeOnAbort, { once: true });
    control.onOpen?.({
      report: () => composeReport(request, env, engine, files, base, guards),
      onEvent: (listener) => engine.controller.onEvent(listener),
    });

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
        deps,
        clock: env.clock,
        files,
        log: env.log,
        ...(control.signal === undefined ? {} : { signal: control.signal }),
      })
    ).attempts;
    const billing = billingOf(calibration);
    guards.credit.billingFactor(billing?.ratio ?? 1);
    const model = modelInputs(base, config, calibration, {
      attempts: files.readSweep('probe'),
      reading: files.readProbe(),
    });
    const study = await studyOnce(request, env, engine, deps, files, base);

    if (plan === null || plan.confirmedAt === null) {
      // Calibration is paid, and the regression check will be: both come off the credit first.
      const regressionDone = files.readSweep('regression').length > 0;
      const committed =
        guards.credit.total() +
        (request.regressionJobDir === undefined || regressionDone
          ? 0
          : REGRESSION_PER_TYPE * source.taskTypes.length * model.studentUsd.value);
      const projection = project(base, config, model, committed, study.record?.cost.usd ?? 0);
      const fits = !needsConfirmation(projection);
      plan = {
        format: PLAN_FORMAT,
        // A field job's arms wait for the person to confirm Spark's brief as well.
        confirmedAt:
          !request.planOnly && study.confirmed && (fits || request.confirm) ? now() : null,
        arms: [...config.arms],
        funded: projection.arms.filter((arm) => arm.funded).map((arm) => arm.arm),
        caps: config.caps,
        settings: settingsOf(config, request.models),
        inputs,
        billing,
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
        releasedAt: null,
        funding: null,
        amendments: [],
      };
      files.writePlan(plan);
      if (plan.confirmedAt === null) {
        const outcome: ComparisonOutcome = request.planOnly ? 'planned' : 'needs_confirmation';
        return { outcome, report: await report(request, env, engine, files, base, guards) };
      }
    }
    if (request.planOnly) {
      return {
        outcome: 'planned',
        report: await report(request, env, engine, files, base, guards),
      };
    }
    const localMinutes = (2 * lockedTestsOf(base, config) * model.localSeconds.value) / 60;
    const problem = resumeProblem(plan, request, localMinutes);
    if (problem !== null) throw new Error(problem);
    const credit = new Credit(engine, guards.credit, model.studentUsd.value);
    plan = answerFunding(files, plan, request, engine, credit, now, env.log);
    // The plan is confirmed and this request matches it: its cap holds the credit from here.
    guards.credit.holdTo(plan.caps.studentUsd);
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
    if (usesGpu(confirmed) && guards.gpu.refusal() !== null) {
      env.log(
        'No GPU window is granted to this command (--gpu-minutes): the work this plan does on this computer waits for one.',
      );
    }
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

    const stopWatching = watchRounds(engine, confirmed, credit, base, config, env, decide);
    try {
      await holdBackAfterRelease(engine, files, decide);
      engine.recover();
      const development: readonly ArmId[] = confirmed.funded.filter((arm) => !MEASURING.has(arm));
      if ((files.readPlan()?.releasedAt ?? null) === null) {
        if (request.regressionJobDir !== undefined && confirmed.funded.includes('bare')) {
          await regressionCheck(request, env, engine, deps, files, request.regressionJobDir);
        }
        // An arm the money can't pay for waits for the person: no arm is dropped for it, and no
        // locked test is released, until they raise the cap or drop it (decision 081).
        const waitForPerson = async (short: Short) => {
          const pause: FundingPause = { ...short, at: now() };
          files.writePlan({ ...(files.readPlan() ?? confirmed), funding: pause });
          env.log(fundingMessage(pause));
          return {
            outcome: 'needs_funding' as const,
            report: await report(request, env, engine, files, base, guards),
          };
        };
        let short: Short | null = null;
        for (const wave of DEVELOPMENT_WAVES) {
          const arms = wave.filter((arm) => development.includes(arm));
          for (const arm of arms) {
            if (aborted()) break;
            if (armRun(engine.store, arm) !== null) continue;
            // A decision is final: an arm dropped once is never reconsidered.
            if ((files.readPlan() ?? confirmed).decisions.some((item) => item.arm === arm)) {
              continue;
            }
            // Priced again before every arm starts, at what an attempt has really cost so far.
            short = fundingShort(arm, confirmed, credit, engine, base, config);
            if (short !== null) break;
            // The library's copy of the job drops the organizations it never trains on; each
            // arm's copy is imported beside every task again, so it lists them as the source does.
            const armBase = { ...base, organizations: source.organizations };
            await startArm(
              arm,
              request,
              env,
              engine,
              deps,
              files,
              armBase,
              confirmed,
              decide,
              study,
            );
          }
          // Arms already started finish their development; none starts after a pause.
          await settle(engine, env, guards, arms, aborted);
          if (short !== null) break;
        }
        if (short !== null && !aborted()) return await waitForPerson(short);

        // Every arm is frozen, or ended without a graduate, before any locked result exists.
        const waiting = development.filter((arm) => {
          const run = armRun(engine.store, arm);
          return run !== null && run.freeze === null && !isTerminal(run.run.status);
        });
        if (aborted() || waiting.length > 0) {
          env.log(
            `Not every arm froze (${waiting.map((arm) => ARM_LABELS[arm]).join(', ')}), so every locked test stays held. Run again once they can finish.`,
          );
          return {
            outcome: 'incomplete',
            report: await report(request, env, engine, files, base, guards),
          };
        }
        // Every planned arm is frozen, ended, or decided; one that is none of these holds the release.
        const decisions = (files.readPlan() ?? confirmed).decisions;
        const unstarted = development.filter(
          (arm) =>
            armRun(engine.store, arm) === null && !decisions.some((item) => item.arm === arm),
        );
        if (unstarted.length > 0) {
          env.log(
            `${unstarted.map((arm) => ARM_LABELS[arm]).join(', ')} never started, so every locked test stays held. Run again to start them.`,
          );
          return {
            outcome: 'incomplete',
            report: await report(request, env, engine, files, base, guards),
          };
        }
        // The release pays for every frozen arm's locked test, or waits for the person.
        const test = testFundingShort(engine, files, credit, base, config);
        if (test !== null) return await waitForPerson(test);
        markReleased(files, now());
      }
      if (aborted()) {
        return {
          outcome: 'incomplete',
          report: await report(request, env, engine, files, base, guards),
        };
      }
      const released = release(engine, files, credit, base, config, decide);
      env.log(
        `Every arm is frozen; ${released.length} locked test${released.length === 1 ? ' is' : 's are'} released.`,
      );
      await settle(engine, env, guards, released, aborted);

      await measureAfterRelease(
        request,
        env,
        engine,
        files,
        confirmed,
        credit,
        guards,
        base,
        decide,
        aborted,
      );
    } finally {
      stopWatching();
    }
    const done = await report(request, env, engine, files, base, guards);
    // A measurement left paused, such as a local re-test the GPU window cut, isn't finished.
    const paused =
      engine.store.references.withStatus('paused').length +
      engine.store.retests.withStatus('paused').length +
      engine.store.repeats.withStatus('paused').length;
    const finished =
      paused === 0 &&
      done.arms.every(
        (arm) => arm.status === 'complete' || arm.status === 'stopped' || arm.status === 'not_run',
      );
    return { outcome: finished ? 'finished' : 'incomplete', report: done };
  } finally {
    await opened?.close();
    unlock();
  }
}

/** The request with the locked test's size the job's folder sets. */
function withLockedTests(request: ComparisonRequest, field: Field): ComparisonRequest {
  return {
    ...request,
    config: {
      ...request.config,
      lockedTests: field.lockedTests,
      certifyAttempts: field.certifyAttempts,
    },
  };
}

/** Spark's study of a field job for the whole comparison, and whether the person confirmed it. */
interface Study {
  /** The brief, which every arm starts from once confirmed; null for a job with nothing to study. */
  record: StudyRecord | null;
  confirmed: boolean;
}

/**
 * Spark's study of a field job's organizations, once for the whole comparison (decision 069): it
 * reads the train organizations' files and writes its brief, which the person reads in the
 * output folder's `study.json` and confirms by passing its token. A study already made is kept,
 * so a later command makes no call; one the material changed since is made again. Every arm
 * starts from the same confirmed brief. A job without organizations has nothing to study.
 */
async function studyOnce(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  deps: LoopDeps,
  files: ComparisonFiles,
  base: Job,
): Promise<Study> {
  if (!isStudied(base)) return { record: null, confirmed: true };
  let state = await engine.jobs.studyState(base.id);
  if (state === null || state.state === 'unstudied' || state.state === 'changed') {
    env.log("Study: Spark reads the train organizations' files and writes its brief.");
    state = await new JobStudy({
      jobs: engine.jobs,
      paths: engine.paths,
      deps,
      clock: env.clock,
      // Its own cap, and never more than Spark's budget for the whole comparison.
      capUsd: Math.min(STUDY_CAP_USD, request.config.caps.sparkUsd),
    }).study(base.id);
  }
  if (state.state === 'needed' && request.studyToken !== undefined) {
    state = await engine.jobs.confirmStudy(base.id, request.studyToken);
  }
  const record = await engine.jobs.studyRecord(base.id);
  if (record === null) throw new Error("Spark's study left no brief.");
  files.writeStudy(record);
  const confirmed = state.state === 'confirmed';
  if (!confirmed) {
    env.log(
      `Spark's brief is in ${files.study}. Read it, and to confirm it for every arm run again with: --confirm-study ${state.token}`,
    );
  }
  return { record, confirmed };
}

/**
 * Puts the comparison's confirmed brief beside an arm's job copy, which holds the same train
 * organizations' files, so the arm starts from it; a copy whose files don't match is refused.
 */
async function shareStudy(engine: ComparisonEngine, job: Job, record: StudyRecord): Promise<void> {
  if ((await engine.jobs.studyState(job.id))?.state === 'confirmed') return;
  await engine.jobs.writeStudy(job.id, record);
  const state = await engine.jobs.studyState(job.id);
  if (state?.state !== 'confirmed') {
    throw new Error(
      `The confirmed brief doesn't match the organizations' files in ${job.id}, so it isn't shared with that arm.`,
    );
  }
}

/**
 * The test-release barrier: written once, just before the first locked result is released. From
 * then on no arm starts and none goes on developing (decision 051).
 */
function markReleased(files: ComparisonFiles, at: string): void {
  const current = files.readPlan();
  if (current === null || current.releasedAt !== null) return;
  files.writePlan({ ...current, releasedAt: at, funding: null });
}

/**
 * Before anything resumes once a locked result exists: an arm still developing would learn
 * after it, so it is paused for good and said so, never resumed. The runner releases tests only
 * when every arm is frozen or ended, so this finds nothing unless the records were changed.
 */
async function holdBackAfterRelease(
  engine: ComparisonEngine,
  files: ComparisonFiles,
  decide: Decide,
): Promise<void> {
  const releasedAt = files.readPlan()?.releasedAt ?? null;
  if (releasedAt === null) return;
  for (const record of engine.store.runs.list()) {
    const arm = record.protocol?.arm as ArmId | undefined;
    if (arm === undefined || record.freeze !== null || isTerminal(record.run.status)) continue;
    // Nothing is active yet, so this parks it where the records left it.
    await engine.controller.pause(record.run.id);
    decide({
      arm,
      kind: 'stopped',
      reason: `It was still developing when the first locked result was released (${releasedAt}), so it stays where it was: nothing may learn after a locked result exists.`,
    });
  }
}

/**
 * Attempts a released run's final test still has to make under its frozen configuration: the
 * locked test's first seed and, for a certified job, every agreement attempt at each locked-test
 * and calibration task.
 */
function testsLeft(
  engine: ComparisonEngine,
  run: StoredRun,
  base: Job,
  config: ComparisonConfig,
): number {
  const made = engine.store.attempts
    .list({ runId: run.run.id })
    .filter((attempt) => attempt.config?.startsWith('reference/') !== true);
  return finalTestAttemptsLeft(base, config, run.freeze?.testSeeds?.[0], made);
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
    ...(funded('reference') || funded('reference-targeted') ? (['reference'] as const) : []),
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

/** What an arm needs and what is left, when the student's credit can't pay for it. */
type Short = Omit<FundingPause, 'at'>;

/**
 * Why the student's credit can't start an arm now, or null: what it may spend at the price an
 * attempt has actually cost so far, with its headroom, must fit what is left after everything
 * paid or held in flight, what the arms already started may still spend (their locked tests
 * among it), and the repeat when it comes before the arm in 037's order. The fixed arm needs $5
 * of it, as 037 says.
 */
function fundingShort(
  arm: ArmId,
  plan: PlanRecord,
  credit: Credit,
  engine: ComparisonEngine,
  base: Job,
  config: ComparisonConfig,
): Short | null {
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
    held += repeated * lockedTestsOf(base, config) * price * config.headroom;
  }
  const left = plan.caps.studentUsd - credit.paid() - held;
  if (floor <= left + 1e-9) return null;
  return {
    arm,
    stage: 'start',
    priceUsd: price,
    needUsd: floor,
    leftUsd: left,
    capUsd: plan.caps.studentUsd,
  };
}

/** What a frozen run's locked test still costs: at its own attempts' price on the hosted copy. */
function testCost(
  engine: ComparisonEngine,
  run: StoredRun,
  credit: Credit,
  base: Job,
  config: ComparisonConfig,
): number {
  if (run.lockedTestOn !== 'hosted') return 0;
  return testsLeft(engine, run, base, config) * credit.priceOf(run.run.id) * config.headroom;
}

/**
 * Before the release, the first frozen arm in 037's order whose locked test the credit can't pay
 * for, each priced at what its own attempts cost; null when every one fits, so the release holds
 * none of them for money (decision 081).
 */
function testFundingShort(
  engine: ComparisonEngine,
  files: ComparisonFiles,
  credit: Credit,
  base: Job,
  config: ComparisonConfig,
): Short | null {
  const plan = files.readPlan();
  if (plan === null) return null;
  let left = plan.caps.studentUsd - credit.paid();
  for (const arm of ARM_ORDER) {
    const run = armRun(engine.store, arm);
    if (run === null || run.freeze === null || isTerminal(run.run.status)) continue;
    if (plan.decisions.some((item) => item.arm === arm && item.kind !== 'stopped')) continue;
    const need = testCost(engine, run, credit, base, config);
    if (need > left + 1e-9) {
      return {
        arm,
        stage: 'test',
        priceUsd: credit.priceOf(run.run.id),
        needUsd: need,
        leftUsd: left,
        capUsd: plan.caps.studentUsd,
      };
    }
    left -= need;
  }
  return null;
}

/**
 * The person's answer to a comparison paused for money, taken only before any locked test is
 * released (decision 081): a raised student cap, recorded as an amendment with the old and new
 * caps and the price that asked for it, and the paused arm's own cap raised to what it needs at
 * that price; or arms dropped, each recorded as the person's decision. Either clears the pause,
 * and the runner prices every arm again.
 */
function answerFunding(
  files: ComparisonFiles,
  plan: PlanRecord,
  request: ComparisonRequest,
  engine: ComparisonEngine,
  credit: Credit,
  now: () => string,
  log: (line: string) => void,
): PlanRecord {
  const raise = request.studentCapUsd;
  // An arm the person dropped before stays dropped; asking again changes nothing.
  const drops = (request.dropArms ?? []).filter(
    (arm) => !plan.decisions.some((item) => item.arm === arm && item.kind === 'dropped'),
  );
  if ((raise === undefined || raise === plan.caps.studentUsd) && drops.length === 0) return plan;
  if (plan.releasedAt !== null) {
    throw new Error(
      `The locked tests were released at ${plan.releasedAt}, so the student cap can't change and no arm can be dropped any more.`,
    );
  }
  const pause = plan.funding;
  const next: PlanRecord = {
    ...plan,
    funding: null,
    decisions: [...plan.decisions],
    amendments: [...plan.amendments],
    studentCaps: { ...plan.studentCaps },
  };
  for (const arm of drops) {
    if (!plan.arms.includes(arm)) throw new Error(`${ARM_LABELS[arm]} isn't in this plan.`);
    const run = armRun(engine.store, arm);
    if (run !== null && run.freeze === null && !isTerminal(run.run.status)) {
      throw new Error(
        `${ARM_LABELS[arm]} is still developing; only an arm that hasn't started or has frozen can be dropped.`,
      );
    }
    const reason =
      pause?.arm === arm
        ? `You dropped it before any locked test was released, when at $${pause.priceUsd.toFixed(4)} an attempt it needed $${pause.needUsd.toFixed(2)} and $${Math.max(0, pause.leftUsd).toFixed(2)} was left under the $${pause.capUsd.toFixed(2)} cap.`
        : 'You dropped it before any locked test was released.';
    next.decisions.push({ arm, kind: 'dropped', by: 'person', reason, at: now() });
    log(`${ARM_LABELS[arm]}: ${reason}`);
  }
  if (raise !== undefined && raise !== plan.caps.studentUsd) {
    if (raise < plan.caps.studentUsd) {
      throw new Error(
        `The student cap can only be raised: it is $${plan.caps.studentUsd.toFixed(2)}.`,
      );
    }
    const arm = pause?.arm ?? null;
    const armFrom = arm === null ? undefined : plan.studentCaps[arm];
    const armTo =
      pause?.stage === 'start' && armFrom !== undefined && armFrom < pause.needUsd
        ? pause.needUsd
        : null;
    if (arm !== null && armTo !== null) next.studentCaps[arm] = armTo;
    next.amendments.push({
      arm,
      fromUsd: plan.caps.studentUsd,
      toUsd: raise,
      armFromUsd: armTo === null ? null : (armFrom ?? null),
      armToUsd: armTo,
      priceUsd: pause?.priceUsd ?? credit.price(),
      at: now(),
    });
    next.caps = { ...plan.caps, studentUsd: raise };
    log(
      `The hosted student's cap is raised from $${plan.caps.studentUsd.toFixed(2)} to $${raise.toFixed(2)}, before any locked test was released.`,
    );
  }
  files.writePlan(next);
  return next;
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
  config: ComparisonConfig,
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
    const test = record.lockedTestOn === 'hosted' ? finalTestAttemptsOf(base, config) : 0;
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
 * Returns the arms released. One the credit can't pay for stays held, said so, and stays held in
 * every later run of the plan.
 */
function release(
  engine: ComparisonEngine,
  files: ComparisonFiles,
  credit: Credit,
  base: Job,
  config: ComparisonConfig,
  decide: Decide,
): ArmId[] {
  const released: ArmId[] = [];
  const plan = files.readPlan();
  const decisions = plan?.decisions ?? [];
  let left = (plan?.caps.studentUsd ?? config.caps.studentUsd) - credit.paid();
  for (const arm of ARM_ORDER) {
    const run = armRun(engine.store, arm);
    if (run === null || run.freeze === null || isTerminal(run.run.status)) continue;
    if (decisions.some((item) => item.arm === arm && item.kind !== 'stopped')) continue;
    const cost = testCost(engine, run, credit, base, config);
    if (run.protocol?.released === true) {
      // Released by an earlier run of the plan: what its test has left is held for it first.
      left -= cost;
      released.push(arm);
      continue;
    }
    if (cost > left + 1e-9) {
      decide({
        arm,
        kind: 'held',
        reason: `Its final test would cost $${cost.toFixed(2)}, more than the $${Math.max(0, left).toFixed(2)} of the hosted student's budget left after the comparisons before it, so it didn't run.`,
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
  deps: LoopDeps,
  files: ComparisonFiles,
  base: Job,
  plan: PlanRecord,
  decide: Decide,
  study: Study,
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
    deps,
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
    deps,
    files.staging(arm),
    request.jobDir,
    start.job,
    plan.inputs.job,
    env.writeHarness,
    start.startingHarness,
  );
  if (study.record !== null) await shareStudy(engine, job, study.record);
  const run = await engine.controller.start(job.id, start.method, request.config.mentoringSeed, {
    lockedTestOn: start.lockedTestOn,
    protocol: start.protocol,
  });
  env.log(`${ARM_LABELS[arm]}: started run ${run.id}.`);
}

/**
 * How often a paused run or measurement is asked again in one command: after a rest, up to five
 * times in a row for an error that may pass; once for a guard's refusal, and only while that
 * guard allows it, since waiting won't change it. Null when it isn't asked again.
 */
function resumeLimit(guards: Guards, error: string | undefined): number | null {
  if (!isGuardRefusal(error)) return MAX_RESUMES;
  return guardAllows(guards, error) ? 1 : null;
}

/**
 * Waits until nothing runs, resuming a run an error paused after a rest, at most five times in a
 * row; a run frozen and held is settled. A run a guard paused (the credit used up, the GPU window
 * over or not granted) goes on only when that guard allows it, as when a later command has a GPU
 * window. Arms still paused after that stay paused, reported so.
 */
async function settle(
  engine: ComparisonEngine,
  env: ComparisonEnvironment,
  guards: Guards,
  arms: readonly ArmId[],
  aborted: () => boolean,
): Promise<void> {
  const resumes = new Map<string, number>();
  for (;;) {
    await engine.controller.idle();
    if (aborted()) return;
    const paused = arms
      .map((arm) => armRun(engine.store, arm))
      .filter((run): run is StoredRun => {
        if (run === null || run.run.status !== 'paused' || isHeld(run)) return false;
        const limit = resumeLimit(guards, run.run.error);
        return limit !== null && (resumes.get(run.run.id) ?? 0) < limit;
      });
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
 * A side measurement to ask for again: paused by an error a rest may clear, or by a guard that
 * allows it now.
 */
function mayAskAgain(guards: Guards, record: { status: string; error?: string }): boolean {
  return record.status === 'paused' && resumeLimit(guards, record.error) !== null;
}

/**
 * After the release: Spark as a reference with the bare arm's graduate and, when the plan
 * declared it, with the targeted arm's (each its own cap), the local re-tests (free), and the
 * repeats in 037's order while the student's credit pays for each, priced at what that arm's
 * attempts cost. Decisions recorded earlier stand: a reference dropped stays dropped, and once
 * the credit stopped the repeat no other repeat starts.
 */
async function measureAfterRelease(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  files: ComparisonFiles,
  plan: PlanRecord,
  credit: Credit,
  guards: Guards,
  base: Job,
  decide: Decide,
  aborted: () => boolean,
): Promise<void> {
  const { controller } = engine;
  const finished = (arm: ArmId) => {
    const run = armRun(engine.store, arm);
    return run !== null && run.run.status === 'finished' ? run : null;
  };
  const decided = (arm: ArmId) =>
    (files.readPlan()?.decisions ?? []).some((item) => item.arm === arm);
  // Never asked yet, or paused by an error; one a guard paused once at most, while it allows.
  const askedOnce = new Set<string>();
  const askAgain = (key: string, record: { status: string; error?: string } | null) => {
    if (record === null) return true;
    if (!mayAskAgain(guards, record)) return false;
    if (!isGuardRefusal(record.error)) return true;
    if (askedOnce.has(key)) return false;
    askedOnce.add(key);
    return true;
  };
  for (let attempt = 0; attempt <= MAX_RESUMES; attempt += 1) {
    if (aborted()) return;
    for (const { arm, on } of REFERENCES) {
      if (!plan.funded.includes(arm) || decided(arm)) continue;
      const run = finished(on);
      if (run === null) {
        decide({
          arm,
          kind: 'dropped',
          reason: `The ${ARM_LABELS[on].toLowerCase()} arm has no frozen graduate's test to share.`,
        });
        continue;
      }
      // Finished, under way, or paused by a guard that holds: nothing to ask for now.
      const record = engine.store.references.get(run.run.id, 'test');
      if (!askAgain(`reference/${run.run.id}`, record)) continue;
      const { sparkCaps } = request.config;
      const cap = arm === 'reference' ? sparkCaps.reference : sparkCaps.referenceTargeted;
      await askFor(env, ARM_LABELS[arm], () => controller.reference(run.run.id, 'test', cap));
    }
    if (request.config.localOllama) {
      for (const arm of ['bare', 'targeted'] as const) {
        const run = finished(arm);
        if (run === null || run.lockedTestOn === 'local') continue;
        const retest = engine.store.retests.get(run.run.id, 'local');
        if (!askAgain(`retest/${run.run.id}`, retest)) continue;
        await askFor(env, `${ARM_LABELS[arm]} on this computer`, () =>
          controller.retest(run.run.id, 'local'),
        );
      }
    }
    if (plan.funded.includes('repeat')) {
      let left = plan.caps.studentUsd - credit.paid();
      const skipped: string[] = [];
      const stoppedBefore = decided('repeat');
      for (const arm of REPEATED) {
        const run = finished(arm);
        if (run === null) continue;
        const repeat = engine.store.repeats.get(run.run.id, run.lockedTestOn);
        if (!askAgain(`repeat/${run.run.id}`, repeat)) continue;
        if (repeat === null) {
          // Once the credit stopped the repeat, no other repeat starts.
          if (stoppedBefore) continue;
          const cost =
            run.lockedTestOn === 'hosted'
              ? lockedTestsOf(base, request.config) *
                credit.testPriceOf(run.run.id) *
                request.config.headroom
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
    if (aborted()) return;
    const pausedSide = [
      ...engine.store.references.withStatus('paused'),
      ...engine.store.retests.withStatus('paused'),
      ...engine.store.repeats.withStatus('paused'),
    ].filter((record) => !isGuardRefusal(record.error)).length;
    if (pausedSide === 0) return;
    env.log(`${pausedSide} measurement(s) paused after an error; asking again after a rest.`);
    await waitOn(env.clock, env.resumeAfterMs ?? 60_000);
  }
}

/** The bare student on 30 dev tasks of another job, hosted: the runtime regression check. */
async function regressionCheck(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  deps: LoopDeps,
  files: ComparisonFiles,
  dir: string,
): Promise<void> {
  const source = readJob(dir);
  const pinned = files.readPlan()?.inputs.regression ?? pinInputs(dir, source);
  const job = await ensureJob(
    engine,
    deps,
    files.staging('regression'),
    dir,
    comparisonJob(source, request.config, request.models),
    pinned,
    noHarness,
  );
  const dev = await engine.jobs.tasks(job.id, 'dev');
  const tasks = sampleTrainBatch(
    dev,
    REGRESSION_PER_TYPE * job.taskTypes.length,
    deriveSeed(request.config.mentoringSeed, 'regression'),
  );
  env.log(
    `Runtime regression check: the bare student on ${tasks.length} dev tasks of ${job.name}.`,
  );
  await sweep({
    name: 'regression',
    job,
    jobDir: engine.paths.jobDir(job.id),
    tasks,
    target: 'hosted',
    seed: deriveSeed(request.config.mentoringSeed, 'regression'),
    concurrency: request.config.concurrency,
    deps,
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
  guards: Pick<Guards, 'credit'> | null,
): Promise<ComparisonReport> {
  const built = await composeReport(request, env, engine, files, base, guards);
  await writeFile(files.reportJson, `${JSON.stringify(built, null, 2)}\n`);
  await writeFile(files.reportMarkdown, renderMarkdown(built));
  return built;
}

/** The report from the records as they stand, written nowhere. */
async function composeReport(
  request: ComparisonRequest,
  env: ComparisonEnvironment,
  engine: ComparisonEngine,
  files: ComparisonFiles,
  base: Job,
  guards: Pick<Guards, 'credit'> | null,
): Promise<ComparisonReport> {
  let regression: { job: Job; attempts: SweepAttempt[] } | null = null;
  if (request.regressionJobDir !== undefined) {
    const attempts = files.readSweep('regression');
    const source = readJob(request.regressionJobDir);
    if (attempts.length > 0) regression = { job: source, attempts };
  }
  const plan = files.readPlan();
  const source = readJob(request.jobDir);
  const field = fieldOf(request.jobDir, source);
  return buildReport({
    engine,
    deps: env.deps,
    config: withLockedTests(request, field).config,
    field,
    study: isStudied(base) ? await engine.jobs.studyRecord(base.id) : null,
    // The plan as stored: decisions made since it was confirmed are in the file.
    plan,
    base,
    calibration: files.readSweep('calibration'),
    regression,
    credit: guards === null ? null : guards.credit.summary(),
    dryRun: env.dryRun,
    commit: env.commit,
    now: new Date(env.clock.now()).toISOString(),
  });
}

/**
 * The local throughput probe: the bare student on a few calibration tasks on this computer, with
 * the meter on, so the GPU time a local evaluation takes is measured, not guessed. It loads the
 * model on the GPU, so it runs only within the window the owner grants (`--gpu-minutes`), held to
 * it like any local work, and sends nothing to the hosted student. It resumes no run.
 */
export async function probeLocal(
  request: Pick<ComparisonRequest, 'jobDir' | 'out' | 'config' | 'models'>,
  env: ComparisonEnvironment,
  options: { tasks: number; meter: RuntimeMeter | null },
): Promise<{ attempts: number; reading: MeterReading | null }> {
  const unlock = lockFolder(request.out);
  const files = new ComparisonFiles(request.out);
  const guards = openGuards(files, env, 0, request.config.caps.localMinutes);
  const deps = guardedDeps(env.deps, guards);
  const engine = openComparisonEngine(files.dataDir, deps, env.clock, {
    parallel: 1,
    concurrency: 1,
    onError: (error) => env.log(`engine: ${errorMessage(error)}`),
  });
  try {
    const source = readJob(request.jobDir);
    const base = await ensureJob(
      engine,
      deps,
      files.staging('base'),
      request.jobDir,
      comparisonJob(source, request.config, request.models),
      pinJob(files, request.jobDir, source),
      noHarness,
    );
    const tasks = (await engine.jobs.tasks(base.id, 'calibration')).slice(0, options.tasks);
    // The probe loads the model only on a GPU the app has none of (decision 046).
    if (request.config.caps.localMinutes > 0) await env.checkGpu();
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
      deps,
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
  // Nothing resumes and nothing is sent: the report reads the records as they stand.
  const engine = openComparisonEngine(files.dataDir, env.deps, env.clock, {
    parallel: 1,
    concurrency: 1,
    onError: (error) => env.log(`engine: ${errorMessage(error)}`),
  });
  try {
    const source = readJob(request.jobDir);
    const id = comparisonJob(source, request.config, request.models).id;
    const base = await findJob(engine, id);
    if (base === null) throw new Error(`${request.out} holds no comparison of ${id} yet.`);
    const plan = files.readPlan();
    const credit = new StudentCredit(
      files.journal,
      plan?.caps.studentUsd ?? request.config.caps.studentUsd,
      env.clock,
    );
    return await report(request, env, engine, files, base, { credit });
  } finally {
    await engine.close();
    unlock();
  }
}
