import { z } from 'zod';

export const ScoreSchema = z.object({
  pass: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Score = z.infer<typeof ScoreSchema>;

/**
 * One alternative a propose-probe-compose round measured before its change was composed
 * (decision 108). It is a harness version of its own, never kept: the runner measures it on dev
 * beside the incumbent under the round's seeds and on the round's practice tasks, and the mentor
 * composes the round's one change from what the probes did.
 */
export const ProbeSchema = z.object({
  /** 1 to k, in the order the mentor proposed them. */
  index: z.number().int().positive(),
  title: z.string(),
  diagnosis: z.string(),
  files: z.array(z.string()),
  predicted: z.object({
    devDeltaMin: z.number().int(),
    devDeltaMax: z.number().int(),
    rationale: z.string(),
  }),
  /** The version it was measured as; absent when the runner refused to build it. */
  version: z.number().int().nonnegative().optional(),
  /** Why the runner refused it, when it did; a refused probe is never measured. */
  refused: z.string().optional(),
  /** The incumbent's and its own dev score under the round's seeds, once measured. */
  devBefore: ScoreSchema.optional(),
  devAfter: ScoreSchema.optional(),
  /** Its result on the round's practice tasks, once measured. */
  train: ScoreSchema.optional(),
});
export type Probe = z.infer<typeof ProbeSchema>;

/** One line of lineage.jsonl: a hypothesis, what it changed, and what it did to dev. */
export const LineageEntrySchema = z.object({
  id: z.string(),
  runId: z.string(),
  round: z.number().int().positive(),
  title: z.string(),
  diagnosis: z.string(),
  files: z.array(z.string()),
  causeTaskIds: z.array(z.string()),
  predicted: z.object({
    devDeltaMin: z.number().int(),
    devDeltaMax: z.number().int(),
    rationale: z.string(),
  }),
  /** Over every dev run the decision used; `delta` and `perType` count passes the same way. */
  measured: z.object({
    devBefore: ScoreSchema,
    devAfter: ScoreSchema,
    delta: z.number().int(),
    perType: z.array(
      z.object({ type: z.string(), before: z.number().int(), after: z.number().int() }),
    ),
    /**
     * The first measurement alone, present when it cleared the keep limits and both versions
     * were measured again under new seeds; the scores above then add up both measurements.
     */
    firstMeasurement: z.object({ devBefore: ScoreSchema, devAfter: ScoreSchema }).optional(),
  }),
  decision: z.enum(['kept', 'reverted']),
  decisionReason: z.string(),
  /**
   * For a change composed from probes (decision 108): every alternative the round proposed, its
   * version and measured effect, or why it was refused. The entry's own change, measurement and
   * decision are the composed change's.
   */
  probes: z.array(ProbeSchema).optional(),
  versionFrom: z.number().int().nonnegative(),
  versionTo: z.number().int().nonnegative(),
  mentor: z.object({
    model: z.string(),
    costUsd: z.number().nonnegative().nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  at: z.iso.datetime(),
});
export type LineageEntry = z.infer<typeof LineageEntrySchema>;
