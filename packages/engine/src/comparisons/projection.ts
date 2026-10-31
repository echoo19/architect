import {
  ARM_LABELS,
  armInSentence,
  ArmIdSchema,
  MENTOR_PRESETS,
  type AdapterProtocol,
  type ArmId,
  type ArmProjection,
  type Billing,
  type ComparisonCaps,
  type Job,
  type Projection,
  type ProjectionInput,
} from '@architect/shared';
import { percentile } from '../report/report-card';
import { MAX_FINDINGS } from '../loop/intervene';
import { lockedTestsOf } from './field';
import type { ProbeReading, SweepAttempt } from './records';

/** Decision 037's arms, in its order. */
export const ARM_ORDER: readonly ArmId[] = ArmIdSchema.options;

/** How a comparison is set up; the defaults are decision 037's, and the owner sets the caps. */
export interface ComparisonConfig {
  /** The arms asked for; they are funded and run in decision 037's order whatever this order. */
  arms: readonly ArmId[];
  caps: ComparisonCaps;
  /** Spark's cap for each arm that calls it (decision 037), and the second reference's (051). */
  sparkCaps: {
    draft: number;
    targeted: number;
    fixed: number;
    reference: number;
    referenceTargeted: number;
    weights: number;
  };
  mentoringSeed: number;
  /** The locked test's decoding seeds: the first for every arm, the rest for the repeat. */
  testSeeds: readonly number[];
  /** Refinement rounds for the targeted and fixed arms, at most. */
  rounds: number;
  /** Training rounds for the failure-specific adapter, at most. */
  weightsRounds: number;
  /** Verified demonstrations per task type for the one-shot adapter. */
  oneShotPerType: number;
  /** The longest one training job may run (decision 037: 90 minutes on one L40S). */
  jobMinutes: number;
  /** The intervention the fixed arm is held to. */
  fixedIntervention: 'procedure' | 'retrieval' | 'helper';
  /** The bare and targeted graduates also take the locked test on this computer's Ollama. */
  localOllama: boolean;
  /** Real training compute is set up: a Hugging Face token with credit. */
  realCompute: boolean;
  /** llama-server may serve adapters here: the GPU window for the weights arms is granted. */
  llamaServer: boolean;
  /**
   * How the one-shot adapter is measured: in four configurations on dev, or by the reduced
   * protocol for one GPU window, a smoke check and then the locked test with and without it.
   */
  adapterProtocol: AdapterProtocol;
  /** The reduced protocol's smoke check: train tasks with the adapter before the locked test. */
  smokeTasks: number;
  /** Each arm's student cap is its projection times this, its share of the slack. */
  headroom: number;
  /** An arm's student cap set by hand, below or above its projection times the headroom. */
  studentCaps?: Partial<Record<ArmId, number>>;
  /** Attempts in flight at once within a hosted evaluation. */
  concurrency: number;
  /**
   * The locked test's tasks per run, which the runner sets from the job's folder: more than the
   * test split when the job has organizations it never trains on (`fieldOf`).
   */
  lockedTests?: number;
  /** The attempts a certified job's locked test adds (decision 077), set like `lockedTests`. */
  certifyAttempts?: number;
}

export const DEFAULT_CONFIG: Omit<ComparisonConfig, 'arms' | 'caps'> = {
  sparkCaps: { draft: 1, targeted: 5, fixed: 5, reference: 4, referenceTargeted: 4, weights: 3 },
  mentoringSeed: 1,
  testSeeds: [101, 102],
  rounds: 2,
  weightsRounds: 2,
  oneShotPerType: 4,
  jobMinutes: 90,
  fixedIntervention: 'procedure',
  localOllama: false,
  realCompute: false,
  llamaServer: false,
  adapterProtocol: 'four-cell',
  smokeTasks: 3,
  headroom: 1.2,
  concurrency: 6,
};

/** The L40S's price on Hugging Face Jobs (decision 035), per hour. */
export const JOB_PRICE_PER_HOUR = 1.8;

/** A mentor call's size when nothing measured it yet: a round's view and a whole reply. */
const ASSUMED_MENTOR_CALL = { inputTokens: 40_000, outputTokens: 6_000 };
/** A hosted attempt's cost and time when calibration didn't price it. */
const ASSUMED_STUDENT = { usd: 0.01, seconds: 18 };
/** A local attempt's time on this computer before a probe: Oct 27's 4-bit median, 1 min 57 s. */
const ASSUMED_LOCAL_SECONDS = 117;
/** Corrections the mentor makes per round as the agent, at most, in the projection. */
const CORRECTIONS_PER_ROUND = MAX_FINDINGS * 2;

/** The measurement model's inputs, each measured on the calibration tasks or assumed, and said so. */
export interface ModelInputs {
  studentUsd: ProjectionInput;
  studentSeconds: ProjectionInput;
  inputTokens: ProjectionInput;
  outputTokens: ProjectionInput;
  sparkCallUsd: ProjectionInput;
  sparkAttemptUsd: ProjectionInput;
  localSeconds: ProjectionInput;
  jobUsd: ProjectionInput;
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Spark's price, from its preset: what every Spark line of the projection is priced at. */
function sparkPricing(job: Job): { inputPerM: number; outputPerM: number } {
  const mentor = job.mentor;
  const preset =
    mentor.kind === 'model'
      ? MENTOR_PRESETS.find((candidate) => candidate.model === mentor.model)
      : undefined;
  const pricing = mentor.kind === 'model' ? (mentor.pricing ?? preset?.pricing) : undefined;
  if (pricing === undefined) {
    throw new Error("The mentor's price isn't known, so the plan can't be held to a Spark cap.");
  }
  return pricing;
}

/**
 * Calibration's cost held up against the provider's billing: over the attempts whose every model
 * call came back with the provider's charge (OpenRouter reports one per call), what it billed and
 * what the listed price of the same usage comes to. Null before calibration.
 */
export function billingOf(calibration: readonly SweepAttempt[]): Billing | null {
  if (calibration.length === 0) return null;
  const whole = calibration.filter(
    (attempt) => attempt.calls > 0 && attempt.billedCalls === attempt.calls,
  );
  const billedUsd = whole.reduce((sum, attempt) => sum + attempt.billedUsd, 0);
  const listedUsd = whole.reduce((sum, attempt) => sum + (attempt.listedUsd ?? 0), 0);
  return {
    calls: calibration.reduce((sum, attempt) => sum + attempt.calls, 0),
    billedCalls: calibration.reduce((sum, attempt) => sum + attempt.billedCalls, 0),
    billedUsd,
    listedUsd,
    ratio: whole.length === 0 || listedUsd <= 0 ? null : billedUsd / listedUsd,
  };
}

/** Words for where calibration's price per attempt came from. */
function pricedBy(billing: Billing | null, attempts: number): string {
  if (billing === null || billing.billedCalls === 0) {
    return `mean of ${attempts} calibration attempts at the listed price; the provider reported no charges`;
  }
  if (billing.billedCalls === billing.calls) {
    return `mean of ${attempts} calibration attempts as the provider billed them`;
  }
  return `mean of ${attempts} calibration attempts: what the provider billed for ${billing.billedCalls} of ${billing.calls} calls, the listed price of the others`;
}

/**
 * The measurement model's inputs: a hosted attempt's cost, time and tokens from the calibration
 * attempts (each at what the provider billed, where it said), a local attempt's time from the
 * probe; anything not measured yet is assumed, labeled so, and the projection says which. An
 * attempt whose cost can't be known stops the plan: it never counts as zero.
 */
export function modelInputs(
  job: Job,
  config: ComparisonConfig,
  calibration: readonly SweepAttempt[],
  probe: { attempts: readonly SweepAttempt[]; reading: ProbeReading | null },
): ModelInputs {
  const costs = calibration.flatMap((attempt) => (attempt.usd === null ? [] : [attempt.usd]));
  if (costs.length < calibration.length) {
    throw new Error(
      `${calibration.length - costs.length} of ${calibration.length} calibration attempts have no known cost: the provider reported neither a charge nor usage for some of their calls, and nothing else can price them. The plan can't be held to Glimmer's credit, so nothing beyond calibration spends.`,
    );
  }
  const measured = calibration.length > 0;
  const inputTokens = mean(calibration.map((attempt) => attempt.usage.inputTokens));
  const outputTokens = mean(calibration.map((attempt) => attempt.usage.outputTokens));
  const spark = sparkPricing(job);
  const usdOf = (tokens: { inputTokens: number; outputTokens: number }) =>
    (tokens.inputTokens * spark.inputPerM + tokens.outputTokens * spark.outputPerM) / 1_000_000;
  const localLatencies = probe.attempts.map((attempt) => attempt.latencyMs);
  const calibrationNote = `${calibration.length} calibration attempts on hosted Glimmer`;
  return {
    studentUsd: measured
      ? {
          name: 'Hosted attempt',
          value: mean(costs),
          unit: 'USD',
          source: 'measured',
          note: pricedBy(billingOf(calibration), calibration.length),
        }
      : {
          name: 'Hosted attempt',
          value: ASSUMED_STUDENT.usd,
          unit: 'USD',
          source: 'assumed',
          note: "decision 037's expected $0.01, until calibration prices one",
        },
    studentSeconds: measured
      ? {
          name: 'Hosted attempt time (p50)',
          value:
            percentile(
              calibration.map((attempt) => attempt.latencyMs),
              50,
            ) / 1000,
          unit: 's',
          source: 'measured',
          note: calibrationNote,
        }
      : {
          name: 'Hosted attempt time (p50)',
          value: ASSUMED_STUDENT.seconds,
          unit: 's',
          source: 'assumed',
          note: 'the table tools runtime measured about 18 s on Oct 27',
        },
    inputTokens: {
      name: 'Input tokens per attempt',
      value: measured ? inputTokens : 0,
      unit: 'tokens',
      source: measured ? 'measured' : 'assumed',
      note: measured ? calibrationNote : 'not measured yet',
    },
    outputTokens: {
      name: 'Output tokens per attempt',
      value: measured ? outputTokens : 0,
      unit: 'tokens',
      source: measured ? 'measured' : 'assumed',
      note: measured ? calibrationNote : 'not measured yet',
    },
    sparkCallUsd: {
      name: 'Spark author call',
      value: usdOf(ASSUMED_MENTOR_CALL),
      unit: 'USD',
      source: 'assumed',
      note: `${ASSUMED_MENTOR_CALL.inputTokens.toLocaleString('en-US')} tokens in and ${ASSUMED_MENTOR_CALL.outputTokens.toLocaleString('en-US')} out at Spark's price; each arm's Spark cap holds it whatever it costs`,
    },
    sparkAttemptUsd: {
      name: 'Spark as the agent, per task',
      value: measured
        ? usdOf({ inputTokens, outputTokens })
        : usdOf({ inputTokens: 30_000, outputTokens: 2_000 }),
      unit: 'USD',
      source: 'assumed',
      note: measured
        ? "Glimmer's measured tokens per attempt at Spark's price"
        : "30,000 tokens in and 2,000 out at Spark's price",
    },
    localSeconds:
      localLatencies.length > 0
        ? {
            name: 'Local attempt time (p50)',
            value: percentile(localLatencies, 50) / 1000,
            unit: 's',
            source: 'measured',
            note: `${localLatencies.length} probe attempts on this computer`,
          }
        : {
            name: 'Local attempt time (p50)',
            value: ASSUMED_LOCAL_SECONDS,
            unit: 's',
            source: 'assumed',
            note: 'the 4-bit build on Oct 27 (median 1 min 57 s); the 2-bit build is unmeasured until a probe',
          },
    jobUsd: {
      name: 'Training job',
      value: (config.jobMinutes / 60) * JOB_PRICE_PER_HOUR,
      unit: 'USD',
      source: 'assumed',
      note: `its whole authorization, ${config.jobMinutes} minutes on one L40S at $${JOB_PRICE_PER_HOUR.toFixed(2)} an hour, the most it can cost`,
    },
  };
}

/** What an arm needs, in attempts and dollars, at the most its caps allow. */
interface Need {
  hosted: number;
  /** Of the hosted attempts, those the engine runs one at a time: locked tests and repeats. */
  oneAtATime: number;
  local: number;
  sparkAttempts: number;
  sparkCalls: number;
  jobs: number;
  /** Spark's own cap for the arm, which the engine holds it to. */
  sparkCap: number;
}

function needOf(arm: ArmId, job: Job, config: ComparisonConfig, funded: ReadonlySet<ArmId>): Need {
  const dev = job.splits.dev * job.evaluation.devRepeats;
  // A certified locked test attempts each calibration and test task k times (decision 077).
  const test = lockedTestsOf(job, config) + (config.certifyAttempts ?? 0);
  const trainBatch = job.evaluation.trainBatch;
  // A refinement round at its most: the train batch, then both versions twice for a confirmation.
  const round = trainBatch + 4 * dev;
  const none: Need = {
    hosted: 0,
    oneAtATime: 0,
    local: 0,
    sparkAttempts: 0,
    sparkCalls: 0,
    jobs: 0,
    sparkCap: 0,
  };
  const localTest = config.localOllama ? test : 0;
  switch (arm) {
    case 'bare':
      return { ...none, hosted: dev + test, oneAtATime: test, local: localTest };
    case 'draft':
      return {
        ...none,
        hosted: 2 * dev + test,
        oneAtATime: test,
        sparkCalls: 2,
        sparkCap: config.sparkCaps.draft,
      };
    case 'targeted':
      return {
        ...none,
        hosted: dev + config.rounds * round + test,
        oneAtATime: test,
        local: localTest,
        sparkCalls: 2 * config.rounds,
        sparkAttempts: CORRECTIONS_PER_ROUND * config.rounds,
        sparkCap: config.sparkCaps.targeted,
      };
    case 'fixed':
      return {
        ...none,
        hosted: dev + config.rounds * round + test,
        oneAtATime: test,
        sparkCalls: 2 * config.rounds,
        sparkAttempts: CORRECTIONS_PER_ROUND * config.rounds,
        sparkCap: config.sparkCaps.fixed,
      };
    case 'reference':
      return { ...none, sparkAttempts: test, sparkCap: config.sparkCaps.reference };
    case 'reference-targeted':
      return { ...none, sparkAttempts: test, sparkCap: config.sparkCaps.referenceTargeted };
    case 'repeat': {
      const repeated = (['bare', 'draft', 'targeted'] as const).filter((other) =>
        funded.has(other),
      );
      return { ...none, hosted: test * repeated.length, oneAtATime: test * repeated.length };
    }
    case 'weights-one-shot':
      if (config.adapterProtocol === 'reduced') {
        return {
          ...none,
          // The run's baseline of the targeted harness it starts from.
          hosted: dev,
          // The smoke check, then the locked test with and without the adapter.
          local: config.smokeTasks + 2 * test,
          sparkAttempts: config.oneShotPerType * job.taskTypes.length,
          jobs: 1,
          sparkCap: config.sparkCaps.weights,
        };
      }
      return {
        ...none,
        hosted: 2 * dev,
        // Four configurations, measured once: a one-shot adapter is kept as measured.
        local: 4 * dev + test,
        sparkAttempts: config.oneShotPerType * job.taskTypes.length,
        jobs: 1,
        sparkCap: config.sparkCaps.weights,
      };
    case 'weights-targeted':
      return {
        ...none,
        hosted: 2 * dev + config.weightsRounds * trainBatch,
        // Five configurations once an adapter is kept, each measured twice to confirm.
        local: config.weightsRounds * 5 * 2 * dev + test,
        sparkCalls: 2 * config.weightsRounds,
        sparkAttempts: CORRECTIONS_PER_ROUND * config.weightsRounds,
        jobs: config.weightsRounds,
        sparkCap: config.sparkCaps.weights,
      };
  }
}

/** An arm's student cap: set by hand, or its projection times the headroom. */
export function studentCapOf(arm: ArmId, projected: number, config: ComparisonConfig): number {
  return config.studentCaps?.[arm] ?? projected * config.headroom;
}

/** Why an arm can't run here whatever money is left, or null. */
function prerequisite(
  arm: ArmId,
  config: ComparisonConfig,
  funded: ReadonlySet<ArmId>,
): string | null {
  const needs = (other: ArmId) =>
    funded.has(other)
      ? null
      : `It starts from the ${armInSentence(ARM_LABELS[other])} arm, which isn't funded.`;
  switch (arm) {
    case 'targeted':
    case 'fixed':
      return needs('draft');
    case 'reference':
      return needs('bare');
    case 'reference-targeted':
      return needs('targeted');
    case 'repeat':
      return ['bare', 'draft', 'targeted'].some((other) => funded.has(other as ArmId))
        ? null
        : 'It repeats the frozen student arms, and none is funded.';
    case 'weights-one-shot':
    case 'weights-targeted':
      if (!config.realCompute) {
        return 'Weights need real training compute, and no Hugging Face token with credit is set up.';
      }
      if (!config.llamaServer) {
        return "Adapters are measured and tested only on this computer's llama-server, and no GPU window is granted.";
      }
      if (arm === 'weights-targeted' && config.adapterProtocol === 'reduced') {
        return 'The reduced adapter protocol measures only the one-shot adapter; a failure-specific adapter needs dev measurements to keep or reject each round.';
      }
      return needs('targeted');
    default:
      return null;
  }
}

/**
 * Each arm's projection at the most its caps allow, and which are funded: in decision 037's
 * order, an arm is funded when every budget it draws on still has room for it after the arms
 * before it; one that doesn't fit, or whose prerequisites aren't there, is not run, with the
 * reason. Spark is funded at each arm's own cap, which the engine holds it to; the student's
 * credit at its projection times the headroom, which the runner holds it to. `committedUsd` is
 * the student's credit already spent, and `committedSparkUsd` Spark's, such as its study of a
 * field job's organizations, which every arm shares.
 */
export function project(
  job: Job,
  config: ComparisonConfig,
  inputs: ModelInputs,
  committedUsd = 0,
  committedSparkUsd = 0,
): Projection {
  const requested = new Set(config.arms);
  const funded = new Set<ArmId>();
  const left = {
    ...config.caps,
    studentUsd: config.caps.studentUsd - committedUsd,
    sparkUsd: config.caps.sparkUsd - committedSparkUsd,
  };
  const arms: ArmProjection[] = [];
  const total = { studentUsd: 0, sparkUsd: 0, computeUsd: 0, localMinutes: 0 };
  const sum = { studentUsd: 0, sparkUsd: 0, computeUsd: 0, localMinutes: 0, wallMinutes: 0 };
  for (const arm of ARM_ORDER) {
    if (!requested.has(arm)) continue;
    const need = needOf(arm, job, config, funded);
    const studentUsd = need.hosted * inputs.studentUsd.value;
    const sparkEstimate =
      need.sparkCalls * inputs.sparkCallUsd.value +
      need.sparkAttempts * inputs.sparkAttemptUsd.value;
    const sparkUsd = need.sparkCap > 0 ? Math.min(need.sparkCap, sparkEstimate) : 0;
    const computeUsd = need.jobs * inputs.jobUsd.value;
    const localMinutes = (need.local * inputs.localSeconds.value) / 60;
    // Training and dev attempts run `concurrency` at once; locked tests, repeats, Spark's tasks
    // and everything on this computer run one at a time. Spark's time per task is taken to be
    // the student's, which nothing has measured yet.
    const together = need.hosted - need.oneAtATime;
    const wallMinutes =
      ((together / Math.max(1, config.concurrency) + need.oneAtATime + need.sparkAttempts) *
        inputs.studentSeconds.value) /
        60 +
      localMinutes +
      need.jobs * config.jobMinutes;
    total.studentUsd += studentUsd;
    total.sparkUsd += sparkUsd;
    total.computeUsd += computeUsd;
    total.localMinutes += localMinutes;
    let reason = prerequisite(arm, config, funded);
    const blockedBy = reason === null ? null : ('prerequisite' as const);
    const studentReserve = studentCapOf(arm, studentUsd, config);
    // Decision 037 runs the fixed arm only with $5 of student credit left after the repeat.
    const studentFloor = arm === 'fixed' ? Math.max(5, studentReserve) : studentReserve;
    if (reason === null && studentFloor > left.studentUsd + 1e-9) {
      reason = `It needs $${studentFloor.toFixed(2)} of hosted Glimmer's budget, and $${left.studentUsd.toFixed(2)} is left after the comparisons before it.`;
    }
    if (reason === null && need.sparkCap > left.sparkUsd + 1e-9) {
      reason = `It needs $${need.sparkCap.toFixed(2)} for Spark, and $${left.sparkUsd.toFixed(2)} of Spark's budget is left after the comparisons before it.`;
    }
    if (reason === null && computeUsd > left.computeUsd + 1e-9) {
      reason = `It needs $${computeUsd.toFixed(2)} of training compute, and $${left.computeUsd.toFixed(2)} is left.`;
    }
    if (reason === null && localMinutes > left.localMinutes + 1e-9) {
      reason = `It needs about ${Math.ceil(localMinutes)} minutes of local GPU time, and ${Math.floor(left.localMinutes)} are granted.`;
    }
    const isFunded = reason === null;
    const blocked = isFunded ? null : (blockedBy ?? ('money' as const));
    if (isFunded) {
      funded.add(arm);
      left.studentUsd -= studentReserve;
      left.sparkUsd -= need.sparkCap;
      left.computeUsd -= computeUsd;
      left.localMinutes -= localMinutes;
      sum.studentUsd += studentUsd;
      sum.sparkUsd += sparkUsd;
      sum.computeUsd += computeUsd;
      sum.localMinutes += localMinutes;
      sum.wallMinutes += wallMinutes;
    }
    arms.push({
      arm,
      hostedAttempts: need.hosted,
      localAttempts: need.local,
      sparkAttempts: need.sparkAttempts,
      sparkCalls: need.sparkCalls,
      studentUsd,
      sparkUsd,
      computeUsd,
      localMinutes,
      wallMinutes,
      funded: isFunded,
      blockedBy: blocked,
      reason,
    });
  }
  return {
    inputs: Object.values(inputs),
    arms,
    caps: config.caps,
    committedUsd,
    funded: sum,
    requested: total,
  };
}

/**
 * Whether the arms asked for cost more than the caps allow, so some were cut to fit: the plan
 * waits for the owner to confirm the smaller one. An arm missing a prerequisite (no compute, no
 * GPU window) is reported, and doesn't wait.
 */
export function needsConfirmation(projection: Projection): boolean {
  return projection.arms.some((arm) => arm.blockedBy === 'money');
}
