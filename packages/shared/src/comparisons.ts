import { z } from 'zod';
import { DecodingSchema } from './harness';
import { ScoreSchema } from './lineage';
import { OrgTypeResultSchema } from './report';

/*
 * The comparisons report (decisions 037 and 045): every number the README and the demo claim,
 * computed from stored records only. The app reads this JSON; the README takes the Markdown made
 * from the same object.
 */

export const COMPARISON_REPORT_FORMAT = 'architect.comparisons/3';

/**
 * Decision 037's arms, in its order, which decides what is dropped when money runs short: the
 * earlier an arm, the earlier its claim on every budget.
 */
export const ArmIdSchema = z.enum([
  'bare',
  'draft',
  'targeted',
  'reference',
  'reference-targeted',
  'teacher',
  'repeat',
  'fixed',
  'weights-one-shot',
  'weights-targeted',
]);
export type ArmId = z.infer<typeof ArmIdSchema>;

export const ARM_LABELS: Record<ArmId, string> = {
  bare: 'Glimmer alone',
  draft: 'One-shot draft',
  targeted: 'Targeted mentoring',
  reference: 'Spark reference, blank harness',
  'reference-targeted': 'Spark reference, targeted harness',
  teacher: 'Teacher alone',
  repeat: 'Decoding repeat',
  fixed: 'Fixed intervention',
  'weights-one-shot': 'One-shot adapter',
  'weights-targeted': 'Failure-specific adapter',
};

/** An arm's name inside a sentence: lower case, except where it starts with a model's name. */
export function armInSentence(label: string): string {
  return /^(Spark|Glimmer)\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Decision 037's place of each arm; both weights arms are its seventh. Spark with the targeted
 * harness is a second reference beside the first, which stays the primary one (decision 051).
 */
export const ARM_PRIORITY: Record<ArmId, number> = {
  bare: 1,
  draft: 2,
  targeted: 3,
  reference: 4,
  'reference-targeted': 4,
  teacher: 4,
  repeat: 5,
  fixed: 6,
  'weights-one-shot': 7,
  'weights-targeted': 7,
};

/**
 * Where a comparison's attempts ran. Arms are compared only within one backend: the hosted copy
 * of the student, Spark itself as a reference, the teacher alone as the agent in a run of its own
 * (decision 095), or this computer's 2-bit build on Ollama, or on llama-server with adapters.
 */
export const BackendIdSchema = z.enum([
  'hosted',
  'reference',
  'teacher',
  'local-ollama',
  'local-llama.cpp',
]);
export type BackendId = z.infer<typeof BackendIdSchema>;

/**
 * How the one-shot adapter is measured (decision 051): `four-cell`, H0 and H1 with and without the
 * adapter on dev, then its locked test; or `reduced`, for one GPU window, a smoke check on train
 * tasks and then the locked test of H1 with and without the adapter, which measures only this
 * adapter's added effect given the frozen targeted harness.
 */
export const AdapterProtocolSchema = z.enum(['four-cell', 'reduced']);
export type AdapterProtocol = z.infer<typeof AdapterProtocolSchema>;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** A job folder as a comparison measures on it, pinned by the bytes of its files. */
export const PinnedInputsSchema = z.object({
  jobId: z.string().min(1),
  name: z.string(),
  /** `job.json` as written. */
  job: sha256Hex,
  tasks: sha256Hex,
  /** Every file under `data/`: each path with the sha256 of its bytes, in path order. */
  data: sha256Hex,
  /** The checker module; null for a built-in checker. */
  checker: sha256Hex.nullable(),
});
export type PinnedInputs = z.infer<typeof PinnedInputsSchema>;

/**
 * Calibration's cost reconciled against the provider's billing: OpenRouter reports what it
 * charged for each call, which is held up against the listed price of the same usage.
 */
export const BillingSchema = z.object({
  /** Model calls the calibration attempts made, and how many the provider said it billed. */
  calls: z.number().int().nonnegative(),
  billedCalls: z.number().int().nonnegative(),
  /** Over the attempts whose every call was billed: what the provider charged in all. */
  billedUsd: z.number().nonnegative(),
  /** The same attempts at the listed price. */
  listedUsd: z.number().nonnegative(),
  /** Billed over listed; null when nothing was billed. */
  ratio: z.number().nonnegative().nullable(),
});
export type Billing = z.infer<typeof BillingSchema>;

/**
 * The hosted student's credit as the request journal holds it (decision 051): every request
 * written down before it was sent. What is certain is paid; a request a crash or a failure cut
 * off may have been billed, so it counts as spent at the most it could have cost.
 */
export const CreditSummarySchema = z.object({
  capUsd: z.number().nonnegative(),
  requests: z.number().int().nonnegative(),
  /** Charges known: what the provider billed, or the listed price of the usage it reported. */
  settledUsd: z.number().nonnegative(),
  billedRequests: z.number().int().nonnegative(),
  /** Charges not known for sure, each at its worst case: cut off by a crash or a failure. */
  uncertainUsd: z.number().nonnegative(),
  uncertainRequests: z.number().int().nonnegative(),
  /** Requests still in flight when the summary was taken, held at their worst case too. */
  inFlightRequests: z.number().int().nonnegative(),
});
export type CreditSummary = z.infer<typeof CreditSummarySchema>;

/**
 * The journal as the report holds it: its summary, and what it counts as spent in all. The report
 * names that total beside the attempts' recorded costs, which are a different count of the same
 * requests: the journal also holds requests no recorded attempt keeps the cost of.
 */
export const ReportCreditSchema = CreditSummarySchema.extend({
  /** Settled plus uncertain: every dollar the journal counts as spent, uncertain ones at their worst. */
  totalUsd: z.number().nonnegative(),
});
export type ReportCredit = z.infer<typeof ReportCreditSchema>;

const share = z.number().min(0).max(1);

/** A count with its rate and 95% Wilson interval; both null when nothing was counted. */
export const CountedSchema = z.object({
  pass: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  rate: share.nullable(),
  wilson95: z.object({ low: share, high: share }).nullable(),
});
export type Counted = z.infer<typeof CountedSchema>;

const latency = z.object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() });

/** What a backend is, read from its records and files, never assumed. Null when not known. */
export const RuntimeIdentitySchema = z.object({
  model: z.string(),
  /** The service or program serving it: `OpenRouter (DeepInfra)`, `Ollama`, `llama-server`. */
  provider: z.string().nullable(),
  runtime: z.string(),
  quantization: z.string().nullable(),
  /** The served base's GGUF file, `sha256:<hex>`. */
  ggufSha256: z.string().nullable(),
  runtimeBuild: z.string().nullable(),
  /** The chat template, by the sha256 of its text, or how the provider applies its own. */
  chatTemplate: z.string().nullable(),
  contextLength: z.number().int().positive().nullable(),
});
export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

/**
 * The job's pass-rate target held up against observed counts: 57 of 60 meets a 95% target as
 * observed, which is not proof of 95% reliability.
 */
export const PassTargetSchema = z.object({
  passRate: share,
  /** Scenarios that must pass, of the locked test's whole size. */
  needed: z.number().int().nonnegative(),
  of: z.number().int().nonnegative(),
  /** Met as observed: every scenario ran and at least `needed` passed. */
  met: z.boolean(),
});
export type PassTarget = z.infer<typeof PassTargetSchema>;

/** Where a model answers: through a hosted provider, or on this computer. */
export const RunsOnSchema = z.enum(['hosted', 'this_computer']);
export type RunsOn = z.infer<typeof RunsOnSchema>;

/** One arm's locked-test result on one backend, under one decoding seed. */
export const ArmRowSchema = z.object({
  arm: ArmIdSchema,
  label: z.string(),
  runId: z.string().nullable(),
  /**
   * Which of an arm's configurations the row is, when it has more than one locked result: the
   * reduced adapter protocol's `H1/A1` and `H1/A0`. Null for an arm's one result.
   */
  configuration: z.string().nullable(),
  seed: z.number().int(),
  /** Scenarios: each test task once. */
  scenarios: CountedSchema,
  /** For a job with organizations, judged on the organizations it trained on alone (decision 070). */
  passTarget: PassTargetSchema,
  perType: z.array(CountedSchema.extend({ type: z.string(), label: z.string() })),
  /**
   * For a job with organizations: each task type at each organization, seen (trained on) or
   * never seen, synthetic or real. Absent for a one-organization job.
   */
  perOrg: z.array(OrgTypeResultSchema).optional(),
  /** Tasks it refused; each counts as a failure, since the contract supports every type. */
  refusals: z.number().int().nonnegative(),
  latencyMs: latency.nullable(),
  /** A first reply with the model unloaded before it, apart from the latencies above. */
  coldStartMs: z.number().int().nonnegative().nullable(),
  peakMemory: z
    .object({
      processBytes: z.number().int().nonnegative().nullable(),
      gpuBytes: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  harnessHash: z.string().nullable(),
  adapterSha256: z.string().nullable(),
  sampling: DecodingSchema.nullable(),
  /** False when fewer scenarios ran than the locked test holds: a paused or capped evaluation. */
  complete: z.boolean(),
  /** The model that answered, by its name; null in a report made before rows named it. */
  model: z.string().nullable().default(null),
  /** Where it answered: a hosted provider, or this computer. Null in an older report. */
  runsOn: RunsOnSchema.nullable().default(null),
  /**
   * What 1,000 requests like these cost where it answered: its attempts' recorded charges, each
   * what the provider billed or else the listed price of the usage it reported, over the attempts,
   * times 1,000. Zero on this computer; null when a charge isn't known or in an older report.
   */
  perThousandUsd: z.number().nonnegative().nullable().default(null),
});
export type ArmRow = z.infer<typeof ArmRowSchema>;

const pairedCounts = {
  /** Scenarios only `a` passed: its wins over `b`. */
  aOnly: z.number().int().nonnegative(),
  /** Scenarios only `b` passed: `a`'s losses. */
  bOnly: z.number().int().nonnegative(),
  both: z.number().int().nonnegative(),
  neither: z.number().int().nonnegative(),
};

/**
 * `a`'s pass rate less `b`'s on the paired scenarios, with a 95% interval for paired proportions:
 * Newcombe's hybrid score method (his method 10), made from the wins, losses, both and neither
 * counts. As shares of the scenarios, so 0.033 is 3.3 percentage points.
 */
export const PassDifferenceSchema = z.object({
  rate: z.number().min(-1).max(1),
  low: z.number().min(-1).max(1),
  high: z.number().min(-1).max(1),
});
export type PassDifference = z.infer<typeof PassDifferenceSchema>;

/** Two arms on the same backend, seed and scenarios, counted scenario by scenario. */
export const PairedSchema = z.object({
  a: ArmIdSchema,
  b: ArmIdSchema,
  /** The pair in words, naming the configurations when one arm is paired with itself. */
  label: z.string(),
  seed: z.number().int(),
  scenarios: z.number().int().nonnegative(),
  ...pairedCounts,
  /** The difference in pass rate, `a` less `b`, from the counts above. */
  difference: PassDifferenceSchema,
  byType: z.array(z.object({ type: z.string(), ...pairedCounts })),
});
export type Paired = z.infer<typeof PairedSchema>;

/** One arm under every declared seed: repeats, never more scenarios. */
export const RepeatRowSchema = z.object({
  arm: ArmIdSchema,
  label: z.string(),
  seeds: z.array(z.object({ seed: z.number().int(), score: ScoreSchema })),
  /** Scenarios that passed under every seed, the way a scenario is counted with repeats. */
  everySeed: CountedSchema,
  /** Scenarios whose result differed between seeds. */
  flipped: z.number().int().nonnegative(),
  /** False when a seed ran fewer scenarios than the locked test holds: a partial repeat. */
  complete: z.boolean(),
});
export type RepeatRow = z.infer<typeof RepeatRowSchema>;

export const BackendTableSchema = z.object({
  backend: BackendIdSchema,
  label: z.string(),
  identity: RuntimeIdentitySchema,
  rows: z.array(ArmRowSchema),
  paired: z.array(PairedSchema),
  repeats: z.array(RepeatRowSchema),
});
export type BackendTable = z.infer<typeof BackendTableSchema>;

/** What an arm spent, each line apart, from the cost ledger, the attempts and the job records. */
export const SpendSchema = z.object({
  sparkUsd: z.number().nonnegative(),
  sparkInputTokens: z.number().int().nonnegative(),
  sparkOutputTokens: z.number().int().nonnegative(),
  /** Null when some student call's price isn't known. */
  studentUsd: z.number().nonnegative().nullable(),
  studentInputTokens: z.number().int().nonnegative(),
  studentOutputTokens: z.number().int().nonnegative(),
  computeUsd: z.number().nonnegative(),
  computeMinutes: z.number().nonnegative(),
  /** False while a training job may still run: compute is then its whole authorization. */
  computeSettled: z.boolean(),
  examples: z.number().int().nonnegative(),
  trainedTokens: z.number().int().nonnegative(),
  studentAttempts: z.number().int().nonnegative(),
  sparkAttempts: z.number().int().nonnegative(),
  wallMinutes: z.number().nonnegative(),
});
export type Spend = z.infer<typeof SpendSchema>;

/** The caps an arm was held to; null where it had none of that kind. */
export const ArmCapsSchema = z.object({
  sparkUsd: z.number().nonnegative().nullable(),
  studentUsd: z.number().nonnegative().nullable(),
  computeUsd: z.number().nonnegative().nullable(),
  wallMinutes: z.number().nonnegative().nullable(),
  rounds: z.number().int().nonnegative().nullable(),
});
export type ArmCaps = z.infer<typeof ArmCapsSchema>;

export const ArmStatusSchema = z.enum([
  /** Every measurement it was planned for exists. */
  'complete',
  /** A stop or a cap cut it short; what it measured is kept. */
  'stopped',
  /** Started and not finished: waiting, paused by an error, or its test not released. */
  'incomplete',
  /** Never started; the reason says why, and nothing is inferred for it. */
  'not_run',
]);
export type ArmStatus = z.infer<typeof ArmStatusSchema>;

export const ArmReportSchema = z.object({
  arm: ArmIdSchema,
  label: z.string(),
  priority: z.number().int().min(1),
  status: ArmStatusSchema,
  reason: z.string().nullable(),
  runId: z.string().nullable(),
  /** What it started from and shares with other arms, said plainly. */
  notes: z.array(z.string()),
  caps: ArmCapsSchema,
  spent: SpendSchema,
  /**
   * What making this arm's graduate took, development only (no locked test): its own and that of
   * the arms it builds on, such as the shared draft the targeted arm starts from. The experiment
   * totals count each dollar once; this is the graduate's cumulative cost. Null without a run.
   */
  cumulative: z
    .object({
      builtOn: z.array(ArmIdSchema),
      sparkUsd: z.number().nonnegative(),
      studentUsd: z.number().nonnegative().nullable(),
      computeUsd: z.number().nonnegative(),
    })
    .nullable(),
  /**
   * What dev showed, each measurement on its own scale. `baseline` is the run's first dev
   * measurement: one run over the dev tasks. `kept` is the last round that was kept, with the
   * before and after it was decided on, which are the same tasks and seeds: the keep rule's
   * confirmation over several runs, or one run each for a one-shot draft, which has no check.
   */
  dev: z.object({
    baseline: ScoreSchema.nullable(),
    kept: z
      .object({
        round: z.number().int().positive(),
        kind: z.string(),
        before: ScoreSchema.nullable(),
        after: ScoreSchema.nullable(),
      })
      .nullable(),
  }),
  /**
   * The rounds it used of the most it was allowed (`caps.rounds`), and why training ended, in a
   * few words: the cap, patience, money, the time limit, or done. Null for an arm with no rounds.
   */
  rounds: z
    .object({ used: z.number().int().nonnegative(), ended: z.string().nullable() })
    .nullable(),
  /** The backends of the tables it has a locked-test result in; empty when it has none. */
  measuredOn: z.array(BackendIdSchema),
  experiments: z.array(
    z.object({
      round: z.number().int().positive(),
      kind: z.string(),
      title: z.string(),
      disposition: z.string(),
      devBefore: ScoreSchema.nullable(),
      devAfter: ScoreSchema.nullable(),
      /** Task types that lost dev passes in the round, before and after. */
      regressions: z.array(
        z.object({ type: z.string(), before: z.number().int(), after: z.number().int() }),
      ),
      reason: z.string(),
    }),
  ),
  frozen: z
    .object({
      harnessVersion: z.number().int().nonnegative(),
      harnessHash: z.string(),
      /** The build on this computer it is pinned to and set to run on once installed. */
      localModel: z.string(),
      /** The runtime that serves that build, or llama.cpp with an adapter. */
      backend: z.string(),
      adapter: z
        .object({
          id: z.string(),
          sha256: z.string(),
          scale: z.number(),
          baseDigest: z.string().nullable(),
          standIn: z.boolean(),
        })
        .nullable(),
      testSeeds: z.array(z.number().int()),
      decoding: DecodingSchema.nullable(),
    })
    .nullable(),
});
export type ArmReport = z.infer<typeof ArmReportSchema>;

/**
 * One configuration a weights round measured on one llama-server (decision 042): on dev, picked by
 * the keep rule, or on train tasks for the reduced protocol's smoke check. Never a locked result.
 */
export const AdapterCellSchema = z.object({
  arm: ArmIdSchema,
  round: z.number().int().positive(),
  split: z.enum(['dev', 'train']),
  label: z.string(),
  harnessVersion: z.number().int().nonnegative(),
  adapter: z.object({ id: z.string(), scale: z.number() }).nullable(),
  backend: z.string(),
  seeds: z.array(z.number().int()),
  score: CountedSchema,
  latencyMs: latency,
  provenance: z.string(),
});
export type AdapterCell = z.infer<typeof AdapterCellSchema>;

/** One input of the measurement model: measured on the calibration tasks, or assumed. */
export const ProjectionInputSchema = z.object({
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  source: z.enum(['measured', 'assumed']),
  note: z.string(),
});
export type ProjectionInput = z.infer<typeof ProjectionInputSchema>;

export const ArmProjectionSchema = z.object({
  arm: ArmIdSchema,
  hostedAttempts: z.number().int().nonnegative(),
  localAttempts: z.number().int().nonnegative(),
  sparkAttempts: z.number().int().nonnegative(),
  sparkCalls: z.number().int().nonnegative(),
  studentUsd: z.number().nonnegative(),
  sparkUsd: z.number().nonnegative(),
  computeUsd: z.number().nonnegative(),
  localMinutes: z.number().nonnegative(),
  wallMinutes: z.number().nonnegative(),
  funded: z.boolean(),
  /** What keeps it from running: a budget without room for it, or something it needs. */
  blockedBy: z.enum(['money', 'prerequisite']).nullable(),
  /** Why it isn't funded. */
  reason: z.string().nullable(),
});
export type ArmProjection = z.infer<typeof ArmProjectionSchema>;

/** The totals a plan may spend: the student's hosted credit, Spark, compute and GPU time. */
export const ComparisonCapsSchema = z.object({
  studentUsd: z.number().nonnegative(),
  sparkUsd: z.number().nonnegative(),
  computeUsd: z.number().nonnegative(),
  localMinutes: z.number().nonnegative(),
});
export type ComparisonCaps = z.infer<typeof ComparisonCapsSchema>;

export const ProjectionSchema = z.object({
  inputs: z.array(ProjectionInputSchema),
  arms: z.array(ArmProjectionSchema),
  caps: ComparisonCapsSchema,
  /** Student dollars spoken for before any arm: calibration paid, the regression check to come. */
  committedUsd: z.number().nonnegative(),
  /** The funded arms' projections added up. */
  funded: z.object({
    studentUsd: z.number().nonnegative(),
    sparkUsd: z.number().nonnegative(),
    computeUsd: z.number().nonnegative(),
    localMinutes: z.number().nonnegative(),
    wallMinutes: z.number().nonnegative(),
  }),
  /** Every arm asked for added up, funded or not. */
  requested: z.object({
    studentUsd: z.number().nonnegative(),
    sparkUsd: z.number().nonnegative(),
    computeUsd: z.number().nonnegative(),
    localMinutes: z.number().nonnegative(),
  }),
});
export type Projection = z.infer<typeof ProjectionSchema>;

/**
 * The bare student on a fixed set of tasks, outside any arm: calibration, or the runtime
 * regression check on another job, which says nothing about what mentoring did.
 */
export const TaskSweepSchema = z.object({
  label: z.string(),
  job: z.string(),
  tasks: z.number().int().nonnegative(),
  backend: BackendIdSchema,
  scenarios: CountedSchema,
  perType: z.array(CountedSchema.extend({ type: z.string(), label: z.string() })),
  latencyMs: latency.nullable(),
  meanUsdPerAttempt: z.number().nonnegative().nullable(),
  meanInputTokens: z.number().nonnegative(),
  meanOutputTokens: z.number().nonnegative(),
});
export type TaskSweep = z.infer<typeof TaskSweepSchema>;

/**
 * A comparison paused because an arm can't be paid for at what an attempt has really cost
 * (decision 081). Nothing is released while it stands: the person raises the student cap or
 * drops the arm.
 */
export const FundingPauseSchema = z.object({
  arm: ArmIdSchema,
  /** `start`: the arm hasn't started; `test`: it froze, and its locked test can't be paid for. */
  stage: z.enum(['start', 'test']),
  /** What a hosted attempt has cost so far. */
  priceUsd: z.number().nonnegative(),
  /** What the arm needs at that price, with the runner's headroom. */
  needUsd: z.number().nonnegative(),
  /** What is left under the cap after what was paid and what the arms before it hold. */
  leftUsd: z.number(),
  /** The student cap it is held to now. */
  capUsd: z.number().nonnegative(),
  at: z.iso.datetime(),
});
export type FundingPause = z.infer<typeof FundingPauseSchema>;

/** The least student cap that pays for the paused arm, rounded up to the cent. */
export function capToFund(pause: FundingPause): number {
  return Math.ceil((pause.capUsd + pause.needUsd - Math.max(0, pause.leftUsd)) * 100) / 100;
}

/** The pause said plainly: which arm, what it needs, what is left, and the two ways on. */
export function fundingMessage(pause: FundingPause): string {
  const usd = (value: number) => `$${value.toFixed(2)}`;
  const what =
    pause.stage === 'start'
      ? `${ARM_LABELS[pause.arm]} can't be paid for`
      : `${ARM_LABELS[pause.arm]}'s final test can't be paid for`;
  return `${what} at what an attempt has really cost ($${pause.priceUsd.toFixed(4)}): it needs ${usd(pause.needUsd)} of hosted Glimmer's budget, and ${usd(Math.max(0, pause.leftUsd))} is left under the ${usd(pause.capUsd)} cap. It waits for you, and no final test is released: raise the cap to at least ${usd(capToFund(pause))}, or drop the arm.`;
}

/** The person raised the student cap before any locked test was released (decision 081). */
export const CapAmendmentSchema = z.object({
  /** The arm the comparison paused for, when it paused. */
  arm: ArmIdSchema.nullable(),
  fromUsd: z.number().nonnegative(),
  toUsd: z.number().nonnegative(),
  /** The arm's own student cap, raised to what it needs at the measured price; null if unchanged. */
  armFromUsd: z.number().nonnegative().nullable(),
  armToUsd: z.number().nonnegative().nullable(),
  /** What a hosted attempt had cost when the cap was raised. */
  priceUsd: z.number().nonnegative(),
  at: z.iso.datetime(),
});
export type CapAmendment = z.infer<typeof CapAmendmentSchema>;

export const ComparisonReportSchema = z.object({
  format: z.literal(COMPARISON_REPORT_FORMAT),
  generatedAt: z.iso.datetime(),
  /** A dry run on fakes: no model was called, nothing was trained, and no number describes one. */
  dryRun: z.boolean(),
  commit: z.string().nullable(),
  job: z.object({
    id: z.string(),
    name: z.string(),
    splitsSeed: z.number().int(),
    counts: z.object({
      calibration: z.number().int().nonnegative(),
      train: z.number().int().nonnegative(),
      dev: z.number().int().nonnegative(),
      test: z.number().int().nonnegative(),
    }),
  }),
  plan: z.object({
    mentoringSeed: z.number().int(),
    /** The locked-test seeds the plan declared: the first for every arm, the rest for the repeat. */
    testSeeds: z.array(z.number().int()),
    /**
     * Each declared seed, then any other a locked test ran under, with the arms that have a stored
     * locked-test result under it. A declared seed with no arm was not run.
     */
    seedResults: z.array(z.object({ seed: z.number().int(), arms: z.array(ArmIdSchema) })),
    order: z.array(ArmIdSchema),
    adapterProtocol: AdapterProtocolSchema,
    /** When development closed and the locked tests were released; no arm developed after it. */
    releasedAt: z.iso.datetime().nullable(),
    /** Why it waits for the person before any locked test is released, when it does. */
    funding: FundingPauseSchema.nullable().default(null),
    /** Each raise of the student cap the person made before the release. */
    amendments: z.array(CapAmendmentSchema).default([]),
  }),
  /** The job and the regression check's job, pinned when the plan was made. */
  inputs: z
    .object({ job: PinnedInputsSchema, regression: PinnedInputsSchema.nullable() })
    .nullable(),
  calibration: TaskSweepSchema.nullable(),
  billing: BillingSchema.nullable(),
  regression: TaskSweepSchema.nullable(),
  credit: ReportCreditSchema.nullable(),
  /**
   * Every dollar the attempts and the ledger record as spent, each counted once: the arms' own
   * and the sweeps'. `studentUsd` is the attempts' recorded costs, which `studentParts` add up
   * from; the request journal (`credit`) is a different count of the same requests.
   */
  totals: z.object({
    sparkUsd: z.number().nonnegative(),
    studentUsd: z.number().nonnegative().nullable(),
    studentParts: z.object({
      armsUsd: z.number().nonnegative().nullable(),
      calibrationUsd: z.number().nonnegative().nullable(),
      regressionUsd: z.number().nonnegative().nullable(),
    }),
    computeUsd: z.number().nonnegative(),
    computeSettled: z.boolean(),
  }),
  projection: ProjectionSchema.nullable(),
  arms: z.array(ArmReportSchema),
  backends: z.array(BackendTableSchema),
  adapters: z.array(AdapterCellSchema),
  /** Budget differences, shared work, and anything a reader needs before trusting a number. */
  disclosures: z.array(z.string()),
});
export type ComparisonReport = z.infer<typeof ComparisonReportSchema>;
