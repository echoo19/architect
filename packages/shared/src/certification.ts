import { z } from 'zod';
import { StudentTargetSchema } from './job';
import { CertificateSchema } from './report';

/*
 * Certifying a version after the fact (decision 079): a frozen version's certificate measured on
 * tasks its own run never saw, without training it again. The record is the version's evidence;
 * once finished it never changes.
 */

/** A student's tokens on one attempt, as projections price it before anything is measured. */
export const ATTEMPT_TOKENS = { inputTokens: 9_000, outputTokens: 400 } as const;

/** Rough seconds per attempt: about 150 on this computer, ten times faster on a hosted copy. */
export const SECONDS_PER_ATTEMPT = { local: 150, hosted: 15 } as const;

/** The calibration size a certification takes unless it is asked for another. */
export const DEFAULT_CERTIFY_SIZE = 60;

export const CertifyRequestSchema = z.object({
  graduateId: z.string().min(1),
  version: z.number().int().positive(),
  /** The job whose taught organizations give the calibration tasks. */
  jobId: z.string().min(1),
  k: z.number().int().min(1).max(9),
  epsilon: z.number().gt(0).lt(1),
  delta: z.number().gt(0).lt(1),
  /** Calibration tasks. */
  size: z.number().int().min(1).max(2_000),
  /** Organizations of the job to check the certified threshold on, by id. */
  check: z.array(z.string().min(1)).max(20),
  /** A hosted student preset to run on instead of this computer's model. */
  student: z.string().min(1).optional(),
  /** Hard caps: no attempt starts that could take the spend or the time past them. */
  maxUsd: z.number().nonnegative(),
  maxMinutes: z.number().int().positive().max(100_000),
});
export type CertifyRequest = z.infer<typeof CertifyRequestSchema>;

/** One organization the certified threshold is checked on, with how many tasks it takes there. */
export const CertificationCheckPlanSchema = z.object({
  org: z.string(),
  orgName: z.string(),
  /** True for an organization the version was taught on, checked on tasks new to it. */
  seen: z.boolean(),
  synthetic: z.boolean(),
  tasks: z.number().int().positive(),
});
export type CertificationCheckPlan = z.infer<typeof CertificationCheckPlanSchema>;

/** What a certification will do and cost, fixed before anything spends. */
export const CertificationPlanSchema = z.object({
  jobName: z.string(),
  target: StudentTargetSchema,
  /** The student it runs on, as it is named. */
  student: z.string(),
  calibration: z.number().int().positive(),
  checks: z.array(CertificationCheckPlanSchema),
  /** k attempts at every calibration and check task. */
  attempts: z.number().int().positive(),
  /** Projected spend; zero on this computer. */
  usd: z.number().nonnegative(),
  seconds: z.number().nonnegative(),
});
export type CertificationPlan = z.infer<typeof CertificationPlanSchema>;

/** What the certificate was measured from, by hash: the sealed tasks and the frozen version. */
export const CertificationInputsSchema = z.object({
  /** sha256 of the sealed calibration and check tasks, as the vault holds them. */
  sealedSha256: z.string(),
  calibrationSha256: z.string(),
  checksSha256: z.record(z.string(), z.string()),
  harnessHash: z.string(),
  adapterSha256: z.string().nullable(),
  seeds: z.array(z.number().int().nonnegative()).min(1),
});
export type CertificationInputs = z.infer<typeof CertificationInputsSchema>;

export const CertificationStatusSchema = z.enum(['planned', 'certifying', 'paused', 'finished']);
export type CertificationStatus = z.infer<typeof CertificationStatusSchema>;

export const CertificationSchema = z.object({
  id: z.string(),
  graduateId: z.string(),
  version: z.number().int().positive(),
  /** The run that made the version. */
  runId: z.string(),
  request: CertifyRequestSchema,
  plan: CertificationPlanSchema,
  inputs: CertificationInputsSchema,
  status: CertificationStatusSchema,
  /** Why it paused. */
  error: z.string().optional(),
  /** Attempts made of `plan.attempts`. */
  done: z.number().int().nonnegative(),
  spentUsd: z.number().nonnegative(),
  certificate: CertificateSchema.optional(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type Certification = z.infer<typeof CertificationSchema>;
