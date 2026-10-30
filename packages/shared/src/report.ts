import { z } from 'zod';
import { StudentTargetSchema } from './job';
import { ScoreSchema } from './lineage';
import { RuleReportSchema } from './rules';
import { MethodSchema } from './run';

export const TypeResultSchema = z.object({
  type: z.string(),
  label: z.string(),
  pass: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** True when the graduate refuses this task type (it's on the guardrail list). */
  refused: z.boolean(),
});
export type TypeResult = z.infer<typeof TypeResultSchema>;

/**
 * A task type's locked-test result at one organization (decision 068): `seen` when the agent
 * trained on that organization, `synthetic` when its records were generated rather than real.
 */
export const OrgTypeResultSchema = z.object({
  type: z.string(),
  label: z.string(),
  org: z.string(),
  orgName: z.string(),
  seen: z.boolean(),
  synthetic: z.boolean(),
  pass: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type OrgTypeResult = z.infer<typeof OrgTypeResultSchema>;

/** The graduate's behavior on the calibration split at one agreement threshold. */
export const CertificatePointSchema = z.object({
  /** Answer when at least this many of the k attempts agree. */
  votes: z.number().int().positive(),
  answered: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  /** One-sided Clopper-Pearson upper bound on the selective error at δ. */
  bound: z.number().min(0).max(1),
});
export type CertificatePoint = z.infer<typeof CertificatePointSchema>;

/**
 * The certified threshold run where it wasn't calibrated: on the locked test of the organizations
 * the agent trained on, or on one it never saw. `held`: the observed selective error there is at
 * most the certified bound.
 */
export const CertificateCheckSchema = z.object({
  /** The organization's id; absent for the taught organizations' locked test together. */
  org: z.string().optional(),
  orgName: z.string().optional(),
  seen: z.boolean(),
  synthetic: z.boolean(),
  tasks: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  held: z.boolean(),
});
export type CertificateCheck = z.infer<typeof CertificateCheckSchema>;

const CertificateBaseSchema = z.object({
  /** Calibration tasks, sealed from the mentor and opened once after the graduate was frozen. */
  n: z.number().int().nonnegative(),
  k: z.number().int().positive(),
  delta: z.number().gt(0).lt(1),
  epsilon: z.number().gt(0).lt(1),
  /** Every threshold from strictest (all k agree) to loosest (always answer). */
  curve: z.array(CertificatePointSchema),
  /** What the guarantee assumes, in plain words. */
  assumption: z.string(),
});

/**
 * Certified answers (decision 077). Issued: when the graduate answers (at least `votes` of k
 * attempts agree), it is wrong on at most `bound` of requests like the calibration ones, with
 * confidence 1 - δ; it hands the rest to a person. Not issued: why, and how many calibration
 * tasks would likely be enough.
 */
export const CertificateSchema = z.discriminatedUnion('issued', [
  CertificateBaseSchema.extend({
    issued: z.literal(true),
    threshold: CertificatePointSchema,
    checks: z.array(CertificateCheckSchema),
  }),
  CertificateBaseSchema.extend({
    issued: z.literal(false),
    reason: z.enum(['none_answered', 'error_rate', 'too_few']),
    needed: z.number().int().positive().nullable(),
  }),
]);
export type Certificate = z.infer<typeof CertificateSchema>;

export const ReportCardSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  method: MethodSchema,
  name: z.string(),
  createdAt: z.iso.datetime(),
  student: z.object({
    label: z.string(),
    model: z.string(),
    runtime: z.string(),
    /** From the runtime when it reports them, e.g. `Q4_K_M` and the model file's size. */
    quantization: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
  }),
  /**
   * The student endpoint that took the test this card reports (decision 009). Cards written
   * before a run could choose were all tested on the local student.
   */
  testedOn: StudentTargetSchema.default('local'),
  mentor: z.object({ label: z.string(), model: z.string() }),
  test: z.object({
    score: ScoreSchema,
    perType: z.array(TypeResultSchema),
    latencyMs: z.object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() }),
    /** Supported tasks the graduate refused. They count as failures. */
    refusals: z.number().int().nonnegative(),
    /** True only for a test on the local student at a loopback address; a hosted test never is. */
    ranOffline: z.boolean(),
    /**
     * With more than one predeclared decoding seed, each repeat's own result. The score above
     * then counts scenarios: a task passes only when it passed under every seed.
     */
    repeats: z
      .array(z.object({ seed: z.number().int(), score: ScoreSchema }))
      .min(2)
      .optional(),
    /**
     * For a job with organizations: each task type's result at each organization. The score,
     * `perType`, latency and the requirements above count only the organizations it trained on;
     * one it never saw is reported here alone (decision 070).
     */
    perOrg: z.array(OrgTypeResultSchema).optional(),
  }),
  dev: z.object({
    baseline: ScoreSchema.nullable(),
    final: ScoreSchema.nullable(),
    curve: z.array(
      z.object({
        round: z.number().int().nonnegative(),
        score: ScoreSchema,
        decision: z.enum(['baseline', 'kept', 'reverted']),
      }),
    ),
  }),
  cost: z.object({
    mentorUsd: z.number().nonnegative(),
    /**
     * What a hosted copy of the student cost the run, a hosted locked test included. Absent when
     * the student ran only on this computer.
     */
    studentUsd: z.number().positive().optional(),
    mentorInputTokens: z.number().int().nonnegative(),
    mentorOutputTokens: z.number().int().nonnegative(),
    rounds: z.number().int().nonnegative(),
    wallMs: z.number().int().nonnegative(),
  }),
  refusedTypes: z.array(z.object({ type: z.string(), label: z.string(), reason: z.string() })),
  topInterventions: z.array(
    z.object({
      round: z.number().int().positive(),
      title: z.string(),
      /** Net dev passes over the dev runs the change was kept on: `runs` of them, else one. */
      delta: z.number().int(),
      runs: z.number().int().min(2).optional(),
    }),
  ),
  requirements: z.object({
    passRate: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }),
    p95LatencyMs: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }).optional(),
  }),
  /** The mentor claimed "ready" during training; true when the test disagreed. */
  overclaim: z.boolean().nullable(),
  /**
   * Where the final test's requests came from, for a job whose tasks weren't shipped with it
   * (decision 058). `generated`: Architect made them from the person's files, following a job
   * description the mentor drafted, so the answers are checked against that description and not
   * independently certified as right for the business. `attached`: they are the example tasks the
   * person attached. Absent for the sample jobs and for jobs imported with their tasks.
   */
  tasks: z
    .object({
      source: z.enum(['generated', 'attached']),
      /** What drafting the job cost the mentor, when every call had a price. */
      draftingUsd: z.number().nonnegative().optional(),
      /**
       * The rules the expected answers were calculated by, as the person confirmed them
       * (decision 061). Absent for a job with none.
       */
      rules: z.array(RuleReportSchema).min(1).optional(),
    })
    .optional(),
  /** For a job that asked for one, the graduate's certificate (decision 077). */
  certificate: CertificateSchema.optional(),
});
export type ReportCard = z.infer<typeof ReportCardSchema>;
