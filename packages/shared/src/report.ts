import { z } from 'zod';
import { ScoreSchema } from './lineage';
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

export const ReportCardSchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  method: MethodSchema,
  name: z.string(),
  createdAt: z.iso.datetime(),
  student: z.object({ label: z.string(), model: z.string(), runtime: z.string() }),
  mentor: z.object({ label: z.string(), model: z.string() }),
  test: z.object({
    score: ScoreSchema,
    perType: z.array(TypeResultSchema),
    latencyMs: z.object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() }),
    /** Supported tasks the graduate refused. They count as failures. */
    refusals: z.number().int().nonnegative(),
    ranOffline: z.boolean(),
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
    mentorInputTokens: z.number().int().nonnegative(),
    mentorOutputTokens: z.number().int().nonnegative(),
    rounds: z.number().int().nonnegative(),
    wallMs: z.number().int().nonnegative(),
  }),
  refusedTypes: z.array(z.object({ type: z.string(), label: z.string(), reason: z.string() })),
  topInterventions: z.array(
    z.object({ round: z.number().int().positive(), title: z.string(), delta: z.number().int() }),
  ),
  requirements: z.object({
    passRate: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }),
    p95LatencyMs: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }).optional(),
  }),
  /** The mentor claimed "ready" during training; true when the test disagreed. */
  overclaim: z.boolean().nullable(),
});
export type ReportCard = z.infer<typeof ReportCardSchema>;
