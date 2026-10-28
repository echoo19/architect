import { z } from 'zod';
import { DecodingSchema } from './harness';
import { ScoreSchema } from './lineage';

/*
 * The comparisons report (decisions 037 and 045): every number the README and the demo claim,
 * computed from stored records only. The app reads this JSON; the README takes the Markdown made
 * from the same object.
 */

export const COMPARISON_REPORT_FORMAT = 'architect.comparisons/1';

/**
 * Decision 037's arms, in its order, which decides what is dropped when money runs short: the
 * earlier an arm, the earlier its claim on every budget.
 */
export const ArmIdSchema = z.enum([
  'bare',
  'draft',
  'targeted',
  'reference',
  'repeat',
  'fixed',
  'weights-one-shot',
  'weights-targeted',
]);
export type ArmId = z.infer<typeof ArmIdSchema>;

export const ARM_LABELS: Record<ArmId, string> = {
  bare: 'Bare student',
  draft: 'One-shot draft',
  targeted: 'Targeted mentoring',
  reference: 'Spark as a reference',
  repeat: 'Decoding repeat',
  fixed: 'Fixed intervention',
  'weights-one-shot': 'One-shot adapter',
  'weights-targeted': 'Failure-specific adapter',
};

/** Decision 037's place of each arm; both weights arms are its seventh. */
export const ARM_PRIORITY: Record<ArmId, number> = {
  bare: 1,
  draft: 2,
  targeted: 3,
  reference: 4,
  repeat: 5,
  fixed: 6,
  'weights-one-shot': 7,
  'weights-targeted': 7,
};

/**
 * Where a comparison's attempts ran. Arms are compared only within one backend: the hosted copy
 * of the student, Spark itself as a reference, or this computer's 2-bit build on Ollama, or on
 * llama-server with adapters.
 */
export const BackendIdSchema = z.enum(['hosted', 'reference', 'local-ollama', 'local-llama.cpp']);
export type BackendId = z.infer<typeof BackendIdSchema>;

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

/** One arm's locked-test result on one backend, under one decoding seed. */
export const ArmRowSchema = z.object({
  arm: ArmIdSchema,
  label: z.string(),
  runId: z.string().nullable(),
  seed: z.number().int(),
  /** Scenarios: each test task once. */
  scenarios: CountedSchema,
  perType: z.array(CountedSchema.extend({ type: z.string(), label: z.string() })),
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

/** Two arms on the same backend, seed and scenarios, counted scenario by scenario. */
export const PairedSchema = z.object({
  a: ArmIdSchema,
  b: ArmIdSchema,
  seed: z.number().int(),
  scenarios: z.number().int().nonnegative(),
  ...pairedCounts,
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
  dev: z.object({ baseline: ScoreSchema.nullable(), final: ScoreSchema.nullable() }),
  experiments: z.array(
    z.object({
      round: z.number().int().positive(),
      kind: z.string(),
      title: z.string(),
      disposition: z.string(),
      devBefore: ScoreSchema.nullable(),
      devAfter: ScoreSchema.nullable(),
      reason: z.string(),
    }),
  ),
  frozen: z
    .object({
      harnessVersion: z.number().int().nonnegative(),
      harnessHash: z.string(),
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

/** One configuration a weights round measured on dev on one llama-server (decision 042). */
export const AdapterCellSchema = z.object({
  arm: ArmIdSchema,
  round: z.number().int().positive(),
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

/** The bare student on a fixed set of tasks, outside any arm: calibration or the regression check. */
export const TaskSweepSchema = z.object({
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
    testSeeds: z.array(z.number().int()),
    order: z.array(ArmIdSchema),
  }),
  calibration: TaskSweepSchema.nullable(),
  regression: TaskSweepSchema.nullable(),
  projection: ProjectionSchema.nullable(),
  arms: z.array(ArmReportSchema),
  backends: z.array(BackendTableSchema),
  adapters: z.array(AdapterCellSchema),
  /** Budget differences, shared work, and anything a reader needs before trusting a number. */
  disclosures: z.array(z.string()),
});
export type ComparisonReport = z.infer<typeof ComparisonReportSchema>;
